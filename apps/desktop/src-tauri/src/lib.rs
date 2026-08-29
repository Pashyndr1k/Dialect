//! The Tauri host.
//!
//! Deliberately thin. The compiler is portable TypeScript shared with the CLI,
//! so nothing about prompts lives here. This side owns only what a web view
//! cannot do for itself: the filesystem, the OS keychain, spawning ffmpeg, and
//! updates. None of that is wired yet.

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
