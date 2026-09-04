//! Whether there is a newer version, and getting you to it.
//!
//! Not an updater. Dialect used to download its own replacement and install it,
//! which meant it had to be able to tell its own build from anyone else's — so
//! every release had to be signed, which meant a private key, which meant a
//! secret in the repository and a password to keep. That is a reasonable trade
//! for software with strangers using it and a poor one for a handful of people
//! who know the person who wrote it.
//!
//! So this downloads nothing and runs nothing. It asks GitHub which release is
//! newest, and if that is newer than what is running, the window says so and
//! offers to open the releases page in a browser. Nothing that arrives over the
//! network is ever executed, so there is nothing to sign and no key to keep.
//!
//! The address is a constant here rather than a parameter. A "open this URL"
//! command that takes the URL from the web view is a command that opens any URL
//! the web view can be persuaded to ask for.

use std::process::Command;
use std::time::Duration;

use serde::{Deserialize, Serialize};

/// Where the releases are. Not configurable, deliberately — see above.
const RELEASES_API: &str = "https://api.github.com/repos/Pashyndr1k/Dialect/releases/latest";
const RELEASES_PAGE: &str = "https://github.com/Pashyndr1k/Dialect/releases/latest";

/// Long enough for a slow network, short enough that a start is never held up.
const TIMEOUT_S: u64 = 10;

#[derive(Deserialize)]
struct GithubRelease {
    tag_name: String,
    #[serde(default)]
    draft: bool,
    #[serde(default)]
    prerelease: bool,
}

#[derive(Serialize, Default)]
pub struct Latest {
    /// The newest published version, without its `v`. Empty if nothing is known.
    pub version: String,
}

/// The newest published release, or nothing.
///
/// Nothing is not an error worth showing. A machine with no network, a rate
/// limit, a repository that has never published — none of those is something
/// the person is doing, and a bar saying "could not check for updates" is a bar
/// that is wrong about what matters.
#[tauri::command]
pub async fn latest_release() -> Result<Latest, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(TIMEOUT_S))
        // GitHub refuses a request with no user agent.
        .user_agent("Dialect")
        .build()
        .map_err(|e| format!("Could not ask: {e}"))?;

    let response = client
        .get(RELEASES_API)
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .map_err(|e| format!("Could not reach GitHub: {e}"))?;

    if !response.status().is_success() {
        return Ok(Latest::default());
    }

    let release: GithubRelease = response
        .json()
        .await
        .map_err(|e| format!("GitHub's answer was not what was expected: {e}"))?;

    if release.draft || release.prerelease {
        return Ok(Latest::default());
    }

    Ok(Latest {
        version: release.tag_name.trim_start_matches('v').to_string(),
    })
}

/// Open the releases page in the browser.
#[tauri::command]
pub fn open_releases() -> Result<(), String> {
    let launched = if cfg!(target_os = "windows") {
        // Through `explorer` rather than `cmd /c start`: `start` is a shell
        // builtin and putting a URL through a shell is a thing to avoid on
        // principle, even when the URL is a constant three lines up.
        Command::new("explorer").arg(RELEASES_PAGE).spawn().map(|_| ())
    } else if cfg!(target_os = "macos") {
        Command::new("open").arg(RELEASES_PAGE).spawn().map(|_| ())
    } else {
        Command::new("xdg-open").arg(RELEASES_PAGE).spawn().map(|_| ())
    };

    launched.map_err(|e| format!("Could not open the browser: {e}"))
}

/// Whether `latest` is a later version than `running`.
///
/// Compared piece by piece as numbers, so 0.10 is after 0.9 — which string
/// comparison gets wrong, and gets wrong silently, by never mentioning a
/// release again after the tenth.
pub fn is_newer(latest: &str, running: &str) -> bool {
    let parts = |v: &str| -> Vec<u64> {
        v.split(['.', '-', '+'])
            .map(|p| p.parse::<u64>().unwrap_or(0))
            .collect()
    };

    let (a, b) = (parts(latest), parts(running));
    for i in 0..a.len().max(b.len()) {
        let (x, y) = (a.get(i).copied().unwrap_or(0), b.get(i).copied().unwrap_or(0));
        if x != y {
            return x > y;
        }
    }
    false
}

#[tauri::command]
pub fn newer_than(latest: String, running: String) -> bool {
    is_newer(&latest, &running)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn compares_versions_as_numbers_not_as_text() {
        assert!(is_newer("0.41", "0.40"));
        assert!(is_newer("1.0", "0.40"));
        // The one string comparison gets wrong, and gets wrong for ever after.
        assert!(is_newer("0.10", "0.9"));
        assert!(is_newer("0.40.1", "0.40"));
    }

    #[test]
    fn the_same_version_is_not_newer() {
        assert!(!is_newer("0.40", "0.40"));
        assert!(!is_newer("0.40", "0.40.0"));
        assert!(!is_newer("0.40.0", "0.40"));
    }

    #[test]
    fn an_older_release_is_never_offered() {
        assert!(!is_newer("0.39", "0.40"));
        assert!(!is_newer("0.9", "0.10"));
    }

    #[test]
    fn nonsense_is_not_newer_rather_than_a_panic() {
        // Whatever a tag turns out to say, the answer is a bool and the window
        // carries on. A bar offering an update to "" helps nobody.
        assert!(!is_newer("", "0.40"));
        assert!(!is_newer("banana", "0.40"));
        assert!(!is_newer("v-what", "0.40"));
    }
}
