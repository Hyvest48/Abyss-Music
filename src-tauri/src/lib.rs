mod audio;
mod db;
mod models;
mod providers;
mod scanner;

use std::sync::Mutex;
use rusqlite::Connection;
use serde::Serialize;
use tauri::{Emitter, Manager, State, WebviewUrl, WebviewWindowBuilder};
use audio::AudioPlayer;
use models::{PlaybackStatus, PlaylistItem, TrackItem};
use providers::TrackLyrics;

pub struct AppState {
    pub db: Mutex<Connection>,
    pub player: Mutex<AudioPlayer>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct YandexAuthStatus {
    pub is_authorized: bool,
    pub account_name: Option<String>,
}

fn persist_yandex_token(app: &tauri::AppHandle, raw_token: &str) {
    let clean_token = raw_token.trim().to_string();
    if clean_token.is_empty() {
        return;
    }

    if let Some(state) = app.try_state::<AppState>() {
        if let Ok(conn) = state.db.lock() {
            let _ = db::set_setting(&conn, "yandex_token", &clean_token);
        }
    }

    let account_name = providers::get_yandex_account_name(&clean_token).ok();
    let _ = app.emit(
        "yandex-auth-success",
        YandexAuthStatus {
            is_authorized: true,
            account_name,
        },
    );

    if let Some(win) = app.get_webview_window("yandex-auth") {
        let _ = win.close();
    }
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
fn get_yandex_status(state: State<AppState>) -> Result<YandexAuthStatus, String> {
    let token_opt = {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        db::get_setting(&conn, "yandex_token")?
    };

    if let Some(token) = token_opt {
        if !token.trim().is_empty() {
            if let Ok(name) = providers::get_yandex_account_name(&token) {
                return Ok(YandexAuthStatus {
                    is_authorized: true,
                    account_name: Some(name),
                });
            }
        }
    }

    Ok(YandexAuthStatus {
        is_authorized: false,
        account_name: None,
    })
}

#[tauri::command]
fn save_yandex_token(app: tauri::AppHandle, token: String) -> Result<(), String> {
    persist_yandex_token(&app, &token);
    Ok(())
}

#[tauri::command]
fn logout_yandex(state: State<AppState>) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::delete_setting(&conn, "yandex_token")
}

#[tauri::command]
async fn open_yandex_auth(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(existing) = app.get_webview_window("yandex-auth") {
        let _ = existing.set_focus();
        return Ok(());
    }

    let auth_url = "https://oauth.yandex.ru/authorize?response_type=token&client_id=23cabbbdc6cd418abb4b39c32c41195d";
    let app_handle = app.clone();

    let hash_watcher_script = r#"
        (function() {
            function checkToken() {
                const source = (window.location.hash || '') + '&' + (window.location.search || '');
                const match = source.match(/access_token=([^&]+)/);
                if (match && match[1]) {
                    window.location.href = 'https://abyss-auth-callback.local/?token=' + encodeURIComponent(match[1]);
                }
            }
            checkToken();
            window.addEventListener('hashchange', checkToken);
            setInterval(checkToken, 400);
        })();
    "#;

    WebviewWindowBuilder::new(
        &app,
        "yandex-auth",
        WebviewUrl::External(auth_url.parse().map_err(|e| format!("{}", e))?),
    )
    .title("Вход через Яндекс ID — Abyss Music")
    .inner_size(480.0, 680.0)
    .initialization_script(hash_watcher_script)
    .on_navigation(move |url| {
        let url_str = url.as_str();

        if let Some(rest) = url_str.strip_prefix("https://abyss-auth-callback.local/?token=") {
            let token = rest.split('&').next().unwrap_or("");
            persist_yandex_token(&app_handle, token);
            return false;
        }

        if let Some(fragment) = url.fragment() {
            for pair in fragment.split('&') {
                if let Some(token) = pair.strip_prefix("access_token=") {
                    persist_yandex_token(&app_handle, token);
                    return false;
                }
            }
        }

        if let Some(query) = url.query() {
            for pair in query.split('&') {
                if let Some(token) = pair.strip_prefix("access_token=") {
                    persist_yandex_token(&app_handle, token);
                    return false;
                }
            }
        }

        url_str == "about:blank"
            || url_str.starts_with("https://")
            || url_str.starts_with("http://")
    })
    .build()
    .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
fn search_yandex_tracks(query: String, state: State<AppState>) -> Result<Vec<TrackItem>, String> {
    let token = {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        db::get_setting(&conn, "yandex_token")?.unwrap_or_default()
    };
    if token.trim().is_empty() {
        return Ok(Vec::new());
    }
    providers::search_yandex(&token, &query)
}

#[tauri::command]
fn get_yandex_wave(
    mood: Option<String>,
    activity: Option<String>,
    character: Option<String>,
    genre: Option<String>,
    queue_track_id: Option<String>,
    state: State<AppState>,
) -> Result<Vec<TrackItem>, String> {
    let token = {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        db::get_setting(&conn, "yandex_token")?.unwrap_or_default()
    };
    providers::wave_yandex(
        &token,
        mood.as_deref(),
        activity.as_deref(),
        character.as_deref(),
        genre.as_deref(),
        queue_track_id.as_deref(),
    )
}

#[tauri::command]
fn send_wave_feedback(
    genre: Option<String>,
    event_type: String,
    track_id: Option<String>,
    total_played_seconds: Option<u64>,
    state: State<AppState>,
) -> Result<(), String> {
    let token = {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        db::get_setting(&conn, "yandex_token")?.unwrap_or_default()
    };
    if token.trim().is_empty() {
        return Ok(());
    }
    providers::send_yandex_wave_feedback(
        &token,
        genre.as_deref(),
        &event_type,
        track_id.as_deref(),
        total_played_seconds,
    )
}

#[tauri::command]
fn get_track_lyrics(
    title: String,
    artist: String,
    album: String,
    duration_seconds: u64,
) -> Result<TrackLyrics, String> {
    providers::fetch_lyrics(&title, &artist, &album, duration_seconds)
}

#[tauri::command]
fn set_eq_gains(gains: Vec<f32>, state: State<AppState>) -> Result<(), String> {
    let mut arr = [0.0_f32; 5];
    for (i, val) in gains.iter().take(5).enumerate() {
        arr[i] = *val;
    }
    {
        let player = state.player.lock().map_err(|e| e.to_string())?;
        player.set_eq_gains(arr);
    }
    if let Ok(json_str) = serde_json::to_string(&arr) {
        if let Ok(conn) = state.db.lock() {
            let _ = db::set_setting(&conn, "eq_gains", &json_str);
        }
    }
    Ok(())
}

#[tauri::command]
fn get_eq_gains(state: State<AppState>) -> Result<Vec<f32>, String> {
    let player = state.player.lock().map_err(|e| e.to_string())?;
    Ok(player.get_eq_gains().to_vec())
}

#[tauri::command]
fn play_track(track_id: String, audio_url: String, state: State<AppState>) -> Result<(), String> {
    let ym_token = {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        let _ = db::record_play(&conn, &track_id);
        db::get_setting(&conn, "yandex_token")?
    };
    let player = state.player.lock().map_err(|e| e.to_string())?;
    player.play_file(&audio_url, ym_token.as_deref())
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
            if let Ok(Some(saved_eq)) = db::get_setting(&conn, "eq_gains") {
                if let Ok(arr) = serde_json::from_str::<[f32; 5]>(&saved_eq) {
                    audio_player.set_eq_gains(arr);
                }
            }
            app.manage(AppState {
                db: Mutex::new(conn),
                player: Mutex::new(audio_player),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_tracks,
            scan_folder,
            get_yandex_status,
            save_yandex_token,
            logout_yandex,
            open_yandex_auth,
            search_yandex_tracks,
            get_yandex_wave,
            send_wave_feedback,
            get_track_lyrics,
            set_eq_gains,
            get_eq_gains,
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