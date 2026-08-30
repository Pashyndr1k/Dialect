//! The Tauri host.
//!
//! Deliberately thin. The compiler is portable TypeScript shared with the CLI,
//! so nothing about prompts, schemas or rules lives here. This side owns what a
//! web view cannot own for itself: the credential and the request that carries
//! it, and anything that has to outlive the window — the cache of answers
//! already paid for, and a record of what was on screen.

mod anthropic;
mod media;
mod secrets;
mod store;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            secrets::secret_available,
            secrets::secret_set,
            secrets::secret_has,
            secrets::secret_delete,
            anthropic::anthropic_extract,
            store::cache_get,
            store::cache_set,
            store::cache_stats,
            store::cache_clear,
            store::session_get,
            store::session_set,
            store::session_clear,
            store::save_prompts,
            store::library_get,
            store::library_set,
            media::media_tools,
            media::media_probe,
            media::media_frames,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
