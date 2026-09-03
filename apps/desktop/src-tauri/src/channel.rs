//! Card sets that arrive after the build.
//!
//! Model cards are dated. The formula a model wants this month is not the one
//! it wanted last, and a card is the only thing standing between that change and
//! a wrong prompt — so the set has to be replaceable without a new binary.
//!
//! A set is a folder or a URL holding `.yaml` cards, and optionally a
//! `manifest.json` naming the set and its version so the panel can say which one
//! is installed and refuse to go backwards by accident.
//!
//! It used to require an Ed25519 signature from a key you had trusted first.
//! That was the wrong shape for what this is. A card is a formula written in
//! plain YAML that you can read, edit and delete in the panel next door; the
//! folder it lands in is one you can open in Explorer. Asking someone to obtain
//! and paste a 64-character public key before they can add one is a ritual, not
//! a protection — and a lock on a door that stands open beside it mostly teaches
//! people that the locks here do not mean anything.
//!
//! Nothing is ever half-installed. A set is fetched whole, staged, and only then
//! swapped in — a broken install leaves the working one exactly where it was.

use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::Manager;

const MANIFEST: &str = "manifest.json";

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Manifest {
    /// Which set this is. A set for one thing must not overwrite another.
    channel: String,
    /// Monotonic. An older set is not installed over a newer one by accident.
    version: u32,
    published: String,
    /// The cards, by file name.
    files: Vec<String>,
}

#[derive(Serialize, Default)]
pub struct ChannelStatus {
    channel: Option<String>,
    version: Option<u32>,
    published: Option<String>,
    /// How many cards the installed set holds.
    cards: usize,
    /// Where it came from, as it was given.
    source: Option<String>,
}

fn app_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map_err(|e| format!("Nowhere to keep card sets: {e}"))
}

fn installed_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app_dir(app)?.join("models"))
}

fn source_file(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app_dir(app)?.join("models-source.txt"))
}

// ---------------------------------------------------------------------------
// What is installed
// ---------------------------------------------------------------------------

fn read_manifest(dir: &Path) -> Option<Manifest> {
    serde_json::from_slice(&fs::read(dir.join(MANIFEST)).ok()?).ok()
}

#[tauri::command]
pub fn channel_status(app: tauri::AppHandle) -> Result<ChannelStatus, String> {
    let dir = installed_dir(&app)?;
    let manifest = read_manifest(&dir);

    Ok(ChannelStatus {
        cards: manifest.as_ref().map_or(0, |m| m.files.len()),
        channel: manifest.as_ref().map(|m| m.channel.clone()),
        version: manifest.as_ref().map(|m| m.version),
        published: manifest.as_ref().map(|m| m.published.clone()),
        source: fs::read_to_string(source_file(&app)?).ok(),
    })
}

/// Every installed card, for the window to merge over the built-in set.
#[tauri::command]
pub fn channel_cards(app: tauri::AppHandle) -> Result<Vec<(String, String)>, String> {
    let dir = installed_dir(&app)?;
    let Some(manifest) = read_manifest(&dir) else {
        return Ok(vec![]);
    };

    Ok(manifest
        .files
        .iter()
        .filter_map(|name| Some((name.clone(), fs::read_to_string(dir.join(name)).ok()?)))
        .collect())
}

// ---------------------------------------------------------------------------
// Fetching
// ---------------------------------------------------------------------------

/// A set comes from a URL or from a folder — the same bytes either way.
///
/// A folder is not a lesser case: it is how a set arrives on a machine that is
/// not online, and how one is tested before it is published.
async fn fetch(source: &str, name: &str) -> Result<Vec<u8>, String> {
    if source.starts_with("http://") || source.starts_with("https://") {
        let url = format!("{}/{name}", source.trim_end_matches('/'));
        let response = reqwest::get(&url)
            .await
            .map_err(|e| format!("Could not reach {url}: {e}"))?;

        if !response.status().is_success() {
            return Err(format!("{url} answered {}", response.status()));
        }
        return Ok(response
            .bytes()
            .await
            .map_err(|e| format!("Could not read {url}: {e}"))?
            .to_vec());
    }

    // A name from a manifest becomes a path, so it has to be a name.
    if name.contains('/') || name.contains('\\') || name.contains("..") {
        return Err(format!("\"{name}\" is not a usable file name."));
    }
    fs::read(Path::new(source).join(name)).map_err(|e| format!("Could not read {name}: {e}"))
}

// ---------------------------------------------------------------------------
// Installing
// ---------------------------------------------------------------------------

#[derive(Serialize)]
pub struct Checked {
    channel: String,
    version: u32,
    published: String,
    cards: usize,
    /// True when this set is not newer than the one already installed.
    stale: bool,
}

/// What a set says it is.
///
/// A `manifest.json` if it has one. If it does not — and a folder of cards
/// someone put together by hand will not — one is made up from the `.yaml`
/// files that are actually there, so "a folder of cards" is a set like any
/// other rather than an error about a file nobody asked for.
async fn read_set(source: &str) -> Result<Manifest, String> {
    if let Ok(bytes) = fetch(source, MANIFEST).await {
        return serde_json::from_slice(&bytes)
            .map_err(|e| format!("That set's manifest could not be read: {e}"));
    }

    // Only a folder can be listed; a web address has to say what it holds.
    if source.starts_with("http://") || source.starts_with("https://") {
        return Err(format!(
            "{} has no {MANIFEST}, and a web address cannot be listed. Point at a folder instead, or publish a manifest.",
            source.trim_end_matches('/')
        ));
    }

    let files = cards_in(Path::new(source))?;
    if files.is_empty() {
        return Err(format!("No .yaml cards in {source}."));
    }

    Ok(Manifest {
        channel: "cards".to_string(),
        // Unnumbered, so an unversioned folder never blocks the next one for
        // being older than something that was never numbered either.
        version: 0,
        published: String::new(),
        files,
    })
}

/// The `.yaml` files directly inside a folder, by name.
fn cards_in(dir: &Path) -> Result<Vec<String>, String> {
    let entries = fs::read_dir(dir).map_err(|e| format!("Could not open {}: {e}", dir.display()))?;

    let mut found: Vec<String> = entries
        .filter_map(|entry| {
            let path = entry.ok()?.path();
            let extension = path.extension()?.to_str()?;
            if extension != "yaml" && extension != "yml" {
                return None;
            }
            Some(path.file_name()?.to_string_lossy().to_string())
        })
        .collect();
    found.sort();
    Ok(found)
}

/// Look, without installing. Says what is on offer and whether it is newer.
#[tauri::command]
pub async fn channel_check(app: tauri::AppHandle, source: String) -> Result<Checked, String> {
    let manifest = read_set(&source).await?;
    let installed = read_manifest(&installed_dir(&app)?);

    Ok(Checked {
        stale: installed.as_ref().is_some_and(|i| {
            i.channel == manifest.channel && i.version > 0 && i.version >= manifest.version
        }),
        cards: manifest.files.len(),
        channel: manifest.channel,
        version: manifest.version,
        published: manifest.published,
    })
}

#[tauri::command]
pub async fn channel_install(
    app: tauri::AppHandle,
    source: String,
    force: bool,
) -> Result<ChannelStatus, String> {
    install_into(&installed_dir(&app)?, &source, force).await?;
    fs::write(source_file(&app)?, &source).ok();
    channel_status(app)
}

/// Fill a staging folder with the whole set. Never touches the live one.
async fn stage(staging: &Path, manifest: &Manifest, source: &str) -> Result<(), String> {
    for name in &manifest.files {
        // A name out of a manifest becomes a path here, so it is checked the
        // same way a card of your own is. This is not about trusting whoever
        // wrote the set — it is about not writing outside the folder.
        card_name(name)?;

        let bytes = fetch(source, name).await?;
        fs::write(staging.join(name), &bytes)
            .map_err(|e| format!("Could not write {name}: {e}"))?;
    }

    // Written from what was actually installed, so the set on disk always
    // describes itself even when it arrived as a bare folder of cards.
    let manifest_bytes = serde_json::to_vec(manifest)
        .map_err(|e| format!("Could not record what was installed: {e}"))?;
    fs::write(staging.join(MANIFEST), &manifest_bytes)
        .map_err(|e| format!("Could not write the manifest: {e}"))
}

/// Fetch and swap in — the whole of installing, without the app.
///
/// Separated so it can be tested against a real set on disk. What it guarantees
/// is that `dir` is either the set that was there before or the whole of the new
/// one, and never a mixture.
pub async fn install_into(dir: &Path, source: &str, force: bool) -> Result<Manifest, String> {
    let manifest = read_set(source).await?;

    if let Some(installed) = read_manifest(dir) {
        if installed.channel == manifest.channel
            && installed.version > 0
            && installed.version >= manifest.version
            && !force
        {
            return Err(format!(
                "Version {} is already installed; that set is version {}.",
                installed.version, manifest.version
            ));
        }
    }

    if manifest.files.is_empty() {
        return Err("That set has no cards in it.".to_string());
    }

    // Staged whole, then swapped. A set that fails halfway through leaves the
    // working one untouched, which is the only reason this is worth doing.
    let staging = dir.with_extension("staging");
    let _ = fs::remove_dir_all(&staging);
    fs::create_dir_all(&staging).map_err(|e| format!("Could not stage the set: {e}"))?;

    // Every way out of `stage` goes through here, so a half-written set is
    // always cleared up. It used to be cleared only on the one failure the
    // tests happened to cover, and every other failure left a `models.staging`
    // folder on disk for ever.
    if let Err(why) = stage(&staging, &manifest, source).await {
        let _ = fs::remove_dir_all(&staging);
        return Err(why);
    }

    let previous = dir.with_extension("previous");
    let _ = fs::remove_dir_all(&previous);
    if dir.exists() {
        fs::rename(&dir, &previous).map_err(|e| format!("Could not put the old set aside: {e}"))?;
    }
    if let Err(e) = fs::rename(&staging, &dir) {
        // Put back what was there rather than leaving nothing.
        let _ = fs::rename(&previous, &dir);
        return Err(format!("Could not swap the new set in: {e}"));
    }
    let _ = fs::remove_dir_all(&previous);

    Ok(manifest)
}

/// Back to the cards this build shipped with.
#[tauri::command]
pub fn channel_revert(app: tauri::AppHandle) -> Result<ChannelStatus, String> {
    let dir = installed_dir(&app)?;
    match fs::remove_dir_all(&dir) {
        Ok(()) => {}
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(e) => return Err(format!("Could not remove the installed set: {e}")),
    }
    let _ = fs::remove_file(source_file(&app)?);
    channel_status(app)
}

/// Where cards someone wrote themselves are read from.
#[tauri::command]
pub fn cards_folder(app: tauri::AppHandle) -> Result<String, String> {
    let dir = app_dir(&app)?.join("my-models");
    fs::create_dir_all(&dir).map_err(|e| format!("Could not make the folder: {e}"))?;
    Ok(dir.to_string_lossy().to_string())
}

/// Cards someone wrote themselves. Unsigned, because they are the author.
#[tauri::command]
pub fn my_cards(app: tauri::AppHandle) -> Result<Vec<(String, String)>, String> {
    let dir = PathBuf::from(cards_folder(app)?);
    let Ok(entries) = fs::read_dir(&dir) else {
        return Ok(vec![]);
    };

    let mut out: Vec<(String, String)> = entries
        .filter_map(|entry| {
            let path = entry.ok()?.path();
            let extension = path.extension()?.to_str()?;
            if extension != "yaml" && extension != "yml" {
                return None;
            }
            Some((
                path.file_name()?.to_string_lossy().to_string(),
                fs::read_to_string(&path).ok()?,
            ))
        })
        .collect();

    out.sort_by(|a, b| a.0.cmp(&b.0));
    Ok(out)
}

/// One card of your own, written into the my-models folder.
///
/// The name is a file name and nothing else — no slashes, no `..`, and it ends
/// in `.yaml`. The web view names the file, and a web view that can name a path
/// can name any path, so the naming happens here where it can be refused.
#[tauri::command]
pub fn my_card_save(app: tauri::AppHandle, name: String, text: String) -> Result<String, String> {
    let file = card_file(&app, &name)?;
    fs::write(&file, text).map_err(|e| format!("Could not write the card: {e}"))?;
    Ok(file.to_string_lossy().to_string())
}

/// One of your own cards, removed. Built-in and installed cards are not here
/// and cannot be reached from here — the folder is fixed.
#[tauri::command]
pub fn my_card_delete(app: tauri::AppHandle, name: String) -> Result<(), String> {
    let file = card_file(&app, &name)?;
    if !file.exists() {
        return Ok(());
    }
    fs::remove_file(&file).map_err(|e| format!("Could not remove the card: {e}"))
}

/// A file name that is a name, or a refusal. Kept separate from the path so it
/// can be tested without a running app.
fn card_name(name: &str) -> Result<&str, String> {
    let name = name.trim();
    if name.is_empty() {
        return Err("A card needs a file name.".to_string());
    }
    if name.contains(['/', '\\', ':']) || name.contains("..") {
        return Err("A card's file name is a name, not a path.".to_string());
    }
    if !name.ends_with(".yaml") && !name.ends_with(".yml") {
        return Err("A card is a .yaml file.".to_string());
    }
    Ok(name)
}

/// A file name turned into a path inside the my-models folder, or a refusal.
fn card_file(app: &tauri::AppHandle, name: &str) -> Result<PathBuf, String> {
    Ok(PathBuf::from(cards_folder(app.clone())?).join(card_name(name)?))
}


#[cfg(test)]
mod tests {
    use super::*;

    fn temp(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("dialect-channel-{name}"));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// A set with a manifest, as a publisher would put one together.
    fn write_set(dir: &Path, version: u32, cards: &[(&str, &str)]) {
        fs::create_dir_all(dir).unwrap();
        let files: Vec<String> = cards
            .iter()
            .map(|(name, body)| {
                fs::write(dir.join(name), body).unwrap();
                (*name).to_string()
            })
            .collect();

        let manifest = Manifest {
            channel: "dialect-models".to_string(),
            version,
            published: "2026-08-30".to_string(),
            files,
        };
        fs::write(dir.join(MANIFEST), serde_json::to_vec(&manifest).unwrap()).unwrap();
    }

    fn install(into: &Path, from: &Path, force: bool) -> Result<Manifest, String> {
        tauri::async_runtime::block_on(install_into(into, &from.to_string_lossy(), force))
    }

    #[test]
    fn installs_a_set_that_has_a_manifest() {
        let from = temp("install-from");
        let into = temp("install-into").join("models");
        write_set(&from, 1, &[("a.yaml", "id: a\n"), ("b.yaml", "id: b\n")]);

        let manifest = install(&into, &from, false).unwrap();
        assert_eq!(manifest.version, 1);
        assert_eq!(fs::read_to_string(into.join("a.yaml")).unwrap(), "id: a\n");
        assert!(into.join(MANIFEST).exists(), "the manifest is kept, so the set knows what it is");

        fs::remove_dir_all(from.parent().unwrap()).ok();
        fs::remove_dir_all(into.parent().unwrap()).ok();
    }

    /// The case the signing requirement made impossible: a folder of cards.
    #[test]
    fn installs_a_plain_folder_of_cards_with_no_manifest_at_all() {
        let from = temp("plain-from");
        let into = temp("plain-into").join("models");
        fs::write(from.join("b.yaml"), "id: b\n").unwrap();
        fs::write(from.join("a.yaml"), "id: a\n").unwrap();
        fs::write(from.join("notes.txt"), "not a card").unwrap();

        let manifest = install(&into, &from, false).unwrap();
        assert_eq!(manifest.files, ["a.yaml", "b.yaml"], "sorted, and only the cards");
        assert!(!into.join("notes.txt").exists(), "a text file is not a card");
        assert_eq!(fs::read_to_string(into.join("a.yaml")).unwrap(), "id: a\n");

        fs::remove_dir_all(from.parent().unwrap()).ok();
        fs::remove_dir_all(into.parent().unwrap()).ok();
    }

    #[test]
    fn an_empty_folder_is_not_a_card_set() {
        let from = temp("empty-from");
        let into = temp("empty-into").join("models");

        let refused = install(&into, &from, false).unwrap_err();
        assert!(refused.contains("No .yaml cards"), "{refused}");
        assert!(!into.exists(), "nothing was written");

        fs::remove_dir_all(from.parent().unwrap()).ok();
    }

    /// A manifest naming a path rather than a file name would write outside the
    /// folder. Dropping the signature does not make that acceptable.
    #[test]
    fn a_manifest_name_cannot_reach_out_of_its_folder() {
        let dir = temp("escape");
        fs::write(dir.join("safe.yaml"), "id: a\n").unwrap();
        let source = dir.to_string_lossy().to_string();

        let refused = tauri::async_runtime::block_on(fetch(&source, "../secrets.txt"));
        assert!(refused.unwrap_err().contains("not a usable file name"));

        assert!(tauri::async_runtime::block_on(fetch(&source, "safe.yaml")).is_ok());
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn a_broken_set_does_not_replace_a_working_one() {
        let good = temp("survive-good");
        let bad = temp("survive-bad");
        let into = temp("survive-into").join("models");

        write_set(&good, 1, &[("a.yaml", "id: a\nlabel: the good one\n")]);
        install(&into, &good, false).unwrap();

        // A manifest naming a card that is not there.
        write_set(&bad, 2, &[("a.yaml", "id: a\n")]);
        let mut manifest = read_manifest(&bad).unwrap();
        manifest.files.push("missing.yaml".to_string());
        fs::write(bad.join(MANIFEST), serde_json::to_vec(&manifest).unwrap()).unwrap();

        assert!(install(&into, &bad, false).is_err());
        assert_eq!(
            fs::read_to_string(into.join("a.yaml")).unwrap(),
            "id: a\nlabel: the good one\n",
        );
        assert_eq!(read_manifest(&into).unwrap().version, 1);
        assert!(!into.with_extension("staging").exists(), "no half-installed set left behind");

        for d in [&good, &bad] {
            fs::remove_dir_all(d.parent().unwrap()).ok();
        }
        fs::remove_dir_all(into.parent().unwrap()).ok();
    }

    #[test]
    fn will_not_go_backwards_unless_told_to() {
        let older = temp("down-older");
        let newer = temp("down-newer");
        let into = temp("down-into").join("models");

        write_set(&newer, 5, &[("a.yaml", "id: a\nlabel: five\n")]);
        write_set(&older, 2, &[("a.yaml", "id: a\nlabel: two\n")]);

        install(&into, &newer, false).unwrap();
        let refused = install(&into, &older, false).unwrap_err();
        assert!(refused.contains("Version 5 is already installed"), "{refused}");
        assert_eq!(read_manifest(&into).unwrap().version, 5);

        // Forced, it goes back — for getting off a set that turned out wrong.
        install(&into, &older, true).unwrap();
        assert_eq!(read_manifest(&into).unwrap().version, 2);

        for d in [&older, &newer] {
            fs::remove_dir_all(d.parent().unwrap()).ok();
        }
        fs::remove_dir_all(into.parent().unwrap()).ok();
    }

    /// An unnumbered folder is version 0, and 0 blocks nothing — otherwise two
    /// hand-made folders in a row would refuse each other for being equally old.
    #[test]
    fn an_unnumbered_folder_never_blocks_the_next_one() {
        let first = temp("unnum-first");
        let second = temp("unnum-second");
        let into = temp("unnum-into").join("models");

        fs::write(first.join("a.yaml"), "id: a\nlabel: first\n").unwrap();
        fs::write(second.join("a.yaml"), "id: a\nlabel: second\n").unwrap();

        install(&into, &first, false).unwrap();
        install(&into, &second, false).unwrap();
        assert!(fs::read_to_string(into.join("a.yaml")).unwrap().contains("second"));

        for d in [&first, &second] {
            fs::remove_dir_all(d.parent().unwrap()).ok();
        }
        fs::remove_dir_all(into.parent().unwrap()).ok();
    }

    #[test]
    fn a_second_install_replaces_rather_than_accumulates() {
        let first = temp("swap-first");
        let second = temp("swap-second");
        let into = temp("swap-into").join("models");

        write_set(&first, 1, &[("gone.yaml", "id: gone\n"), ("kept.yaml", "id: kept\n")]);
        install(&into, &first, false).unwrap();

        write_set(&second, 2, &[("kept.yaml", "id: kept\nlabel: newer\n")]);
        install(&into, &second, false).unwrap();

        assert!(!into.join("gone.yaml").exists(), "a card dropped from the set is gone");
        assert!(fs::read_to_string(into.join("kept.yaml")).unwrap().contains("newer"));

        for d in [&first, &second] {
            fs::remove_dir_all(d.parent().unwrap()).ok();
        }
        fs::remove_dir_all(into.parent().unwrap()).ok();
    }

    #[test]
    fn a_card_of_your_own_is_named_not_addressed() {
        // The web view supplies this name, and a web view that can name a path
        // can name any path — so the refusals matter more than the acceptance.
        for bad in [
            "",
            "   ",
            "card.yaml.txt",
            "notes.txt",
            "../../secrets.yaml",
            "sub/card.yaml",
            "C:\\Windows\\evil.yaml",
        ] {
            assert!(card_name(bad).is_err(), "{bad} should not be a card name");
        }

        assert_eq!(card_name(" mine.yaml ").unwrap(), "mine.yaml");
        assert_eq!(card_name("mine.yml").unwrap(), "mine.yml");
    }
}
