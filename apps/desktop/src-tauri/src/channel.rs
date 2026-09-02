//! Card sets that arrive after the build.
//!
//! Model cards are dated. The formula a model wants this month is not the one
//! it wanted last, and a card is the only thing standing between that change and
//! a wrong prompt — so the set has to be replaceable without a new binary.
//!
//! Which makes it a supply chain. A card decides what every prompt says: its
//! field list *is* the formula, its defaults are what goes in unasked. Anyone
//! who can put a file in that folder can rewrite what this app produces without
//! touching a line of its code. So a set is installed only if it carries a
//! signature from a key that was trusted beforehand, and every file in it hashes
//! to what the signed manifest says.
//!
//! Verification lives here rather than in the window for the obvious reason: the
//! window is the thing being updated, and a page cannot be asked to vouch for
//! its own replacement.
//!
//! Nothing is ever half-installed. A set is fetched, verified whole, and only
//! then swapped in — a broken update leaves the working one exactly where it was.

use std::fs;
use std::path::{Path, PathBuf};

use ed25519_dalek::{Signature, VerifyingKey};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::Manager;

/// The key this build trusts unless the user trusts another.
///
/// Empty here: there is no published channel yet, and a constant pretending
/// otherwise would be a key nobody holds. Trust one with `channel_trust`.
const BUILTIN_KEY_HEX: &str = "";

const MANIFEST: &str = "manifest.json";
const SIGNATURE: &str = "manifest.sig";

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ManifestFile {
    name: String,
    /// Lower-case hex of the file's SHA-256.
    sha256: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Manifest {
    /// Which set this is. A set for one thing must not overwrite another.
    channel: String,
    /// Monotonic. An older set is not installed over a newer one.
    version: u32,
    published: String,
    files: Vec<ManifestFile>,
}

#[derive(Serialize, Default)]
pub struct ChannelStatus {
    /// Whether a key is trusted at all. Without one, nothing can be installed.
    trusted_key: Option<String>,
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

fn key_file(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app_dir(app)?.join("channel-key.txt"))
}

fn source_file(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app_dir(app)?.join("models-source.txt"))
}

// ---------------------------------------------------------------------------
// Trust
// ---------------------------------------------------------------------------

fn parse_key(hex_text: &str) -> Result<VerifyingKey, String> {
    let bytes = hex::decode(hex_text.trim())
        .map_err(|_| "That is not a hex key.".to_string())?;
    let fixed: [u8; 32] = bytes
        .try_into()
        .map_err(|_| "An Ed25519 public key is 32 bytes — 64 hex characters.".to_string())?;

    VerifyingKey::from_bytes(&fixed).map_err(|e| format!("That is not a usable key: {e}"))
}

fn trusted_key(app: &tauri::AppHandle) -> Option<String> {
    if let Ok(text) = fs::read_to_string(key_file(app).ok()?) {
        let trimmed = text.trim().to_string();
        if !trimmed.is_empty() {
            return Some(trimmed);
        }
    }
    if BUILTIN_KEY_HEX.is_empty() {
        None
    } else {
        Some(BUILTIN_KEY_HEX.to_string())
    }
}

/// Trust a publisher's key, so sets they signed can be installed.
#[tauri::command]
pub fn channel_trust(app: tauri::AppHandle, key_hex: String) -> Result<String, String> {
    // Parsed before it is written: a key that cannot verify anything is worse
    // than no key, because it looks like protection.
    parse_key(&key_hex)?;

    let path = key_file(&app)?;
    fs::create_dir_all(path.parent().ok_or("nowhere to write")?)
        .map_err(|e| format!("Could not make the folder: {e}"))?;
    fs::write(&path, key_hex.trim()).map_err(|e| format!("Could not store the key: {e}"))?;
    Ok(key_hex.trim().to_string())
}

#[tauri::command]
pub fn channel_distrust(app: tauri::AppHandle) -> Result<(), String> {
    match fs::remove_file(key_file(&app)?) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(format!("Could not forget the key: {e}")),
    }
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
        trusted_key: trusted_key(&app),
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
        .filter_map(|f| Some((f.name.clone(), fs::read_to_string(dir.join(&f.name)).ok()?)))
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

fn hex_digest(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))
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

async fn verified(key_hex: &str, source: &str) -> Result<(Manifest, Vec<u8>), String> {
    let key = parse_key(key_hex)?;

    let manifest_bytes = fetch(source, MANIFEST).await?;
    let signature_bytes = fetch(source, SIGNATURE).await?;

    let raw = hex::decode(String::from_utf8_lossy(&signature_bytes).trim())
        .map_err(|_| "The signature is not hex.".to_string())?;
    let fixed: [u8; 64] = raw
        .try_into()
        .map_err(|_| "An Ed25519 signature is 64 bytes.".to_string())?;

    // Over the bytes as fetched, never over a re-serialisation: a manifest that
    // round-trips differently would verify something nobody signed.
    key.verify_strict(&manifest_bytes, &Signature::from_bytes(&fixed))
        .map_err(|_| {
            "That card set is not signed by the key you trust. Nothing was installed.".to_string()
        })?;

    let manifest: Manifest = serde_json::from_slice(&manifest_bytes)
        .map_err(|e| format!("The manifest is signed but unreadable: {e}"))?;

    Ok((manifest, manifest_bytes))
}

/// Look, without installing. Says what is on offer and whether it is newer.
#[tauri::command]
pub async fn channel_check(app: tauri::AppHandle, source: String) -> Result<Checked, String> {
    let (manifest, _) = verified(&needs_key(&app)?, &source).await?;
    let installed = read_manifest(&installed_dir(&app)?);

    Ok(Checked {
        stale: installed.as_ref().is_some_and(|i| {
            i.channel == manifest.channel && i.version >= manifest.version
        }),
        cards: manifest.files.len(),
        channel: manifest.channel,
        version: manifest.version,
        published: manifest.published,
    })
}

fn needs_key(app: &tauri::AppHandle) -> Result<String, String> {
    trusted_key(app)
        .ok_or_else(|| {
            "No publisher key is trusted, so nothing can be installed. Add one in Settings."
                .to_string()
        })
}

#[tauri::command]
pub async fn channel_install(
    app: tauri::AppHandle,
    source: String,
    force: bool,
) -> Result<ChannelStatus, String> {
    install_into(&installed_dir(&app)?, &needs_key(&app)?, &source, force).await?;
    fs::write(source_file(&app)?, &source).ok();
    channel_status(app)
}

/// Fetch, verify, and swap in — the whole of installing, without the app.
///
/// Separated so it can be tested against a real signed set on disk. What it
/// guarantees is that `dir` is either the set that was there before or the whole
/// of the new one, and never a mixture.
pub async fn install_into(
    dir: &Path,
    key_hex: &str,
    source: &str,
    force: bool,
) -> Result<Manifest, String> {
    let (manifest, manifest_bytes) = verified(key_hex, source).await?;

    if let Some(installed) = read_manifest(dir) {
        if installed.channel == manifest.channel && installed.version >= manifest.version && !force {
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

    for file in &manifest.files {
        let bytes = fetch(&source, &file.name).await?;
        let digest = hex_digest(&bytes);

        if !digest.eq_ignore_ascii_case(&file.sha256) {
            let _ = fs::remove_dir_all(&staging);
            return Err(format!(
                "{} is not the file the manifest signed. Nothing was installed.",
                file.name
            ));
        }
        fs::write(staging.join(&file.name), &bytes)
            .map_err(|e| format!("Could not write {}: {e}", file.name))?;
    }

    fs::write(staging.join(MANIFEST), &manifest_bytes)
        .map_err(|e| format!("Could not write the manifest: {e}"))?;


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
    use ed25519_dalek::{Signer, SigningKey};

    /// A publisher, from a fixed seed, so the test signs the same way twice.
    fn publisher() -> SigningKey {
        SigningKey::from_bytes(&[7u8; 32])
    }

    fn write_set(dir: &Path, version: u32, cards: &[(&str, &str)]) {
        fs::create_dir_all(dir).unwrap();

        let files: Vec<ManifestFile> = cards
            .iter()
            .map(|(name, body)| {
                fs::write(dir.join(name), body).unwrap();
                ManifestFile { name: (*name).to_string(), sha256: hex_digest(body.as_bytes()) }
            })
            .collect();

        let manifest = Manifest {
            channel: "dialect-models".to_string(),
            version,
            published: "2026-08-30".to_string(),
            files,
        };
        let bytes = serde_json::to_vec(&manifest).unwrap();
        fs::write(dir.join(MANIFEST), &bytes).unwrap();
        fs::write(dir.join(SIGNATURE), hex::encode(publisher().sign(&bytes).to_bytes())).unwrap();
    }

    fn temp(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("dialect-channel-{name}"));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn only_accepts_a_key_that_could_verify_something() {
        assert!(parse_key(&hex::encode(publisher().verifying_key().to_bytes())).is_ok());

        assert!(parse_key("not hex").is_err());
        assert!(parse_key("aabb").unwrap_err().contains("32 bytes"));
        assert!(parse_key("").is_err());
    }

    #[test]
    fn a_signature_covers_the_bytes_that_were_signed() {
        let dir = temp("verify");
        write_set(&dir, 1, &[("a.yaml", "id: a\n")]);

        let manifest = fs::read(dir.join(MANIFEST)).unwrap();
        let signature = hex::decode(fs::read_to_string(dir.join(SIGNATURE)).unwrap()).unwrap();
        let fixed: [u8; 64] = signature.try_into().unwrap();
        let key = publisher().verifying_key();

        assert!(key.verify_strict(&manifest, &Signature::from_bytes(&fixed)).is_ok());

        // One byte different anywhere in the manifest and it stops verifying.
        let mut tampered = manifest.clone();
        let last = tampered.len() - 2;
        tampered[last] ^= 0x01;
        assert!(key.verify_strict(&tampered, &Signature::from_bytes(&fixed)).is_err());

        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn a_file_that_does_not_match_its_hash_is_a_different_file() {
        let dir = temp("hash");
        write_set(&dir, 1, &[("a.yaml", "id: a\n")]);

        let manifest: Manifest =
            serde_json::from_slice(&fs::read(dir.join(MANIFEST)).unwrap()).unwrap();
        let listed = &manifest.files[0];

        assert_eq!(hex_digest(b"id: a\n"), listed.sha256);
        // The manifest still says what it said; the file no longer is it.
        fs::write(dir.join("a.yaml"), "id: something-else\n").unwrap();
        assert_ne!(hex_digest(&fs::read(dir.join("a.yaml")).unwrap()), listed.sha256);

        fs::remove_dir_all(&dir).ok();
    }

    fn key_hex() -> String {
        hex::encode(publisher().verifying_key().to_bytes())
    }

    fn install(into: &Path, from: &Path, force: bool) -> Result<Manifest, String> {
        tauri::async_runtime::block_on(install_into(
            into,
            &key_hex(),
            &from.to_string_lossy(),
            force,
        ))
    }

    /// The whole path, against a real signed set on disk.
    #[test]
    fn installs_a_set_that_is_signed_and_whole() {
        let from = temp("install-from");
        let into = temp("install-into").join("models");
        write_set(&from, 1, &[("a.yaml", "id: a
"), ("b.yaml", "id: b
")]);

        let manifest = install(&into, &from, false).unwrap();
        assert_eq!(manifest.version, 1);
        assert_eq!(fs::read_to_string(into.join("a.yaml")).unwrap(), "id: a
");
        assert!(into.join(MANIFEST).exists(), "the manifest is kept, so the set knows what it is");

        fs::remove_dir_all(from.parent().unwrap()).ok();
        fs::remove_dir_all(into.parent().unwrap()).ok();
    }

    #[test]
    fn refuses_a_set_signed_by_someone_else() {
        let from = temp("wrong-key-from");
        let into = temp("wrong-key-into").join("models");
        write_set(&from, 1, &[("a.yaml", "id: a
")]);

        let stranger = hex::encode(SigningKey::from_bytes(&[9u8; 32]).verifying_key().to_bytes());
        let refused = tauri::async_runtime::block_on(install_into(
            &into,
            &stranger,
            &from.to_string_lossy(),
            false,
        ));

        assert!(refused.unwrap_err().contains("not signed by the key you trust"));
        assert!(!into.exists(), "nothing was written");

        fs::remove_dir_all(from.parent().unwrap()).ok();
    }

    /// The point of hashing every file: a signature over the manifest says
    /// nothing about a card swapped after it was signed.
    #[test]
    fn refuses_a_card_that_was_changed_after_signing() {
        let from = temp("tamper-from");
        let into = temp("tamper-into").join("models");
        write_set(&from, 1, &[("a.yaml", "id: a
"), ("b.yaml", "id: b
")]);

        // The manifest and its signature are untouched; one card is not.
        fs::write(from.join("b.yaml"), "id: b
label: not what was signed
").unwrap();

        let refused = install(&into, &from, false).unwrap_err();
        assert!(refused.contains("b.yaml is not the file the manifest signed"), "{refused}");
        assert!(!into.exists(), "and the good card that came first was not kept either");

        fs::remove_dir_all(from.parent().unwrap()).ok();
    }

    /// A failed install has to leave the working set exactly as it was.
    #[test]
    fn a_broken_set_does_not_replace_a_working_one() {
        let good = temp("survive-good");
        let bad = temp("survive-bad");
        let into = temp("survive-into").join("models");

        write_set(&good, 1, &[("a.yaml", "id: a
label: the good one
")]);
        install(&into, &good, false).unwrap();

        write_set(&bad, 2, &[("a.yaml", "id: a
"), ("b.yaml", "id: b
")]);
        fs::write(bad.join("b.yaml"), "tampered").unwrap();
        assert!(install(&into, &bad, false).is_err());

        assert_eq!(
            fs::read_to_string(into.join("a.yaml")).unwrap(),
            "id: a
label: the good one
",
        );
        assert_eq!(read_manifest(&into).unwrap().version, 1);
        assert!(!into.with_extension("staging").exists(), "no half-installed set left behind");

        for d in [&good, &bad] { fs::remove_dir_all(d.parent().unwrap()).ok(); }
        fs::remove_dir_all(into.parent().unwrap()).ok();
    }

    #[test]
    fn will_not_go_backwards_unless_told_to() {
        let older = temp("down-older");
        let newer = temp("down-newer");
        let into = temp("down-into").join("models");

        write_set(&newer, 5, &[("a.yaml", "id: a
label: five
")]);
        write_set(&older, 2, &[("a.yaml", "id: a
label: two
")]);

        install(&into, &newer, false).unwrap();
        let refused = install(&into, &older, false).unwrap_err();
        assert!(refused.contains("Version 5 is already installed"), "{refused}");
        assert_eq!(read_manifest(&into).unwrap().version, 5);

        // Forced, it goes back — for getting off a set that turned out wrong.
        install(&into, &older, true).unwrap();
        assert_eq!(read_manifest(&into).unwrap().version, 2);

        for d in [&older, &newer] { fs::remove_dir_all(d.parent().unwrap()).ok(); }
        fs::remove_dir_all(into.parent().unwrap()).ok();
    }

    #[test]
    fn a_second_install_replaces_rather_than_accumulates() {
        let first = temp("swap-first");
        let second = temp("swap-second");
        let into = temp("swap-into").join("models");

        write_set(&first, 1, &[("gone.yaml", "id: gone
"), ("kept.yaml", "id: kept
")]);
        install(&into, &first, false).unwrap();

        write_set(&second, 2, &[("kept.yaml", "id: kept
label: newer
")]);
        install(&into, &second, false).unwrap();

        assert!(!into.join("gone.yaml").exists(), "a card dropped from the set is gone");
        assert!(fs::read_to_string(into.join("kept.yaml")).unwrap().contains("newer"));

        for d in [&first, &second] { fs::remove_dir_all(d.parent().unwrap()).ok(); }
        fs::remove_dir_all(into.parent().unwrap()).ok();
    }

    /// The one test that catches a mismatch between the two halves.
    ///
    /// The set in `tests/fixtures/signed-set` was signed by the `dialect sign`
    /// command in the CLI, with a key that was thrown away — only its public
    /// half is here. If Node and this ever stop agreeing about what Ed25519 over
    /// those bytes means, this is where it shows, rather than on someone's
    /// machine when an update refuses to install.
    #[test]
    fn verifies_a_set_the_command_line_signed() {
        const PUBLISHER: &str =
            "3b79f1db34ee37624939f4a8ad18ac4a9d1becd86fb68084c9d69cf1e1a640b2";

        let fixture = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/signed-set");
        assert!(fixture.join(MANIFEST).exists(), "the signed fixture is missing");

        let into = temp("crosslang").join("models");
        let manifest = tauri::async_runtime::block_on(install_into(
            &into,
            PUBLISHER,
            &fixture.to_string_lossy(),
            false,
        ))
        .expect("a set signed by the CLI should verify here");

        assert_eq!(manifest.channel, "dialect-models");
        assert_eq!(manifest.files.len(), 2);
        assert!(fs::read_to_string(into.join("tiny-one.yaml")).unwrap().contains("Tiny One"));

        // And it is the signature doing the work, not the hashes alone.
        let elsewhere = temp("crosslang-wrong").join("models");
        let stranger = hex::encode(SigningKey::from_bytes(&[3u8; 32]).verifying_key().to_bytes());
        assert!(tauri::async_runtime::block_on(install_into(
            &elsewhere,
            &stranger,
            &fixture.to_string_lossy(),
            false,
        ))
        .is_err());

        fs::remove_dir_all(into.parent().unwrap()).ok();
        fs::remove_dir_all(elsewhere.parent().unwrap()).ok();
    }

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
