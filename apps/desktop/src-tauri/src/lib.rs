//! The Tauri host.
//!
//! Deliberately thin. The compiler is portable TypeScript shared with the CLI,
//! so nothing about prompts, schemas or rules lives here. This side owns what a
//! web view cannot own for itself: the credential and the request that carries
//! it, and anything that has to outlive the window — the cache of answers
//! already paid for, and a record of what was on screen.

mod anthropic;
mod audio;
mod channel;
mod customs;
mod files;
mod media;
mod secrets;
mod store;
mod tools;
mod voice;

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
            anthropic::anthropic_models,
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
            audio::audio_probe,
            audio::audio_measure,
            files::file_read,
            files::file_thumb,
            files::folder_scan,
            channel::channel_trust,
            channel::channel_distrust,
            channel::channel_status,
            channel::channel_cards,
            channel::channel_check,
            channel::channel_install,
            channel::channel_revert,
            channel::cards_folder,
            channel::my_cards,
            customs::authored_list,
            customs::authored_save,
            customs::authored_delete,
            customs::authored_folder,
            voice::voice_tools,
            voice::voice_transcribe,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
