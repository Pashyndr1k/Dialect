//! Where ffmpeg is.
//!
//! Shipped with the app when there is a copy beside it, and found on PATH when
//! there is not. That order matters: a machine that has never heard of ffmpeg
//! should still read a clip, and a machine that has its own — a developer's,
//! usually — should not be forced onto ours.
//!
//! Resolved from the executable's own location rather than from Tauri's
//! resource API, because the callers are `#[tauri::command]` functions that
//! take a path and nothing else. Threading an `AppHandle` through a dozen of
//! them to answer a question that never changes would be worse.

use std::path::PathBuf;
use std::sync::OnceLock;

/// `.exe` on Windows, nothing anywhere else.
#[cfg(windows)]
const SUFFIX: &str = ".exe";
#[cfg(not(windows))]
const SUFFIX: &str = "";

/// Where a bundled copy could be, relative to the executable.
///
/// Windows puts resources beside the binary; macOS puts them in
/// `Dialect.app/Contents/Resources`, which is one up and across from
/// `Contents/MacOS`. Both are checked everywhere rather than compiled apart —
/// it is two `exists()` calls, once, and it means a layout change does not
/// silently fall back to PATH.
fn candidates(name: &str) -> Vec<PathBuf> {
    let file = format!("{name}{SUFFIX}");
    let Ok(exe) = std::env::current_exe() else {
        return Vec::new();
    };
    let Some(dir) = exe.parent() else {
        return Vec::new();
    };

    vec![
        // Where the bundler puts `binaries/` on each platform, then the plain
        // neighbours, so a copy dropped beside the exe by hand also works.
        dir.join("binaries").join(&file),
        dir.join("../Resources/binaries").join(&file),
        dir.join(&file),
        dir.join("resources").join(&file),
        dir.join("../Resources").join(&file),
    ]
}

fn resolve(name: &str) -> String {
    for path in candidates(name) {
        if path.is_file() {
            return path.to_string_lossy().into_owned();
        }
    }
    // Not found beside us: let the operating system look.
    name.to_string()
}

static FFMPEG: OnceLock<String> = OnceLock::new();
static FFPROBE: OnceLock<String> = OnceLock::new();

/// What to pass to `Command::new`. Resolved once; the answer cannot change
/// while the app is running.
pub fn ffmpeg() -> &'static str {
    FFMPEG.get_or_init(|| resolve("ffmpeg"))
}

pub fn ffprobe() -> &'static str {
    FFPROBE.get_or_init(|| resolve("ffprobe"))
}

/// Whether the copy in use is the one shipped with the app.
///
/// Only for saying so out loud — a machine using its own ffmpeg is not a
/// problem, but it is worth being able to tell the two apart when a clip reads
/// differently here than it does somewhere else.
pub fn is_bundled(name: &str) -> bool {
    let resolved = if name == "ffprobe" { ffprobe() } else { ffmpeg() };
    resolved != name
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn falls_back_to_the_bare_name_when_nothing_is_shipped() {
        // In a test binary there is no bundle beside the executable, so both
        // must come back as something PATH can resolve rather than as an
        // invented path that would fail to launch.
        assert_eq!(ffmpeg(), "ffmpeg");
        assert_eq!(ffprobe(), "ffprobe");
        assert!(!is_bundled("ffmpeg"));
    }

    /// The half that matters: a copy that is there is the one used.
    ///
    /// Written beside the test binary, which is where `current_exe` points, so
    /// this exercises the real lookup rather than a rehearsal of it. Named
    /// something no bundle would contain, so a real ffmpeg is never shadowed.
    #[test]
    fn prefers_a_copy_shipped_beside_the_executable() {
        let dir = std::env::current_exe().unwrap().parent().unwrap().join("binaries");
        std::fs::create_dir_all(&dir).unwrap();

        let name = "dialect-test-tool";
        let path = dir.join(format!("{name}{SUFFIX}"));
        std::fs::write(&path, b"not a real program").unwrap();

        let found = resolve(name);
        let _ = std::fs::remove_file(&path);

        assert_ne!(found, name, "a shipped copy should win over PATH");
        assert!(found.ends_with(&format!("{name}{SUFFIX}")), "found {found}");
    }

    #[test]
    fn looks_beside_the_executable_and_in_both_resource_layouts() {
        let found = candidates("ffmpeg");
        assert!(!found.is_empty(), "should have somewhere to look");

        let shown: Vec<String> = found.iter().map(|p| p.to_string_lossy().into_owned()).collect();
        let joined = shown.join(" ");
        assert!(joined.contains("binaries"), "the bundled layout is covered");
        assert!(joined.contains("Resources"), "the macOS bundle layout is covered");

        // The name carries the platform's extension, or launching it fails on
        // Windows for a reason nobody would guess from the error.
        for path in &shown {
            assert!(path.ends_with(SUFFIX), "{path} should end with {SUFFIX:?}");
        }
    }
}
