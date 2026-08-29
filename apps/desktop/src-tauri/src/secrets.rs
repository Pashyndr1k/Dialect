//! API keys at rest.
//!
//! The key is typed into the app's own settings panel and handed straight to
//! the operating system's credential store — Windows Credential Manager, the
//! macOS Keychain, the Secret Service on Linux. Nothing is written to disk by
//! us, and nothing lands in a config file or in shell history.
//!
//! The web view can ask for the key back when it needs to make a call, and can
//! ask whether one is stored without ever reading it — which is all the
//! settings panel needs to render its state.

use keyring::Entry;

/// Namespaced so the entry is recognisable in the OS credential UI.
const SERVICE: &str = "com.dialect.app";

fn entry(name: &str) -> Result<Entry, String> {
    Entry::new(SERVICE, name).map_err(|e| format!("Could not reach the credential store: {e}"))
}

/// Whether this build can store secrets at all. False on a machine with no
/// usable credential store, which the settings panel says out loud rather than
/// silently falling back to something less safe.
#[tauri::command]
pub fn secret_available() -> bool {
    entry("__probe__").is_ok()
}

#[tauri::command]
pub fn secret_set(name: String, value: String) -> Result<(), String> {
    let e = entry(&name)?;
    if value.is_empty() {
        // Saving an empty field means "forget it", not "store nothing".
        return match e.delete_credential() {
            Ok(()) => Ok(()),
            Err(keyring::Error::NoEntry) => Ok(()),
            Err(err) => Err(format!("Could not clear the stored key: {err}")),
        };
    }
    e.set_password(&value)
        .map_err(|err| format!("Could not store the key: {err}"))
}

#[tauri::command]
pub fn secret_get(name: String) -> Result<Option<String>, String> {
    match entry(&name)?.get_password() {
        Ok(v) => Ok(Some(v)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(err) => Err(format!("Could not read the stored key: {err}")),
    }
}

/// Answers "is one saved?" without handing the value to the web view.
#[tauri::command]
pub fn secret_has(name: String) -> Result<bool, String> {
    Ok(secret_get(name)?.is_some())
}

#[tauri::command]
pub fn secret_delete(name: String) -> Result<(), String> {
    match entry(&name)?.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(err) => Err(format!("Could not clear the stored key: {err}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Round-trips a throwaway credential through the real OS store. If this
    /// passes on a machine, the settings panel will work on that machine —
    /// which is the only thing worth asserting here.
    #[test]
    fn stores_reads_and_forgets_a_key() {
        let name = "__dialect_test__";
        let _ = secret_delete(name.to_string());

        assert!(secret_available(), "no usable credential store on this machine");
        assert_eq!(secret_get(name.to_string()).unwrap(), None);
        assert!(!secret_has(name.to_string()).unwrap());

        secret_set(name.to_string(), "sk-ant-probe-value".to_string()).unwrap();
        assert_eq!(
            secret_get(name.to_string()).unwrap().as_deref(),
            Some("sk-ant-probe-value")
        );
        assert!(secret_has(name.to_string()).unwrap());

        // Saving an empty field means "forget it".
        secret_set(name.to_string(), String::new()).unwrap();
        assert!(!secret_has(name.to_string()).unwrap());

        // Deleting something already gone is not an error.
        secret_delete(name.to_string()).unwrap();
    }
}
