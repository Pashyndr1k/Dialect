//! The Tauri host.
//!
//! Deliberately thin. The compiler is portable TypeScript shared with the CLI,
//! so nothing about prompts, schemas or rules lives here. This side owns only
//! what a web view must not be trusted with: the credential, and the request
//! that carries it.

mod anthropic;
mod secrets;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            secrets::secret_available,
            secrets::secret_set,
            secrets::secret_has,
            secrets::secret_delete,
            anthropic::anthropic_extract,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
