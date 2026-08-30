//! Templates someone made, kept as files.
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

fn dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let base = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Nowhere to keep templates: {e}"))?
        .join("templates");

    fs::create_dir_all(&base).map_err(|e| format!("Could not make the templates folder: {e}"))?;
    Ok(base)
}

/// An id is a file name, so it has to be one and nothing more.
fn checked_id(id: &str) -> Result<String, String> {
    let ok = !id.is_empty()
        && id.len() <= 64
        && id.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-');

    if ok {
        Ok(format!("{id}.yaml"))
    } else {
        Err(format!(
            "\"{id}\" is not a usable template id — lower-case letters, digits and hyphens only."
        ))
    }
}

#[derive(Serialize)]
pub struct StoredTemplate {
    id: String,
    /// The YAML itself. Parsed by the window, which owns what a template means.
    text: String,
}

#[tauri::command]
pub fn templates_list(app: tauri::AppHandle) -> Result<Vec<StoredTemplate>, String> {
    let base = dir(&app)?;
    let entries = fs::read_dir(&base).map_err(|e| format!("Could not read templates: {e}"))?;

    let mut out: Vec<StoredTemplate> = entries
        .filter_map(|entry| {
            let path = entry.ok()?.path();
            if path.extension()?.to_str()? != "yaml" {
                return None;
            }
            Some(StoredTemplate {
                id: path.file_stem()?.to_string_lossy().to_string(),
                text: fs::read_to_string(&path).ok()?,
            })
        })
        .collect();

    out.sort_by(|a, b| a.id.cmp(&b.id));
    Ok(out)
}

#[tauri::command]
pub fn template_save(app: tauri::AppHandle, id: String, text: String) -> Result<String, String> {
    let path = dir(&app)?.join(checked_id(&id)?);
    fs::write(&path, text).map_err(|e| format!("Could not save that template: {e}"))?;
    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
pub fn template_delete(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let path = dir(&app)?.join(checked_id(&id)?);
    match fs::remove_file(&path) {
        Ok(()) => Ok(()),
        // Already gone is the state that was asked for.
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(format!("Could not delete that template: {e}")),
    }
}

/// Open the folder, so a template can be edited in a real editor.
#[tauri::command]
pub fn templates_folder(app: tauri::AppHandle) -> Result<String, String> {
    Ok(dir(&app)?.to_string_lossy().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_accepts_an_id_that_is_a_file_name() {
        assert_eq!(checked_id("rpg-character-sheet").unwrap(), "rpg-character-sheet.yaml");
        assert_eq!(checked_id("a1").unwrap(), "a1.yaml");

        for bad in ["", "../escape", "with/slash", "With-Caps", "spaces here", "dot.yaml"] {
            assert!(checked_id(bad).is_err(), "{bad} should have been refused");
        }
        assert!(checked_id(&"a".repeat(65)).is_err(), "an id has to fit in a name");
    }
}
