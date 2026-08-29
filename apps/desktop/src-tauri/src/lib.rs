//! The Tauri host.
//!
//! Deliberately thin. The compiler is portable TypeScript shared with the CLI,
//! so nothing about prompts lives here. This side owns only what a web view
//! cannot do for itself — starting with the OS credential store.

mod secrets;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            secrets::secret_available,
            secrets::secret_set,
            secrets::secret_get,
            secrets::secret_has,
            secrets::secret_delete,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
