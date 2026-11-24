mod audio;
mod db;
mod models;
mod scanner;

use std::sync::Mutex;
use rusqlite::Connection;
use tauri::{Manager, State};
use audio::AudioPlayer;
use models::{PlaybackStatus, PlaylistItem, TrackItem};

pub struct AppState {
    pub db: Mutex<Connection>,
    pub player: Mutex<AudioPlayer>,
}

#[tauri::command]
fn get_tracks(state: State<AppState>) -> Result<Vec<TrackItem>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::get_all_tracks(&conn)
}

#[tauri::command]
fn scan_folder(folder_path: String, state: State<AppState>) -> Result<Vec<TrackItem>, String> {
    let scanned = scanner::scan_directory(&folder_path);
    let mut conn = state.db.lock().map_err(|e| e.to_string())?;
    db::upsert_tracks(&mut conn, &scanned)?;
    db::get_all_tracks(&conn)
}

#[tauri::command]
fn play_track(track_id: String, audio_url: String, state: State<AppState>) -> Result<(), String> {
    {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        let _ = db::record_play(&conn, &track_id);
    }
    let mut player = state.player.lock().map_err(|e| e.to_string())?;
    player.play_file(&audio_url)
}

#[tauri::command]
fn pause_track(state: State<AppState>) -> Result<(), String> {
    let player = state.player.lock().map_err(|e| e.to_string())?;
    player.pause();
    Ok(())
}

#[tauri::command]
fn resume_track(state: State<AppState>) -> Result<(), String> {
    let player = state.player.lock().map_err(|e| e.to_string())?;
    player.resume();
    Ok(())
}

#[tauri::command]
fn seek_track(seconds: u64, state: State<AppState>) -> Result<(), String> {
    let player = state.player.lock().map_err(|e| e.to_string())?;
    player.seek(seconds)
}

#[tauri::command]
fn set_volume(volume: f32, state: State<AppState>) -> Result<(), String> {
    let mut player = state.player.lock().map_err(|e| e.to_string())?;
    player.set_volume(volume);
    Ok(())
}

#[tauri::command]
fn toggle_mute(state: State<AppState>) -> Result<bool, String> {
    let mut player = state.player.lock().map_err(|e| e.to_string())?;
    Ok(player.toggle_mute())
}

#[tauri::command]
fn get_playback_status(state: State<AppState>) -> Result<PlaybackStatus, String> {
    let player = state.player.lock().map_err(|e| e.to_string())?;
    Ok(player.status())
}

#[tauri::command]
fn toggle_favorite(track_id: String, state: State<AppState>) -> Result<bool, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::toggle_favorite(&conn, &track_id)
}

#[tauri::command]
fn get_playlists(state: State<AppState>) -> Result<Vec<PlaylistItem>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::get_playlists(&conn)
}

#[tauri::command]
fn create_playlist(id: String, name: String, state: State<AppState>) -> Result<PlaylistItem, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::create_playlist(&conn, &id, &name)
}

#[tauri::command]
fn add_track_to_playlist(
    playlist_id: String,
    track_id: String,
    state: State<AppState>,
) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::add_track_to_playlist(&conn, &playlist_id, &track_id)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let audio_player = AudioPlayer::new().expect("Не удалось инициализировать аудиодвижок");

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(move |app| {
            let conn = db::init_database(app.handle()).expect("Ошибка инициализации SQLite");
            app.manage(AppState {
                db: Mutex::new(conn),
                player: Mutex::new(audio_player),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_tracks,
            scan_folder,
            play_track,
            pause_track,
            resume_track,
            seek_track,
            set_volume,
            toggle_mute,
            get_playback_status,
            toggle_favorite,
            get_playlists,
            create_playlist,
            add_track_to_playlist
        ])
        .run(tauri::generate_context!())
        .expect("Ошибка запуска Abyss Music");
}