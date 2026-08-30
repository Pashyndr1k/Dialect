//! Turning speech into text.
//!
//! The window records; this transcribes. Which is to say: this finds something
//! that can transcribe, because nothing here can do it alone.
//!
//! Two ways, tried in that order. A whisper on PATH is free, private, and needs
//! no key — the same arrangement as ffmpeg, and the better answer when it is
//! there. Otherwise a transcription API, with its key in the OS credential
//! store and the request made from here, so the key never enters the web view.
//!
//! Where neither is available the window says which one to add rather than
//! offering a button that does nothing.

use std::fs;
use std::path::PathBuf;
use std::process::Command;

use base64::Engine;
use serde::Serialize;

use crate::secrets;

/// Long enough for anyone to describe an idea; short enough not to be a bill.
const MAX_SECONDS: u32 = 120;

/// Names whisper.cpp and the Python package are installed under, in order.
const WHISPER_BINARIES: [&str; 3] = ["whisper-cli", "whisper", "faster-whisper"];

/// Where the transcription API key lives, if there is one.
pub const OPENAI_KEY: &str = "openai";

#[derive(Serialize, Default)]
pub struct VoiceTools {
    /// Name of the whisper on PATH, if any.
    whisper: Option<String>,
    /// Whether a transcription key is stored.
    api: bool,
    /// Whether recording can be transcribed at all.
    ready: bool,
}

fn whisper_on_path() -> Option<String> {
    WHISPER_BINARIES
        .iter()
        .find(|name| {
            Command::new(name)
                .arg("--help")
                .output()
                .map(|o| o.status.success())
                .unwrap_or(false)
        })
        .map(|name| (*name).to_string())
}

#[tauri::command]
pub fn voice_tools() -> VoiceTools {
    let whisper = whisper_on_path();
    let api = secrets::secret_get(OPENAI_KEY.to_string()).ok().flatten().is_some();

    VoiceTools { ready: whisper.is_some() || api, whisper, api }
}

/// Write the recording down: both routes need a file rather than bytes.
fn park(base64_audio: &str, extension: &str) -> Result<PathBuf, String> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(base64_audio.as_bytes())
        .map_err(|e| format!("That recording did not survive the trip: {e}"))?;

    let dir = std::env::temp_dir().join("dialect-voice");
    fs::create_dir_all(&dir).map_err(|e| format!("Could not make a place to put it: {e}"))?;

    // One name, overwritten each time: a recording is worth keeping only for as
    // long as it takes to read it.
    let path = dir.join(format!("recording.{extension}"));
    fs::write(&path, &bytes).map_err(|e| format!("Could not write the recording: {e}"))?;
    Ok(path)
}

/// Re-encode to the 16 kHz mono WAV every transcriber wants.
fn to_wav(source: &PathBuf) -> Result<PathBuf, String> {
    let target = source.with_extension("wav");

    let output = Command::new("ffmpeg")
        .args(["-v", "error", "-y", "-i"])
        .arg(source)
        .args(["-ac", "1", "-ar", "16000", "-t", &MAX_SECONDS.to_string()])
        .arg(&target)
        .output()
        .map_err(|e| format!("Could not run ffmpeg: {e}. Install ffmpeg and put it on PATH."))?;

    if !output.status.success() {
        return Err(format!(
            "ffmpeg could not read that recording: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    Ok(target)
}

fn by_whisper(binary: &str, wav: &PathBuf) -> Result<String, String> {
    let dir = wav.parent().ok_or("nowhere to put the transcript")?;

    let output = Command::new(binary)
        .arg(wav)
        .args(["--output_format", "txt", "--output_dir"])
        .arg(dir)
        // English is not assumed: an idea gets described in whatever language
        // the person thinks in, and the prompt survives either way.
        .args(["--task", "transcribe"])
        .output()
        .map_err(|e| format!("Could not run {binary}: {e}"))?;

    if !output.status.success() {
        return Err(format!(
            "{binary} could not transcribe that: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }

    // whisper writes <name>.txt beside the audio; whisper.cpp prints to stdout.
    let beside = wav.with_extension("txt");
    let text = if beside.exists() {
        let read = fs::read_to_string(&beside).unwrap_or_default();
        fs::remove_file(&beside).ok();
        read
    } else {
        String::from_utf8_lossy(&output.stdout).to_string()
    };

    Ok(text.trim().to_string())
}

async fn by_api(wav: &PathBuf) -> Result<String, String> {
    let key = secrets::secret_get(OPENAI_KEY.to_string())?
        .ok_or("No transcription key is stored. Add one in Settings.")?;
    let bytes = fs::read(wav).map_err(|e| format!("Could not read the recording back: {e}"))?;

    let part = reqwest::multipart::Part::bytes(bytes)
        .file_name("recording.wav")
        .mime_str("audio/wav")
        .map_err(|e| e.to_string())?;

    let form = reqwest::multipart::Form::new()
        .text("model", "gpt-4o-mini-transcribe")
        .part("file", part);

    let response = reqwest::Client::new()
        .post("https://api.openai.com/v1/audio/transcriptions")
        .bearer_auth(key)
        .multipart(form)
        .send()
        .await
        .map_err(|e| format!("Could not reach the transcription service: {e}"))?;

    let status = response.status();
    let body = response.text().await.map_err(|e| e.to_string())?;

    if !status.is_success() {
        // The body can carry the key back in an error echo, so only the service's
        // own message is passed on.
        let message = serde_json::from_str::<serde_json::Value>(&body)
            .ok()
            .and_then(|v| v.pointer("/error/message").and_then(|m| m.as_str()).map(String::from))
            .unwrap_or_else(|| status.to_string());
        return Err(format!("Transcription failed: {message}"));
    }

    let parsed: serde_json::Value =
        serde_json::from_str(&body).map_err(|e| format!("Unreadable answer: {e}"))?;
    Ok(parsed
        .get("text")
        .and_then(|t| t.as_str())
        .unwrap_or_default()
        .trim()
        .to_string())
}

#[tauri::command]
pub async fn voice_transcribe(base64_audio: String, extension: String) -> Result<String, String> {
    // The extension comes from the recorder's own MIME type; anything unexpected
    // is treated as the format every browser actually produces.
    let safe = if extension.chars().all(|c| c.is_ascii_alphanumeric()) && !extension.is_empty() {
        extension
    } else {
        "webm".to_string()
    };

    let recorded = park(&base64_audio, &safe)?;
    let wav = to_wav(&recorded)?;
    fs::remove_file(&recorded).ok();

    let tools = voice_tools();
    let result = match tools.whisper {
        Some(binary) => by_whisper(&binary, &wav),
        None if tools.api => by_api(&wav).await,
        None => Err(
            "Nothing here can transcribe yet. Put whisper on PATH, or add a transcription key in \
             Settings."
                .to_string(),
        ),
    };

    fs::remove_file(&wav).ok();

    match result {
        Ok(text) if text.is_empty() => Err("Nothing was said, or nothing was heard.".to_string()),
        other => other,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn writes_a_recording_down_and_names_it_by_format() {
        let encoded = base64::engine::general_purpose::STANDARD.encode(b"audio");
        let path = park(&encoded, "webm").unwrap();

        assert!(path.ends_with("recording.webm"), "{path:?}");
        assert_eq!(fs::read(&path).unwrap(), b"audio");
        fs::remove_file(&path).ok();
    }

    #[test]
    fn refuses_bytes_that_are_not_bytes() {
        assert!(park("not base64 at all!!", "webm").is_err());
    }

    #[test]
    fn says_whether_anything_here_can_transcribe() {
        let tools = voice_tools();
        // Whatever this machine has, the flag agrees with the two behind it.
        assert_eq!(tools.ready, tools.whisper.is_some() || tools.api);
    }
}
