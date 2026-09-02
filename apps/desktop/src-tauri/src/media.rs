//! Reading a video file.
//!
//! A clip is not something a vision model can watch, so it is turned into a
//! handful of stills taken across its length. What the model cannot see in one
//! frame — that the camera is pushing in, that a hand is rising — it can infer
//! from how the frames differ, which is why they are sampled in order and
//! described as an ordered set rather than as separate pictures.
//!
//! This lives with the host because the web view cannot run a program, and
//! because a video is far too large to hand across as base64 just to have it
//! handed back.
//!
//! ffmpeg is found on PATH rather than bundled. Shipping a copy is a release
//! concern; refusing to work without one, and saying so, is this one.

use std::process::Command;

use base64::Engine;
use serde::Serialize;
use serde_json::Value;
use crate::tools;

/// Frames sampled from one clip. More than a handful stops adding anything and
/// starts costing real money per read.
const DEFAULT_FRAMES: u32 = 5;

#[derive(Serialize, Default)]
pub struct MediaTools {
    ffmpeg: bool,
    ffprobe: bool,
    /// True when the copy in use came with the app rather than off PATH.
    ///
    /// Not a problem either way — but when a clip reads differently here than
    /// somewhere else, the first useful question is which ffmpeg did it.
    bundled: bool,
}

fn runs(program: &str) -> bool {
    Command::new(program)
        .arg("-version")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

/// Whether a clip can be read at all, so the window can say so before someone
/// picks a file and waits for nothing.
#[tauri::command]
pub fn media_tools() -> MediaTools {
    // The resolved paths, not the bare names: a bundled copy is the whole
    // point, and probing "ffmpeg" would report none on a machine that has only
    // ours.
    MediaTools {
        ffmpeg: runs(tools::ffmpeg()),
        ffprobe: runs(tools::ffprobe()),
        bundled: tools::is_bundled("ffmpeg"),
    }
}

#[derive(Serialize)]
pub struct Probe {
    duration_s: f64,
    width: u64,
    height: u64,
    /// Frames per second, already divided out of ffprobe's fraction.
    fps: f64,
    has_audio: bool,
    /// e.g. `16:9`, worked out from the dimensions.
    aspect_ratio: String,
}

fn ratio(width: u64, height: u64) -> String {
    if width == 0 || height == 0 {
        return String::new();
    }
    let mut a = width;
    let mut b = height;
    while b != 0 {
        let t = b;
        b = a % b;
        a = t;
    }
    format!("{}:{}", width / a, height / a)
}

/// ffprobe reports frame rate as a fraction, e.g. `30000/1001`.
fn fraction(text: &str) -> f64 {
    match text.split_once('/') {
        Some((n, d)) => {
            let n: f64 = n.parse().unwrap_or(0.0);
            let d: f64 = d.parse().unwrap_or(0.0);
            if d == 0.0 { 0.0 } else { n / d }
        }
        None => text.parse().unwrap_or(0.0),
    }
}

#[tauri::command]
pub fn media_probe(path: String) -> Result<Probe, String> {
    let output = Command::new(tools::ffprobe())
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

    let streams = json.get("streams").and_then(Value::as_array).cloned().unwrap_or_default();
    let video = streams
        .iter()
        .find(|s| s.get("codec_type").and_then(Value::as_str) == Some("video"))
        .ok_or("That file has no video in it.")?;

    let width = video.get("width").and_then(Value::as_u64).unwrap_or(0);
    let height = video.get("height").and_then(Value::as_u64).unwrap_or(0);

    // Duration sits on the container for some formats and the stream for others.
    let duration_s = json
        .pointer("/format/duration")
        .and_then(Value::as_str)
        .or_else(|| video.get("duration").and_then(Value::as_str))
        .and_then(|d| d.parse::<f64>().ok())
        .unwrap_or(0.0);

    Ok(Probe {
        duration_s,
        width,
        height,
        fps: fraction(video.get("avg_frame_rate").and_then(Value::as_str).unwrap_or("0/1")),
        has_audio: streams
            .iter()
            .any(|s| s.get("codec_type").and_then(Value::as_str) == Some("audio")),
        aspect_ratio: ratio(width, height),
    })
}

#[derive(Serialize)]
pub struct Frame {
    /// Seconds into the clip.
    at: f64,
    /// JPEG, base64, no data: prefix — the shape the provider takes.
    base64: String,
}

/// Where to sample. Spread across the clip but never at the very edges, which
/// are often black or a fade.
fn timestamps(duration_s: f64, count: u32) -> Vec<f64> {
    if duration_s <= 0.0 || count == 0 {
        return vec![0.0];
    }
    let inset = (duration_s * 0.04).min(0.25);
    let usable = (duration_s - inset * 2.0).max(0.0);

    (0..count)
        .map(|i| {
            if count == 1 {
                inset + usable / 2.0
            } else {
                inset + usable * (f64::from(i) / f64::from(count - 1))
            }
        })
        .collect()
}

#[tauri::command]
pub fn media_frames(path: String, count: Option<u32>) -> Result<Vec<Frame>, String> {
    let probe = media_probe(path.clone())?;
    let wanted = count.unwrap_or(DEFAULT_FRAMES).clamp(1, 12);

    let mut frames = Vec::new();
    for at in timestamps(probe.duration_s, wanted) {
        // Seeking before the input is the fast form; one frame out, scaled down
        // because a model reads a 4K still no better than a 768px one.
        let output = Command::new(tools::ffmpeg())
            .args([
                "-v", "error",
                "-ss", &format!("{at:.3}"),
                "-i", &path,
                "-frames:v", "1",
                "-vf", "scale='min(768,iw)':-2",
                "-q:v", "4",
                "-f", "image2",
                "-",
            ])
            .output()
            .map_err(|e| format!("Could not run ffmpeg: {e}. Install ffmpeg and put it on PATH."))?;

        if !output.status.success() || output.stdout.is_empty() {
            // One unreadable position is not a failed read: a clip can end
            // early, or a seek can land past the last frame.
            continue;
        }

        frames.push(Frame {
            at,
            base64: base64::engine::general_purpose::STANDARD.encode(&output.stdout),
        });
    }

    if frames.is_empty() {
        return Err("ffmpeg produced no frames from that file.".to_string());
    }
    Ok(frames)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn works_out_the_aspect_ratio_people_would_write() {
        assert_eq!(ratio(1920, 1080), "16:9");
        assert_eq!(ratio(1080, 1920), "9:16");
        assert_eq!(ratio(1024, 1024), "1:1");
        assert_eq!(ratio(1440, 1080), "4:3");
        assert_eq!(ratio(0, 1080), "");
    }

    #[test]
    fn reads_the_fraction_ffprobe_reports() {
        assert!((fraction("30/1") - 30.0).abs() < 1e-9);
        assert!((fraction("30000/1001") - 29.97).abs() < 0.01);
        assert_eq!(fraction("0/0"), 0.0);
        assert!((fraction("25") - 25.0).abs() < 1e-9);
    }

    fn fixture(name: &str) -> std::path::PathBuf {
        std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures").join(name)
    }

    /// Against a real file and a real ffmpeg. Costs nothing, so it is not
    /// ignored — but it skips rather than fails where either is absent.
    #[test]
    fn reads_a_real_clip() {
        let clip = fixture("clip.mp4");
        if !clip.exists() || !runs(tools::ffprobe()) || !runs(tools::ffmpeg()) {
            eprintln!("skipped: needs ffmpeg and a clip at {}", clip.display());
            return;
        }
        let path = clip.to_string_lossy().to_string();

        let probe = media_probe(path.clone()).unwrap();
        assert!(probe.duration_s > 0.0, "no duration");
        assert!(probe.width > 0 && probe.height > 0, "no dimensions");
        assert!(probe.fps > 0.0, "no frame rate");
        assert!(!probe.aspect_ratio.is_empty(), "no aspect ratio");

        let frames = media_frames(path, Some(4)).unwrap();
        assert_eq!(frames.len(), 4, "asked for four frames");

        for (i, frame) in frames.iter().enumerate() {
            assert!(frame.at < probe.duration_s, "frame {i} lands past the end");
            assert!(frame.base64.len() > 1000, "frame {i} is too small to be a picture");
            // Decoded, it must actually start like a JPEG.
            let bytes = base64::engine::general_purpose::STANDARD.decode(&frame.base64).unwrap();
            assert_eq!(&bytes[..2], &[0xFF, 0xD8], "frame {i} is not a JPEG");
        }

        // In order, and spread rather than bunched at one moment.
        assert!(frames.windows(2).all(|w| w[1].at > w[0].at));
        assert!(frames.last().unwrap().at - frames[0].at > probe.duration_s * 0.5);
    }

    #[test]
    fn samples_across_the_clip_without_touching_its_edges() {
        let ts = timestamps(10.0, 5);

        assert_eq!(ts.len(), 5);
        assert!(ts[0] > 0.0, "the first frame is not at zero");
        assert!(*ts.last().unwrap() < 10.0, "the last frame is not at the end");
        // In order, and evenly spread.
        assert!(ts.windows(2).all(|w| w[1] > w[0]));

        // Degenerate inputs give something usable rather than panicking.
        assert_eq!(timestamps(0.0, 5), vec![0.0]);
        assert_eq!(timestamps(10.0, 1).len(), 1);
    }
}
