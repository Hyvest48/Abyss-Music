mod audio;
mod db;
mod models;
mod providers;
mod scanner;

use std::sync::Mutex;
use rusqlite::Connection;
use tauri::{Manager, State};
use audio::AudioPlayer;
use models::{PlaybackStatus, PlaylistItem, TrackItem};

pub struct AppState {
    pub db: Mutex<Connection>,
    pub player: Mutex<AudioPlayer>,
    pub custom_api_url: Mutex<String>,
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
fn set_custom_api_url(url: String, state: State<AppState>) -> Result<(), String> {
    let mut api_url = state.custom_api_url.lock().map_err(|e| e.to_string())?;
    *api_url = url.trim().to_string();
    Ok(())
}

#[tauri::command]
fn search_online_tracks(query: String, state: State<AppState>) -> Result<Vec<TrackItem>, String> {
    let custom_url = state.custom_api_url.lock().map_err(|e| e.to_string())?.clone();
    let mut results = Vec::new();

    // 1. Сначала запрашиваем ваш с Арсением API (если сервер недоступен — не ломаем поиск)
    if let Ok(custom_tracks) = providers::search_custom_api(&custom_url, &query) {
        results.extend(custom_tracks);
    }

    // 2. Подмешиваем треки из Audius
    if let Ok(audius_tracks) = providers::search_audius(&query) {
        results.extend(audius_tracks);
    }

    Ok(results)
}

#[tauri::command]
fn get_wave_tracks(
    mood: Option<String>,
    activity: Option<String>,
    character: Option<String>,
    genre: Option<String>,
    state: State<AppState>,
) -> Result<Vec<TrackItem>, String> {
    let custom_url = state.custom_api_url.lock().map_err(|e| e.to_string())?.clone();
    let mut results = Vec::new();

    if let Ok(custom_tracks) = providers::wave_custom_api(
        &custom_url,
        mood.as_deref(),
        activity.as_deref(),
        character.as_deref(),
        genre.as_deref(),
    ) {
        results.extend(custom_tracks);
    }

    if let Ok(audius_tracks) =
        providers::wave_audius(mood.as_deref(), activity.as_deref(), genre.as_deref())
    {
        results.extend(audius_tracks);
    }

    Ok(results)
}

#[tauri::command]
fn play_track(track_id: String, audio_url: String, state: State<AppState>) -> Result<(), String> {
    {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        let _ = db::record_play(&conn, &track_id);
    }
    let player = state.player.lock().map_err(|e| e.to_string())?;
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
    let player = state.player.lock().map_err(|e| e.to_string())?;
    player.set_volume(volume);
    Ok(())
}

#[tauri::command]
fn toggle_mute(state: State<AppState>) -> Result<bool, String> {
    let player = state.player.lock().map_err(|e| e.to_string())?;
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
                custom_api_url: Mutex::new("http://localhost:8000".to_string()),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_tracks,
            scan_folder,
            set_custom_api_url,
            search_online_tracks,
            get_wave_tracks,
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