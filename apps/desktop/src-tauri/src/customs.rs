//! Templates and sources someone made, kept as files.
//!
//! Files rather than a database, in the same folder shape as the built-in ones,
//! for a reason that matters more than it looks: a template someone worked out
//! and wants to keep should be something they can open, read, fix a word in,
//! copy to another machine, or send to someone else. A row in a store the app
//! owns is none of those things.
//!
//! This side only reads and writes them. What a template *is* stays in the
//! TypeScript that also parses the built-in ones — one parser, so a custom
//! template cannot quietly mean something different from a shipped one.

use std::fs;
use std::path::PathBuf;

use serde::Serialize;
use tauri::Manager;

/**
 * The two kinds of thing someone can author.
 *
 * A folder name chosen by the window would be a path the window controls, so
 * this matches on what it asked for rather than taking a name — the same
 * reason an id has to be a file name and nothing more.
 */
fn dir_name(what: &str) -> Result<&'static str, String> {
    match what {
        "templates" => Ok("templates"),
        "sources" => Ok("sources"),
        "graphs" => Ok("graphs"),
        other => Err(format!("\"{other}\" is not something this keeps.")),
    }
}

/// What a kind is written as.
///
/// Templates and sources are YAML because people write them by hand. A graph is
/// made by dragging and is read back by machine, so it is JSON — and it has to
/// round-trip exactly, which YAML does not promise.
fn ext_for(what: &str) -> &'static str {
    if what == "graphs" {
        "json"
    } else {
        "yaml"
    }
}

fn dir(app: &tauri::AppHandle, what: &str) -> Result<PathBuf, String> {
    let folder = dir_name(what)?;

    let base = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Nowhere to keep {folder}: {e}"))?
        .join(folder);

    fs::create_dir_all(&base).map_err(|e| format!("Could not make the {folder} folder: {e}"))?;
    Ok(base)
}

/// An id is a file name, so it has to be one and nothing more.
fn checked_id(id: &str, ext: &str) -> Result<String, String> {
    let ok = !id.is_empty()
        && id.len() <= 64
        && id.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-');

    if ok {
        Ok(format!("{id}.{ext}"))
    } else {
        Err(format!(
            "\"{id}\" is not a usable template id — lower-case letters, digits and hyphens only."
        ))
    }
}

#[derive(Serialize)]
pub struct StoredFile {
    id: String,
    /// The YAML itself. Parsed by the window, which owns what these mean.
    text: String,
}

#[tauri::command]
pub fn authored_list(app: tauri::AppHandle, what: String) -> Result<Vec<StoredFile>, String> {
    let base = dir(&app, &what)?;
    let entries = fs::read_dir(&base).map_err(|e| format!("Could not read {what}: {e}"))?;

    let mut out: Vec<StoredFile> = entries
        .filter_map(|entry| {
            let path = entry.ok()?.path();
            if path.extension()?.to_str()? != ext_for(&what) {
                return None;
            }
            Some(StoredFile {
                id: path.file_stem()?.to_string_lossy().to_string(),
                text: fs::read_to_string(&path).ok()?,
            })
        })
        .collect();

    out.sort_by(|a, b| a.id.cmp(&b.id));
    Ok(out)
}

#[tauri::command]
pub fn authored_save(
    app: tauri::AppHandle,
    what: String,
    id: String,
    text: String,
) -> Result<String, String> {
    let path = dir(&app, &what)?.join(checked_id(&id, ext_for(&what))?);
    fs::write(&path, text).map_err(|e| format!("Could not save that: {e}"))?;
    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
pub fn authored_delete(app: tauri::AppHandle, what: String, id: String) -> Result<(), String> {
    let path = dir(&app, &what)?.join(checked_id(&id, ext_for(&what))?);
    match fs::remove_file(&path) {
        Ok(()) => Ok(()),
        // Already gone is the state that was asked for.
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(format!("Could not delete that: {e}")),
    }
}

/// Open the folder, so what is in it can be edited in a real editor.
#[tauri::command]
pub fn authored_folder(app: tauri::AppHandle, what: String) -> Result<String, String> {
    Ok(dir(&app, &what)?.to_string_lossy().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A folder is chosen from a fixed pair, never taken as a name.
    #[test]
    fn keeps_only_the_two_things_it_knows_about() {
        for bad in ["", "..", "../../etc", "models", "Templates"] {
            let refused = match dir_name(bad) {
                Ok(_) => panic!("{bad} should have been refused"),
                Err(e) => e,
            };
            assert!(refused.contains("is not something this keeps"), "{refused}");
        }
        assert_eq!(dir_name("templates").unwrap(), "templates");
        assert_eq!(dir_name("sources").unwrap(), "sources");
        assert_eq!(dir_name("graphs").unwrap(), "graphs");
    }

    #[test]
    fn writes_each_kind_as_what_people_read_it_as() {
        // Hand-written things are YAML; a graph is made by dragging and has to
        // round-trip exactly, so it is JSON.
        assert_eq!(ext_for("templates"), "yaml");
        assert_eq!(ext_for("sources"), "yaml");
        assert_eq!(ext_for("graphs"), "json");
    }

    #[test]
    fn only_accepts_an_id_that_is_a_file_name() {
        assert_eq!(
            checked_id("rpg-character-sheet", "yaml").unwrap(),
            "rpg-character-sheet.yaml"
        );
        assert_eq!(checked_id("a1", "yaml").unwrap(), "a1.yaml");
        assert_eq!(checked_id("a1", "json").unwrap(), "a1.json");

        for bad in ["", "../escape", "with/slash", "With-Caps", "spaces here", "dot.yaml"] {
            assert!(checked_id(bad, "yaml").is_err(), "{bad} should have been refused");
        }
        assert!(
            checked_id(&"a".repeat(65), "yaml").is_err(),
            "an id has to fit in a name"
        );
    }
}
