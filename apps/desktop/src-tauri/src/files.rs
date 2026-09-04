//! Files the host reaches that the web view cannot.
//!
//! ffmpeg needs a path, and a web view cannot give it one. So every reference is
//! chosen rather than dropped, and the host is what reads bytes off disk, makes
//! a thumbnail of anything, and lists what a folder holds.
//!
//! What each file *is* is decided in TypeScript, from its extension, in one
//! place shared with the CLI. This side reports what it found and no more.

use std::fs;
use std::path::PathBuf;
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
    use std::sync::atomic::{AtomicUsize, Ordering};

    /// A directory nothing else is using. See the note on `channel.rs`'s copy:
    /// a fixed name emptied and remade is a race on Windows, and it is the race
    /// that failed every CI run.
    fn temp(name: &str) -> PathBuf {
        static NEXT: AtomicUsize = AtomicUsize::new(0);
        let n = NEXT.fetch_add(1, Ordering::Relaxed);
        let dir = std::env::temp_dir().join(format!(
            "dialect-files-{name}-{}-{n}",
            std::process::id()
        ));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn sorts_the_way_a_person_numbered_them() {
        let mut names = vec!["shot_10.png", "shot_2.png", "Shot_1.png", "b.png", "a.png"];
        names.sort_by(|a, b| natural(a).cmp(&natural(b)));

        assert_eq!(names, ["a.png", "b.png", "Shot_1.png", "shot_2.png", "shot_10.png"]);
    }

    #[test]
    fn reads_a_file_it_wrote() {
        let dir = temp("read");
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
    fn lists_only_the_files_directly_inside() {
        let dir = temp("scan");
        fs::create_dir_all(dir.join("nested")).unwrap();
        fs::write(dir.join("b.png"), b"x").unwrap();
        fs::write(dir.join("a.png"), b"x").unwrap();
        fs::write(dir.join("nested/deep.png"), b"x").unwrap();

        let found = folder_scan(dir.to_string_lossy().to_string()).unwrap();
        let names: Vec<&str> = found.iter().map(|f| f.name.as_str()).collect();

        assert_eq!(names, ["a.png", "b.png"], "a folder is not a file, and nested is not here");

        fs::remove_dir_all(&dir).ok();
    }
    #[test]
    fn a_folder_that_is_not_there_says_so_rather_than_failing_silently() {
        // The whole history of this button is silent refusals, so the refusals
        // are what is under test.
        let missing = temp("gone").join("not-here");
        let said = show_folder(missing.to_string_lossy().to_string()).unwrap_err();
        assert!(said.contains("no folder"), "{said}");

        let dir = temp("show");
        let file = dir.join("a.txt");
        fs::write(&file, b"x").unwrap();
        let said = show_folder(file.to_string_lossy().to_string()).unwrap_err();
        assert!(said.contains("not a folder"), "{said}");

        fs::remove_dir_all(&dir).ok();
    }
}


/// Write text to a path the person chose in a save dialog.
///
/// Deliberately not restricted to the folders this app manages: the whole point
/// of "save as" is putting a file where you want it, and a save dialog is the
/// person already having said where. What it will not do is decide the path
/// itself — that comes from the dialog, never from the web view guessing.
#[tauri::command]
pub fn file_write(path: String, text: String) -> Result<(), String> {
    if let Some(parent) = std::path::Path::new(&path).parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Could not make that folder: {e}"))?;
    }
    fs::write(&path, text).map_err(|e| format!("Could not write there: {e}"))
}

/// Show a folder in the file manager.
///
/// Done here rather than through the opener plugin, which was the third attempt
/// at this button. `opener:default` turned out not to grant `open-path` at all;
/// granting it explicitly turned out not to be enough either, because the
/// plugin scope-checks the path and `allow-open-path` is documented as enabling
/// the command *without any pre-configured scope* — an empty allow-list, which
/// denies everything. Two silent refusals from one plugin is enough. This is
/// fifteen lines, it is testable, and when it fails it says why.
#[tauri::command]
pub fn show_folder(path: String) -> Result<(), String> {
    let dir = std::path::Path::new(&path);
    if !dir.exists() {
        return Err(format!("There is no folder at {path} yet."));
    }
    if !dir.is_dir() {
        return Err(format!("{path} is a file, not a folder."));
    }

    let launched = if cfg!(target_os = "windows") {
        // Explorer answers 1 for a folder it opened perfectly well, so its exit
        // code is not evidence of anything and is deliberately not read.
        Command::new("explorer").arg(dir).spawn().map(|_| ())
    } else if cfg!(target_os = "macos") {
        Command::new("open").arg(dir).spawn().map(|_| ())
    } else {
        Command::new("xdg-open").arg(dir).spawn().map(|_| ())
    };

    launched.map_err(|e| format!("Could not open the file manager: {e}"))
}

/// Read a text file the person chose. Small files only — a graph is kilobytes,
/// and the size limit above exists so a mis-click cannot load a video as text.
#[tauri::command]
pub fn file_text(path: String) -> Result<String, String> {
    let meta = fs::metadata(&path).map_err(|e| format!("Could not open that file: {e}"))?;
    if meta.len() > 4 * 1_048_576 {
        return Err("That file is far too large to be a graph.".to_string());
    }
    fs::read_to_string(&path).map_err(|e| format!("Could not read that file: {e}"))
}
