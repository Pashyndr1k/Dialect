//! Files the host reaches that the web view cannot.
//!
//! Once a clip and a track have to arrive as paths — because ffmpeg needs a path
//! and a dropped file has none — an image picked the same way has to arrive as
//! one too, or a single button could not accept all three. So the host reads
//! bytes off disk, makes a thumbnail of anything, and lists what a folder holds.
//!
//! What each file *is* is decided in TypeScript, from its extension, in one
//! place shared with the CLI. This side reports what it found and no more.

use std::fs;
use std::process::Command;

use base64::Engine;
use serde::Serialize;

/// Past this an image is not a reference, it is a mistake — and it would have to
/// cross the bridge base64-encoded, half as big again.
const MAX_BYTES: u64 = 32 * 1024 * 1024;

/// Longest edge of a thumbnail. Enough to recognise, small enough to keep.
const THUMB_PX: u32 = 320;

#[derive(Serialize, Debug)]
pub struct FileBytes {
    /// Raw base64, no data: prefix — the shape the provider takes.
    base64: String,
    bytes: u64,
}

#[tauri::command]
pub fn file_read(path: String) -> Result<FileBytes, String> {
    let meta = fs::metadata(&path).map_err(|e| format!("Could not open that file: {e}"))?;
    if !meta.is_file() {
        return Err("That is a folder, not a file.".to_string());
    }
    if meta.len() > MAX_BYTES {
        return Err(format!(
            "That file is {} MB. References over {} MB are refused — resize it first.",
            meta.len() / 1_048_576,
            MAX_BYTES / 1_048_576
        ));
    }

    let bytes = fs::read(&path).map_err(|e| format!("Could not read that file: {e}"))?;
    Ok(FileBytes {
        base64: base64::engine::general_purpose::STANDARD.encode(&bytes),
        bytes: meta.len(),
    })
}

/// A small picture of anything: a still, the first frame of a clip, or the
/// spectrogram of a track.
///
/// One command rather than three, because the left pane wants the same thing in
/// every case — something to recognise the reference by — and ffmpeg reads all
/// three without being told which it is holding.
#[tauri::command]
pub fn file_thumb(path: String) -> Result<String, String> {
    let scale = format!("scale='min({THUMB_PX},iw)':-2");

    // A track has no picture, so one is drawn. Tried first because the still
    // filter would fail on it anyway, and this way the error that reaches the
    // window is about the file rather than about a filter.
    let attempts: [Vec<&str>; 2] = [
        vec!["-i", &path, "-vf", &scale, "-frames:v", "1"],
        vec![
            "-i",
            &path,
            "-lavfi",
            "showspectrumpic=s=320x160:mode=combined:legend=disabled:scale=log",
            "-frames:v",
            "1",
        ],
    ];

    for args in attempts {
        let output = Command::new("ffmpeg")
            .arg("-v")
            .arg("error")
            .args(&args)
            .args(["-c:v", "mjpeg", "-q:v", "5", "-f", "image2", "-"])
            .output()
            .map_err(|e| format!("Could not run ffmpeg: {e}. Install ffmpeg and put it on PATH."))?;

        if output.status.success() && !output.stdout.is_empty() {
            return Ok(base64::engine::general_purpose::STANDARD.encode(&output.stdout));
        }
    }

    Err("ffmpeg could not make a picture of that file.".to_string())
}

/// Above this, a dropped clip is not worth moving through the bridge as text.
const MAX_DROP_BYTES: usize = 96 * 1024 * 1024;

/// Park a dropped file on disk so ffmpeg can reach it.
///
/// A file dropped on the page arrives as bytes with no path, and ffmpeg cannot
/// read bytes out of a web view. Small enough, and it is worth the round trip to
/// make drag-and-drop work for a clip; large enough, and choosing it is both
/// faster and the only sane option.
#[tauri::command]
pub fn file_park(name: String, base64: String) -> Result<String, String> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(base64.as_bytes())
        .map_err(|e| format!("That file did not survive the trip: {e}"))?;

    if bytes.len() > MAX_DROP_BYTES {
        return Err(format!(
            "That file is {} MB. Drop is for small ones — choose it with the button instead.",
            bytes.len() / 1_048_576
        ));
    }

    // A plain file name, so nothing dropped can write outside this folder.
    let safe: String = name
        .chars()
        .map(|c| if c.is_alphanumeric() || c == '.' || c == '-' || c == '_' { c } else { '_' })
        .collect();
    if safe.is_empty() || safe.starts_with('.') {
        return Err("That file has no usable name.".to_string());
    }

    let dir = std::env::temp_dir().join("dialect-dropped");
    fs::create_dir_all(&dir).map_err(|e| format!("Could not make a place to put it: {e}"))?;

    // Named after the file rather than uniquely: dropping the same thing twice
    // should not leave two copies behind.
    let path = dir.join(&safe);
    fs::write(&path, &bytes).map_err(|e| format!("Could not write it down: {e}"))?;
    Ok(path.to_string_lossy().to_string())
}

#[derive(Serialize)]
pub struct Found {
    name: String,
    path: String,
    bytes: u64,
}

/// Every file directly inside a folder, by name.
///
/// Not recursive: a folder of references is a folder of references, and walking
/// into a subfolder called `old` and reading forty of them is a bill nobody
/// asked for. Which of these are readable is decided by the caller.
#[tauri::command]
pub fn folder_scan(dir: String) -> Result<Vec<Found>, String> {
    let entries =
        fs::read_dir(&dir).map_err(|e| format!("Could not open that folder: {e}"))?;

    let mut found: Vec<Found> = entries
        .filter_map(|entry| {
            let entry = entry.ok()?;
            let meta = entry.metadata().ok()?;
            if !meta.is_file() {
                return None;
            }
            let path = entry.path();
            Some(Found {
                name: path.file_name()?.to_string_lossy().to_string(),
                path: path.to_string_lossy().to_string(),
                bytes: meta.len(),
            })
        })
        .collect();

    // Sorted, so a folder of `shot_01`…`shot_12` reads in the order it was
    // named rather than the order the filesystem happened to hand back.
    found.sort_by(|a, b| natural(&a.name).cmp(&natural(&b.name)));
    Ok(found)
}

/// Sort key that puts `shot_2` before `shot_10`, by padding runs of digits.
fn natural(name: &str) -> String {
    let mut out = String::with_capacity(name.len() + 8);
    let mut digits = String::new();

    for ch in name.to_lowercase().chars() {
        if ch.is_ascii_digit() {
            digits.push(ch);
        } else {
            if !digits.is_empty() {
                out.push_str(&format!("{:0>12}", digits));
                digits.clear();
            }
            out.push(ch);
        }
    }
    if !digits.is_empty() {
        out.push_str(&format!("{:0>12}", digits));
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sorts_the_way_a_person_numbered_them() {
        let mut names = vec!["shot_10.png", "shot_2.png", "Shot_1.png", "b.png", "a.png"];
        names.sort_by(|a, b| natural(a).cmp(&natural(b)));

        assert_eq!(names, ["a.png", "b.png", "Shot_1.png", "shot_2.png", "shot_10.png"]);
    }

    #[test]
    fn reads_a_file_it_wrote() {
        let dir = std::env::temp_dir().join("dialect-files-test");
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("hello.txt");
        fs::write(&path, b"hi").unwrap();

        let read = file_read(path.to_string_lossy().to_string()).unwrap();
        assert_eq!(read.bytes, 2);
        assert_eq!(
            base64::engine::general_purpose::STANDARD.decode(&read.base64).unwrap(),
            b"hi"
        );

        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn refuses_a_folder_where_a_file_was_expected() {
        let dir = std::env::temp_dir().to_string_lossy().to_string();
        assert!(file_read(dir).unwrap_err().contains("folder, not a file"));
    }

    #[test]
    fn parks_a_dropped_file_where_ffmpeg_can_reach_it() {
        let encoded = base64::engine::general_purpose::STANDARD.encode(b"clip");
        let path = file_park("shot 1.mp4".to_string(), encoded).unwrap();

        assert!(path.ends_with("shot_1.mp4"), "the name was made safe: {path}");
        assert_eq!(fs::read(&path).unwrap(), b"clip");
        fs::remove_file(&path).ok();
    }

    #[test]
    fn refuses_a_name_that_could_write_elsewhere() {
        let encoded = base64::engine::general_purpose::STANDARD.encode(b"x");

        // Separators are flattened, and what is left reads as a dot-path, which
        // is refused outright rather than written down under a mangled name.
        assert!(file_park("../../escape.mp4".to_string(), encoded.clone()).is_err());

        // A name with a separator in the middle still writes, inside the folder.
        let path = file_park("a/b.mp4".to_string(), encoded).unwrap();
        assert!(path.ends_with("a_b.mp4"), "{path}");
        assert!(!path.contains(".."));
        fs::remove_file(&path).ok();
    }

    #[test]
    fn lists_only_the_files_directly_inside() {
        let dir = std::env::temp_dir().join("dialect-scan-test");
        fs::create_dir_all(dir.join("nested")).unwrap();
        fs::write(dir.join("b.png"), b"x").unwrap();
        fs::write(dir.join("a.png"), b"x").unwrap();
        fs::write(dir.join("nested/deep.png"), b"x").unwrap();

        let found = folder_scan(dir.to_string_lossy().to_string()).unwrap();
        let names: Vec<&str> = found.iter().map(|f| f.name.as_str()).collect();

        assert_eq!(names, ["a.png", "b.png"], "a folder is not a file, and nested is not here");

        fs::remove_dir_all(&dir).ok();
    }

}
