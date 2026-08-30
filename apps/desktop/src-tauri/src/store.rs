//! What survives closing the window.
//!
//! Two things, for two different reasons.
//!
//! The cache holds answers that were paid for. Keyed by the hash of the image
//! and the question, so re-reading a reference the app has seen before costs
//! nothing — which is the whole reason it exists, and the reason it has to
//! outlive the process.
//!
//! The session holds what the window was showing: which references were read
//! and what came back. The files themselves cannot be kept — a dropped file is
//! gone once the page reloads — so this is a record, not a resumable job.
//!
//! The library is what makes the cache usable. Cache entries are keyed by a
//! hash and hold only an answer: no name, no picture, nothing a person could
//! recognise. The library is the index over them — what each one was called,
//! when it was read, and a thumbnail small enough to keep — so a reference read
//! last week can be found and brought back instead of paid for twice.

use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

/// The gateway's keys are sha256 hex. Anything else is not ours to write, and
/// is the shape a path traversal would arrive in.
fn checked_key(key: &str) -> Result<&str, String> {
    let ok = key.len() == 64 && key.bytes().all(|b| b.is_ascii_hexdigit());
    if ok {
        Ok(key)
    } else {
        Err(format!("Not a cache key: {key}"))
    }
}

fn data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map_err(|e| format!("No place to keep data: {e}"))
}

fn cache_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = data_dir(app)?.join("cache");
    fs::create_dir_all(&dir).map_err(|e| format!("Could not make the cache directory: {e}"))?;
    Ok(dir)
}

/// Everything below takes a directory rather than an `AppHandle`, so it can be
/// tested against a real one. The commands only resolve where that is.
pub fn read_entry(dir: &Path, key: &str) -> Result<Option<String>, String> {
    let path = dir.join(format!("{}.json", checked_key(key)?));
    match fs::read_to_string(&path) {
        Ok(text) => Ok(Some(text)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(format!("Could not read a cached answer: {e}")),
    }
}

pub fn write_entry(dir: &Path, key: &str, value: &str) -> Result<(), String> {
    let path = dir.join(format!("{}.json", checked_key(key)?));

    // Written aside and renamed, so a crash mid-write leaves the old entry or
    // none — never half of one, which would fail to parse forever.
    let temp = dir.join(format!("{}.{}.tmp", checked_key(key)?, std::process::id()));
    fs::write(&temp, value).map_err(|e| format!("Could not write a cached answer: {e}"))?;
    fs::rename(&temp, &path).map_err(|e| format!("Could not store a cached answer: {e}"))
}

#[tauri::command]
pub fn cache_get(app: AppHandle, key: String) -> Result<Option<String>, String> {
    read_entry(&cache_dir(&app)?, &key)
}

#[tauri::command]
pub fn cache_set(app: AppHandle, key: String, value: String) -> Result<(), String> {
    write_entry(&cache_dir(&app)?, &key, &value)
}

#[derive(Serialize)]
pub struct CacheStats {
    entries: u64,
    bytes: u64,
}

/// What the cache is holding, so the settings panel can say what clearing costs.
pub fn stats_in(dir: &Path) -> Result<CacheStats, String> {
    let mut stats = CacheStats { entries: 0, bytes: 0 };

    for entry in fs::read_dir(dir).map_err(|e| format!("Could not read the cache: {e}"))? {
        let entry = entry.map_err(|e| format!("Could not read the cache: {e}"))?;
        if entry.path().extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }
        if let Ok(meta) = entry.metadata() {
            stats.entries += 1;
            stats.bytes += meta.len();
        }
    }
    Ok(stats)
}

#[tauri::command]
pub fn cache_stats(app: AppHandle) -> Result<CacheStats, String> {
    stats_in(&cache_dir(&app)?)
}

pub fn clear_in(dir: &Path) -> Result<u64, String> {
    let mut removed = 0;

    for entry in fs::read_dir(dir).map_err(|e| format!("Could not read the cache: {e}"))? {
        let entry = entry.map_err(|e| format!("Could not read the cache: {e}"))?;
        if entry.path().extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }
        if fs::remove_file(entry.path()).is_ok() {
            removed += 1;
        }
    }
    Ok(removed)
}

#[tauri::command]
pub fn cache_clear(app: AppHandle) -> Result<u64, String> {
    let removed = clear_in(&cache_dir(&app)?)?;
    // The index without the answers it points at is worse than neither.
    write_library(&library_path(&app)?, "[]")?;
    Ok(removed)
}

// ---------------------------------------------------------------------------
// The library: what the cache is holding, in terms a person recognises
// ---------------------------------------------------------------------------

fn library_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = data_dir(app)?;
    fs::create_dir_all(&dir).map_err(|e| format!("Could not make the data directory: {e}"))?;
    Ok(dir.join("library.json"))
}

pub fn read_library(path: &Path) -> Result<String, String> {
    match fs::read_to_string(path) {
        Ok(text) => Ok(text),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok("[]".to_string()),
        Err(e) => Err(format!("Could not read the library: {e}")),
    }
}

pub fn write_library(path: &Path, value: &str) -> Result<(), String> {
    let temp = path.with_extension("tmp");
    fs::write(&temp, value).map_err(|e| format!("Could not write the library: {e}"))?;
    fs::rename(&temp, path).map_err(|e| format!("Could not store the library: {e}"))
}

#[tauri::command]
pub fn library_get(app: AppHandle) -> Result<String, String> {
    read_library(&library_path(&app)?)
}

#[tauri::command]
pub fn library_set(app: AppHandle, value: String) -> Result<(), String> {
    write_library(&library_path(&app)?, &value)
}

// ---------------------------------------------------------------------------
// The session
// ---------------------------------------------------------------------------

fn session_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = data_dir(app)?;
    fs::create_dir_all(&dir).map_err(|e| format!("Could not make the data directory: {e}"))?;
    Ok(dir.join("session.json"))
}

pub fn read_session(path: &Path) -> Result<Option<String>, String> {
    match fs::read_to_string(path) {
        Ok(text) => Ok(Some(text)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(format!("Could not read the last session: {e}")),
    }
}

pub fn write_session(path: &Path, value: &str) -> Result<(), String> {
    let temp = path.with_extension("tmp");
    fs::write(&temp, value).map_err(|e| format!("Could not write the session: {e}"))?;
    fs::rename(&temp, path).map_err(|e| format!("Could not store the session: {e}"))
}

pub fn remove_session(path: &Path) -> Result<(), String> {
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(format!("Could not clear the session: {e}")),
    }
}

#[tauri::command]
pub fn session_get(app: AppHandle) -> Result<Option<String>, String> {
    read_session(&session_path(&app)?)
}

#[tauri::command]
pub fn session_set(app: AppHandle, value: String) -> Result<(), String> {
    write_session(&session_path(&app)?, &value)
}

#[tauri::command]
pub fn session_clear(app: AppHandle) -> Result<(), String> {
    remove_session(&session_path(&app)?)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("dialect-store-{}-{name}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    const KEY: &str = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    const OTHER: &str = "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210";

    #[test]
    fn only_accepts_the_shape_the_gateway_produces() {
        assert!(checked_key(KEY).is_ok());

        // The bad shapes include the one a path traversal would arrive in.
        for bad in ["", "abc", "../../etc/passwd", &"g".repeat(64), &"a".repeat(63)] {
            assert!(checked_key(bad).is_err(), "{bad} should have been refused");
        }
    }

    #[test]
    fn an_answer_survives_being_written_and_read_back() {
        let dir = scratch("roundtrip");

        assert_eq!(read_entry(&dir, KEY).unwrap(), None);

        write_entry(&dir, KEY, r#"{"headline":"a bottle"}"#).unwrap();
        assert_eq!(
            read_entry(&dir, KEY).unwrap().as_deref(),
            Some(r#"{"headline":"a bottle"}"#)
        );

        // Overwriting keeps the latest, not both.
        write_entry(&dir, KEY, r#"{"headline":"a different bottle"}"#).unwrap();
        assert!(read_entry(&dir, KEY).unwrap().unwrap().contains("different"));

        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn leaves_no_temporary_file_behind() {
        let dir = scratch("temp");
        write_entry(&dir, KEY, "{}").unwrap();

        let names: Vec<String> = fs::read_dir(&dir)
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
            .collect();

        assert_eq!(names, vec![format!("{KEY}.json")]);
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn a_session_survives_being_written_and_read_back() {
        let dir = scratch("session");
        let path = dir.join("session.json");

        // Nothing yet is not an error; it is a first run.
        assert_eq!(read_session(&path).unwrap(), None);

        write_session(&path, r#"{"version":1,"target":"nano-banana-2"}"#).unwrap();
        assert!(read_session(&path).unwrap().unwrap().contains("nano-banana-2"));

        // The next write replaces it rather than appending.
        write_session(&path, r#"{"version":1,"target":"kling-3-omni"}"#).unwrap();
        let text = read_session(&path).unwrap().unwrap();
        assert!(text.contains("kling-3-omni"));
        assert!(!text.contains("nano-banana-2"));

        remove_session(&path).unwrap();
        assert_eq!(read_session(&path).unwrap(), None);
        // Clearing something already gone is not an error.
        remove_session(&path).unwrap();

        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn only_writes_plain_file_names() {
        for good in ["a.txt", "ref-001_nano-banana-2.txt", "shot 3.ir.json"] {
            assert!(checked_name(good).is_ok(), "{good} should have been allowed");
        }
        // The web view builds these from a naming pattern, which is exactly
        // where a stray separator or a parent reference would come from.
        for bad in ["", "..", "../out.txt", "a/b.txt", "a\\b.txt", "C:evil.txt"] {
            assert!(checked_name(bad).is_err(), "{bad} should have been refused");
        }
    }

    #[test]
    fn writes_a_whole_batch_into_a_folder_it_makes() {
        let dir = scratch("save").join("prompts");

        let files = vec![
            OutFile { name: "one.txt".into(), contents: "first prompt".into() },
            OutFile { name: "one.ir.json".into(), contents: "{}".into() },
        ];
        assert_eq!(write_all(&dir, &files).unwrap(), 2);

        assert_eq!(fs::read_to_string(dir.join("one.txt")).unwrap(), "first prompt");
        assert!(dir.join("one.ir.json").exists());

        // One bad name refuses the write rather than half-writing the batch.
        let bad = vec![OutFile { name: "../escape.txt".into(), contents: "x".into() }];
        assert!(write_all(&dir, &bad).is_err());

        fs::remove_dir_all(dir.parent().unwrap()).unwrap();
    }

    #[test]
    fn the_library_starts_empty_rather_than_missing() {
        let dir = scratch("library");
        let path = dir.join("library.json");

        // A first run has no file, and that is an empty library, not an error.
        assert_eq!(read_library(&path).unwrap(), "[]");

        write_library(&path, r#"[{"key":"abc","ref":"one.png"}]"#).unwrap();
        assert!(read_library(&path).unwrap().contains("one.png"));

        write_library(&path, "[]").unwrap();
        assert_eq!(read_library(&path).unwrap(), "[]");

        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn counts_and_clears_what_it_holds() {
        let dir = scratch("stats");
        write_entry(&dir, KEY, "{\"a\":1}").unwrap();
        write_entry(&dir, OTHER, "{\"b\":2}").unwrap();

        let stats = stats_in(&dir).unwrap();
        assert_eq!(stats.entries, 2);
        assert!(stats.bytes > 0);

        assert_eq!(clear_in(&dir).unwrap(), 2);
        assert_eq!(stats_in(&dir).unwrap().entries, 0);
        assert_eq!(read_entry(&dir, KEY).unwrap(), None);

        fs::remove_dir_all(&dir).unwrap();
    }
}

// ---------------------------------------------------------------------------
// Saving prompts
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
pub struct OutFile {
    name: String,
    contents: String,
}

/// Refuses anything that is not a plain file name. The web view chooses these
/// from a naming pattern, and a pattern is exactly where a stray `..` or a
/// second directory separator would come from.
fn checked_name(name: &str) -> Result<&str, String> {
    let bad = name.is_empty()
        || name.contains("..")
        || name.contains('/')
        || name.contains('\\')
        || name.contains(':');
    if bad {
        Err(format!("Not a file name: {name}"))
    } else {
        Ok(name)
    }
}

pub fn write_all(dir: &Path, files: &[OutFile]) -> Result<u64, String> {
    fs::create_dir_all(dir).map_err(|e| format!("Could not use that folder: {e}"))?;

    let mut written = 0;
    for file in files {
        let path = dir.join(checked_name(&file.name)?);
        fs::write(&path, &file.contents)
            .map_err(|e| format!("Could not write {}: {e}", file.name))?;
        written += 1;
    }
    Ok(written)
}

#[tauri::command]
pub fn save_prompts(dir: String, files: Vec<OutFile>) -> Result<u64, String> {
    write_all(Path::new(&dir), &files)
}
