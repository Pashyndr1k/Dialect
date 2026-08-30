//! Reading an audio file.
//!
//! A model cannot listen, and unlike a video there is no frame to show it. So
//! this splits the job by what each side is actually good at.
//!
//! What can be *measured* is measured here and handed over as fact: how long it
//! runs, how loud it is, its tempo, its key. None of that is a matter of
//! opinion, and a model asked to guess at it will guess wrong in ways that are
//! hard to notice — a prompt confidently saying 140 BPM about a 90 BPM track is
//! worse than one that says nothing.
//!
//! What is left — genre, instruments, how it feels — is judgement, and that goes
//! to the model with a picture of the sound: a spectrogram and a waveform. Those
//! genuinely show density, brightness, dynamics and where the sections change.
//! They do not show what a saxophone is. The prompt that goes with them says so.
//!
//! ffmpeg is found on PATH rather than bundled, the same as for video.

use std::f64::consts::PI;
use std::process::Command;

use base64::Engine;
use serde::Serialize;
use serde_json::Value;

/// Analysis is capped rather than run over a whole album track. Tempo and key
/// do not change often enough to be worth the wait.
const ANALYSIS_SECONDS: u32 = 120;

/// Everything is resampled to this before analysis: high enough for the pitches
/// that matter, low enough that the arithmetic is cheap.
const ANALYSIS_RATE: usize = 22050;

const NOTES: [&str; 12] =
    ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

// ---------------------------------------------------------------------------
// What the container says
// ---------------------------------------------------------------------------

#[derive(Serialize, Default)]
pub struct AudioProbe {
    duration_s: f64,
    sample_rate: u32,
    channels: u32,
    /// Whatever the file was tagged with — often nothing, occasionally the
    /// answer to a question this module would otherwise have to work out.
    title: Option<String>,
    artist: Option<String>,
    genre: Option<String>,
}

fn tag(json: &Value, name: &str) -> Option<String> {
    let tags = json.pointer("/format/tags")?.as_object()?;
    // Tag case is not consistent between writers, so match either.
    for (key, value) in tags {
        if key.eq_ignore_ascii_case(name) {
            let text = value.as_str()?.trim();
            if !text.is_empty() {
                return Some(text.to_string());
            }
        }
    }
    None
}

#[tauri::command]
pub fn audio_probe(path: String) -> Result<AudioProbe, String> {
    let output = Command::new("ffprobe")
        .args(["-v", "error", "-print_format", "json", "-show_format", "-show_streams", &path])
        .output()
        .map_err(|e| format!("Could not run ffprobe: {e}. Install ffmpeg and put it on PATH."))?;

    if !output.status.success() {
        return Err(format!(
            "ffprobe could not read that file: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }

    let json: Value = serde_json::from_slice(&output.stdout)
        .map_err(|e| format!("ffprobe returned something unreadable: {e}"))?;

    let stream = json
        .get("streams")
        .and_then(Value::as_array)
        .and_then(|streams| {
            streams
                .iter()
                .find(|s| s.get("codec_type").and_then(Value::as_str) == Some("audio"))
        })
        .ok_or("That file has no sound in it.")?;

    Ok(AudioProbe {
        duration_s: json
            .pointer("/format/duration")
            .and_then(Value::as_str)
            .or_else(|| stream.get("duration").and_then(Value::as_str))
            .and_then(|d| d.parse::<f64>().ok())
            .unwrap_or(0.0),
        sample_rate: stream
            .get("sample_rate")
            .and_then(Value::as_str)
            .and_then(|r| r.parse().ok())
            .unwrap_or(0),
        channels: stream.get("channels").and_then(Value::as_u64).unwrap_or(0) as u32,
        title: tag(&json, "title"),
        artist: tag(&json, "artist"),
        genre: tag(&json, "genre"),
    })
}

// ---------------------------------------------------------------------------
// Decoding
// ---------------------------------------------------------------------------

/// Mono, one fixed rate, plain floats. Everything below reads this.
fn decode(path: &str) -> Result<Vec<f32>, String> {
    let output = Command::new("ffmpeg")
        .args([
            "-v", "error",
            "-i", path,
            "-t", &ANALYSIS_SECONDS.to_string(),
            "-ac", "1",
            "-ar", &ANALYSIS_RATE.to_string(),
            "-f", "f32le",
            "-",
        ])
        .output()
        .map_err(|e| format!("Could not run ffmpeg: {e}. Install ffmpeg and put it on PATH."))?;

    if !output.status.success() {
        return Err(format!(
            "ffmpeg could not decode that file: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }

    let samples: Vec<f32> = output
        .stdout
        .chunks_exact(4)
        .map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]]))
        .collect();

    if samples.len() < ANALYSIS_RATE {
        return Err("That file is too short to say anything about.".to_string());
    }
    Ok(samples)
}

// ---------------------------------------------------------------------------
// Tempo
// ---------------------------------------------------------------------------

/// Frames per envelope step. Short enough to place a beat, long enough that the
/// envelope is about energy rather than about the waveform.
const HOP: usize = 256;

/// Loudness over time, differenced — what is left is where notes start.
fn onset_envelope(samples: &[f32]) -> Vec<f32> {
    let energy: Vec<f32> = samples
        .chunks(HOP)
        .map(|frame| (frame.iter().map(|s| s * s).sum::<f32>() / frame.len() as f32).sqrt())
        .collect();

    // Only rises count. A note ending is not an onset.
    energy
        .windows(2)
        .map(|w| (w[1] - w[0]).max(0.0))
        .collect()
}

#[derive(Serialize)]
pub struct Tempo {
    bpm: f64,
    /// How far the winning period stands above the rest, roughly 0–1. Anything
    /// under about 0.2 means the track has no steady pulse to find.
    confidence: f64,
}

/// The strongest repeating period in the onsets, between 60 and 200 BPM.
///
/// Deliberately not folded into a "preferred" range afterwards: a track that
/// really is 68 BPM should be reported as 68, and the search already refuses
/// anything outside what a person would call a tempo.
fn tempo_of(envelope: &[f32], frames_per_second: f64) -> Option<Tempo> {
    let min_lag = (frames_per_second * 60.0 / 200.0).round() as usize;
    let max_lag = (frames_per_second * 60.0 / 60.0).round() as usize;
    if envelope.len() < max_lag * 2 {
        return None;
    }

    let mean = envelope.iter().sum::<f32>() as f64 / envelope.len() as f64;
    let centred: Vec<f64> = envelope.iter().map(|&v| v as f64 - mean).collect();

    let correlate = |lag: usize| -> f64 {
        let n = centred.len() - lag;
        centred[..n].iter().zip(&centred[lag..]).map(|(a, b)| a * b).sum::<f64>() / n as f64
    };

    let scores: Vec<f64> = (min_lag..=max_lag).map(correlate).collect();
    let (best, &peak) = scores
        .iter()
        .enumerate()
        .max_by(|a, b| a.1.total_cmp(b.1))?;
    if peak <= 0.0 {
        return None;
    }

    // Interpolate between neighbouring lags: a whole frame is worth several BPM
    // up here, so the nearest integer lag is not a good enough answer.
    let refined = if best > 0 && best + 1 < scores.len() {
        let (y0, y1, y2) = (scores[best - 1], scores[best], scores[best + 1]);
        let denominator = y0 - 2.0 * y1 + y2;
        best as f64 + if denominator == 0.0 { 0.0 } else { 0.5 * (y0 - y2) / denominator }
    } else {
        best as f64
    };

    let lag = min_lag as f64 + refined;
    let average = scores.iter().sum::<f64>() / scores.len() as f64;

    Some(Tempo {
        bpm: (60.0 * frames_per_second / lag * 10.0).round() / 10.0,
        confidence: ((peak - average) / peak).clamp(0.0, 1.0),
    })
}

// ---------------------------------------------------------------------------
// Key
// ---------------------------------------------------------------------------

/// One frequency's magnitude, without building a whole spectrum for it.
///
/// Twelve pitch classes across five octaves is sixty frequencies, which is far
/// fewer than an FFT bin count — and they are the only sixty that matter here.
fn goertzel(samples: &[f32], freq: f64) -> f64 {
    let w = 2.0 * PI * freq / ANALYSIS_RATE as f64;
    let coeff = 2.0 * w.cos();

    let (mut s1, mut s2) = (0.0_f64, 0.0_f64);
    for &x in samples {
        let s0 = x as f64 + coeff * s1 - s2;
        s2 = s1;
        s1 = s0;
    }
    (s1 * s1 + s2 * s2 - coeff * s1 * s2).max(0.0).sqrt()
}

const WINDOW: usize = 4096;

/// Energy per pitch class, summed across octaves — C at every height is one C.
fn chroma(samples: &[f32]) -> [f64; 12] {
    // Two octaves either side of the middle, which is where a melody and the
    // chords under it both live.
    let frequencies: Vec<(usize, f64)> = (36..=95)
        .map(|midi: i32| {
            (midi as usize % 12, 440.0 * 2f64.powf((midi - 69) as f64 / 12.0))
        })
        .collect();

    let mut out = [0.0; 12];
    let mut windows = 0;

    for frame in samples.chunks_exact(WINDOW) {
        // Hann, so a pitch that sits between two bins does not smear into its
        // neighbours and turn a clean chord into a cluster.
        let shaped: Vec<f32> = frame
            .iter()
            .enumerate()
            .map(|(i, &x)| {
                let w = 0.5 - 0.5 * (2.0 * PI * i as f64 / (WINDOW - 1) as f64).cos();
                x * w as f32
            })
            .collect();

        for &(pitch_class, freq) in &frequencies {
            out[pitch_class] += goertzel(&shaped, freq);
        }
        windows += 1;
        if windows >= 160 {
            break;
        }
    }

    let total: f64 = out.iter().sum();
    if total > 0.0 {
        for v in &mut out {
            *v /= total;
        }
    }
    out
}

/// Krumhansl–Schmuckler: how much each degree of a scale is used in practice,
/// measured from actual music rather than derived from theory.
const MAJOR: [f64; 12] =
    [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR: [f64; 12] =
    [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

fn correlation(a: &[f64; 12], b: &[f64; 12]) -> f64 {
    let mean_a = a.iter().sum::<f64>() / 12.0;
    let mean_b = b.iter().sum::<f64>() / 12.0;

    let mut top = 0.0;
    let mut left = 0.0;
    let mut right = 0.0;
    for i in 0..12 {
        let (da, db) = (a[i] - mean_a, b[i] - mean_b);
        top += da * db;
        left += da * da;
        right += db * db;
    }
    if left == 0.0 || right == 0.0 {
        0.0
    } else {
        top / (left * right).sqrt()
    }
}

#[derive(Serialize)]
pub struct Key {
    /// e.g. `A minor`.
    name: String,
    /// The winning correlation, roughly 0–1. Low means the track is not really
    /// in a key — a drum loop, or something atonal.
    confidence: f64,
}

fn key_of(chroma: &[f64; 12]) -> Option<Key> {
    let mut best: Option<(f64, usize, bool)> = None;

    for tonic in 0..12 {
        for (profile, is_major) in [(&MAJOR, true), (&MINOR, false)] {
            let mut rotated = [0.0; 12];
            for i in 0..12 {
                rotated[i] = profile[(i + 12 - tonic) % 12];
            }
            let score = correlation(chroma, &rotated);
            if best.is_none_or(|(b, _, _)| score > b) {
                best = Some((score, tonic, is_major));
            }
        }
    }

    let (score, tonic, is_major) = best?;
    if score <= 0.0 {
        return None;
    }
    Some(Key {
        name: format!("{} {}", NOTES[tonic], if is_major { "major" } else { "minor" }),
        confidence: (score * 100.0).round() / 100.0,
    })
}

// ---------------------------------------------------------------------------
// Loudness
// ---------------------------------------------------------------------------

/// Integrated loudness and range, the two numbers that describe a master.
fn loudness(path: &str) -> Option<(f64, f64)> {
    let output = Command::new("ffmpeg")
        .args(["-v", "info", "-nostats", "-i", path, "-af", "ebur128", "-f", "null", "-"])
        .output()
        .ok()?;

    // ffmpeg writes the summary to stderr, as a block of `Key: value` lines.
    let text = String::from_utf8_lossy(&output.stderr);
    let after = |label: &str| -> Option<f64> {
        let at = text.rfind(label)?;
        text[at + label.len()..]
            .split_whitespace()
            .next()?
            .parse::<f64>()
            .ok()
    };
    Some((after("I:")?, after("LRA:")?))
}

// ---------------------------------------------------------------------------
// What the model gets to look at
// ---------------------------------------------------------------------------

#[derive(Serialize)]
pub struct Picture {
    /// What it shows, so the question can name it.
    kind: String,
    base64: String,
}

fn render(path: &str, kind: &str, filter: &str) -> Option<Picture> {
    let output = Command::new("ffmpeg")
        .args([
            "-v", "error",
            "-i", path,
            "-lavfi", filter,
            "-frames:v", "1",
            "-c:v", "mjpeg",
            "-q:v", "3",
            "-f", "image2",
            "-",
        ])
        .output()
        .ok()?;

    if !output.status.success() || output.stdout.is_empty() {
        return None;
    }
    Some(Picture {
        kind: kind.to_string(),
        base64: base64::engine::general_purpose::STANDARD.encode(&output.stdout),
    })
}

#[derive(Serialize)]
pub struct Measured {
    probe: AudioProbe,
    tempo: Option<Tempo>,
    key: Option<Key>,
    /// Integrated loudness in LUFS, and loudness range.
    lufs: Option<f64>,
    lra: Option<f64>,
    /// A spectrogram and a waveform, in that order.
    pictures: Vec<Picture>,
}

#[tauri::command]
pub fn audio_measure(path: String) -> Result<Measured, String> {
    let probe = audio_probe(path.clone())?;
    let samples = decode(&path)?;

    let envelope = onset_envelope(&samples);
    let frames_per_second = ANALYSIS_RATE as f64 / HOP as f64;
    let (lufs, lra) = loudness(&path).map_or((None, None), |(i, r)| (Some(i), Some(r)));

    let pictures = [
        ("spectrogram", "showspectrumpic=s=1024x512:mode=combined:legend=disabled:scale=log"),
        ("waveform", "showwavespic=s=1024x256:colors=white"),
    ]
    .iter()
    .filter_map(|(kind, filter)| render(&path, kind, filter))
    .collect();

    Ok(Measured {
        probe,
        tempo: tempo_of(&envelope, frames_per_second),
        key: key_of(&chroma(&samples)),
        lufs,
        lra,
        pictures,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ffmpeg_here() -> bool {
        Command::new("ffmpeg").arg("-version").output().map(|o| o.status.success()).unwrap_or(false)
    }

    /// A signal built to order, so the right answer is known rather than judged.
    fn synthesise(expression: &str, seconds: f64) -> Option<Vec<f32>> {
        let output = Command::new("ffmpeg")
            .args([
                "-v", "error",
                "-f", "lavfi",
                "-i",
                &format!("aevalsrc={expression}:s={ANALYSIS_RATE}:d={seconds}"),
                "-ac", "1",
                "-f", "f32le",
                "-",
            ])
            .output()
            .ok()?;
        if !output.status.success() {
            eprintln!("lavfi: {}", String::from_utf8_lossy(&output.stderr));
            return None;
        }
        Some(
            output
                .stdout
                .chunks_exact(4)
                .map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]]))
                .collect(),
        )
    }

    #[test]
    fn counts_a_click_track() {
        if !ffmpeg_here() {
            eprintln!("skipped: needs ffmpeg");
            return;
        }
        // A 1 kHz burst every half second is 120 BPM, by construction.
        let clicks =
            synthesise("if(lt(mod(t\\,0.5)\\,0.02)\\,sin(2*PI*1000*t)\\,0)", 20.0).unwrap();

        let tempo = tempo_of(&onset_envelope(&clicks), ANALYSIS_RATE as f64 / HOP as f64)
            .expect("no tempo found in a metronome");

        assert!((tempo.bpm - 120.0).abs() < 2.0, "read {} BPM, not 120", tempo.bpm);
        assert!(tempo.confidence > 0.3, "a metronome should be an easy read");
    }

    #[test]
    fn hears_the_notes_in_a_chord() {
        if !ffmpeg_here() {
            eprintln!("skipped: needs ffmpeg");
            return;
        }
        // A major: A4, C#5, E5.
        let chord = synthesise(
            "0.3*sin(2*PI*440*t)+0.3*sin(2*PI*554.365*t)+0.3*sin(2*PI*659.255*t)",
            8.0,
        )
        .unwrap();

        let c = chroma(&chord);
        let mut ranked: Vec<usize> = (0..12).collect();
        ranked.sort_by(|&a, &b| c[b].total_cmp(&c[a]));

        let top: Vec<&str> = ranked[..3].iter().map(|&i| NOTES[i]).collect();
        for note in ["A", "C#", "E"] {
            assert!(top.contains(&note), "{note} missing from {top:?}");
        }
    }

    #[test]
    fn names_the_key_of_a_chord() {
        if !ffmpeg_here() {
            eprintln!("skipped: needs ffmpeg");
            return;
        }
        let chord = synthesise(
            "0.3*sin(2*PI*440*t)+0.3*sin(2*PI*554.365*t)+0.3*sin(2*PI*659.255*t)",
            8.0,
        )
        .unwrap();

        let key = key_of(&chroma(&chord)).expect("no key found in a triad");
        assert_eq!(key.name, "A major");
        assert!(key.confidence > 0.3);
    }

    #[test]
    fn finds_nothing_in_silence_rather_than_inventing_it() {
        let silence = vec![0.0_f32; ANALYSIS_RATE * 8];

        assert!(tempo_of(&onset_envelope(&silence), ANALYSIS_RATE as f64 / HOP as f64).is_none());
        assert!(key_of(&chroma(&silence)).is_none());
    }

    #[test]
    fn onsets_are_rises_only() {
        // Up, then down. Only the rise survives.
        let mut samples = vec![0.0_f32; HOP * 4];
        for s in samples.iter_mut().take(HOP * 2).skip(HOP) {
            *s = 0.5;
        }

        let envelope = onset_envelope(&samples);
        assert!(envelope.iter().all(|&v| v >= 0.0));
        assert!(envelope.iter().sum::<f32>() > 0.0, "a note starting is an onset");
    }
}
