mod audio;
mod db;
mod global_hotkeys;
mod media_controls;
mod models;
mod providers;
mod scanner;

use std::sync::Mutex;
use rusqlite::Connection;
use serde::Serialize;
use tauri::{Emitter, Manager, State, WebviewUrl, WebviewWindowBuilder};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::menu::{Menu, MenuItem};
use audio::AudioPlayer;
use media_controls::MediaControlsManager;
use models::{PlaybackStatus, PlaylistItem, TrackItem};
use providers::{ArtistProfile, TrackLyrics, YandexSearchResult};

pub struct AppState {
    pub db: Mutex<Connection>,
    pub player: Mutex<AudioPlayer>,
    pub media: MediaControlsManager,
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

    let app_handle = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let Ok(account_name) = providers::get_yandex_account_name(&clean_token) else {
            return;
        };

        if let Some(state) = app_handle.try_state::<AppState>() {
            if let Ok(conn) = state.db.lock() {
                if db::set_setting(&conn, "yandex_token", &clean_token).is_err() {
                    return;
                }
            }
        }

        let _ = app_handle.emit(
            "yandex-auth-success",
            YandexAuthStatus {
                is_authorized: true,
                account_name: Some(account_name),
            },
        );

        if let Some(win) = app_handle.get_webview_window("yandex-auth") {
            let _ = win.close();
        }
    });
}

fn is_allowed_yandex_auth_url(url: &tauri::Url) -> bool {
    let url_str = url.as_str();
    if url_str == "about:blank" || url_str.starts_with("https://abyss-auth-callback.local/") {
        return true;
    }
    if url.scheme() != "https" {
        return false;
    }
    let Some(host) = url.host_str() else {
        return false;
    };
    let h = host.to_ascii_lowercase();
    h == "yandex.ru"
        || h.ends_with(".yandex.ru")
        || h == "yandex.com"
        || h.ends_with(".yandex.com")
        || h == "ya.ru"
        || h.ends_with(".ya.ru")
}

#[tauri::command]
fn get_tracks(state: State<AppState>) -> Result<Vec<TrackItem>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::get_all_tracks(&conn)
}

#[tauri::command]
async fn scan_folder(
    folder_path: String,
    state: State<'_, AppState>,
) -> Result<Vec<TrackItem>, String> {
    let scanned = tauri::async_runtime::spawn_blocking(move || scanner::scan_directory(&folder_path))
        .await
        .map_err(|e| e.to_string())?;
    let mut conn = state.db.lock().map_err(|e| e.to_string())?;
    db::upsert_tracks(&mut conn, &scanned)?;
    db::get_all_tracks(&conn)
}

#[tauri::command]
async fn get_yandex_status(state: State<'_, AppState>) -> Result<YandexAuthStatus, String> {
    let token_opt = {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        db::get_setting(&conn, "yandex_token")?
    };

    if let Some(token) = token_opt {
        if !token.trim().is_empty() {
            if let Ok(Ok(name)) =
                tauri::async_runtime::spawn_blocking(move || providers::get_yandex_account_name(&token))
                    .await
            {
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

        if url_str.starts_with("https://abyss-auth-callback.local/") {
            for (k, v) in url.query_pairs() {
                if k == "token" && !v.is_empty() {
                    persist_yandex_token(&app_handle, &v);
                    break;
                }
            }
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

        for (k, v) in url.query_pairs() {
            if k == "access_token" && !v.is_empty() {
                persist_yandex_token(&app_handle, &v);
                return false;
            }
        }

        is_allowed_yandex_auth_url(url)
    })
    .build()
    .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
async fn search_yandex_tracks(
    query: String,
    state: State<'_, AppState>,
) -> Result<Vec<TrackItem>, String> {
    let token = {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        db::get_setting(&conn, "yandex_token")?.unwrap_or_default()
    };
    if token.trim().is_empty() {
        return Ok(Vec::new());
    }
    tauri::async_runtime::spawn_blocking(move || providers::search_yandex(&token, &query))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn resolve_yandex_tracks(
    track_ids: Vec<String>,
    state: State<'_, AppState>,
) -> Result<Vec<TrackItem>, String> {
    let token = {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        db::get_setting(&conn, "yandex_token")?.unwrap_or_default()
    };
    if token.trim().is_empty() || track_ids.is_empty() {
        return Ok(Vec::new());
    }
    tauri::async_runtime::spawn_blocking(move || providers::resolve_yandex_tracks(&token, &track_ids))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn search_yandex_all(
    query: String,
    state: State<'_, AppState>,
) -> Result<YandexSearchResult, String> {
    let token = {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        db::get_setting(&conn, "yandex_token")?.unwrap_or_default()
    };
    if token.trim().is_empty() {
        return Ok(YandexSearchResult {
            artists: Vec::new(),
            tracks: Vec::new(),
        });
    }
    tauri::async_runtime::spawn_blocking(move || providers::search_yandex_all(&token, &query))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn get_artist_profile(
    artist_name: String,
    artist_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<ArtistProfile, String> {
    let token = {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        db::get_setting(&conn, "yandex_token")?.unwrap_or_default()
    };
    tauri::async_runtime::spawn_blocking(move || {
        providers::get_artist_profile(&token, &artist_name, artist_id.as_deref())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn get_album_tracks(
    album_id: String,
    state: State<'_, AppState>,
) -> Result<Vec<TrackItem>, String> {
    let token = {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        db::get_setting(&conn, "yandex_token")?.unwrap_or_default()
    };
    tauri::async_runtime::spawn_blocking(move || {
        providers::get_album_tracks(&token, &album_id)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn get_yandex_wave(
    mood: Option<String>,
    activity: Option<String>,
    character: Option<String>,
    genre: Option<String>,
    language: Option<String>,
    queue_track_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<Vec<TrackItem>, String> {
    let token = {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        db::get_setting(&conn, "yandex_token")?.unwrap_or_default()
    };
    tauri::async_runtime::spawn_blocking(move || {
        providers::wave_yandex(
            &token,
            mood.as_deref(),
            activity.as_deref(),
            character.as_deref(),
            genre.as_deref(),
            language.as_deref(),
            queue_track_id.as_deref(),
        )
    })
    .await
    .map_err(|e| e.to_string())?
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
    // Отправляем телеметрию волны в фоне, не задерживая переключение треков
    std::thread::spawn(move || {
        let _ = providers::send_yandex_wave_feedback(
            &token,
            genre.as_deref(),
            &event_type,
            track_id.as_deref(),
            total_played_seconds,
        );
    });
    Ok(())
}

#[tauri::command]
async fn get_track_lyrics(
    track_id: Option<String>,
    title: String,
    artist: String,
    album: String,
    duration_seconds: u64,
    state: State<'_, AppState>,
) -> Result<TrackLyrics, String> {
    let token = {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        db::get_setting(&conn, "yandex_token")?.unwrap_or_default()
    };
    tauri::async_runtime::spawn_blocking(move || {
        providers::fetch_lyrics(
            track_id.as_deref(),
            &token,
            &title,
            &artist,
            &album,
            duration_seconds,
        )
    })
    .await
    .map_err(|e| e.to_string())?
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
fn set_crossfade_ms(ms: u32, state: State<AppState>) -> Result<(), String> {
    let clamped = ms.min(8000);
    {
        let player = state.player.lock().map_err(|e| e.to_string())?;
        player.set_crossfade_ms(clamped);
    }
    if let Ok(conn) = state.db.lock() {
        let _ = db::set_setting(&conn, "crossfade_ms", &clamped.to_string());
    }
    Ok(())
}

#[tauri::command]
fn get_crossfade_ms(state: State<AppState>) -> Result<u32, String> {
    let player = state.player.lock().map_err(|e| e.to_string())?;
    Ok(player.get_crossfade_ms())
}

#[tauri::command]
fn get_audio_cache_size_mb(state: State<AppState>) -> Result<f64, String> {
    let dir = {
        let player = state.player.lock().map_err(|e| e.to_string())?;
        player.cache_dir().to_path_buf()
    };
    let bytes = audio::get_cache_size_bytes(&dir);
    Ok((bytes as f64) / (1024.0 * 1024.0))
}

#[tauri::command]
fn clear_audio_cache(state: State<AppState>) -> Result<(), String> {
    let dir = {
        let player = state.player.lock().map_err(|e| e.to_string())?;
        player.cache_dir().to_path_buf()
    };
    audio::clear_cache_dir(&dir)
}

#[tauri::command]
fn prefetch_track(audio_url: String, state: State<AppState>) -> Result<(), String> {
    let ym_token = {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        db::get_setting(&conn, "yandex_token")?
    };
    let player = state.player.lock().map_err(|e| e.to_string())?;
    player.prefetch_track(&audio_url, ym_token.as_deref());
    Ok(())
}

#[tauri::command]
async fn play_track(
    track_id: String,
    audio_url: String,
    track: Option<TrackItem>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let ym_token = {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        if let Some(ref tr) = track {
            let _ = db::upsert_single_track(&conn, tr);
        }
        let _ = db::record_play(&conn, &track_id);
        db::get_setting(&conn, "yandex_token")?
    };
    // Сразу освобождаем мьютекс плеера до ожидания загрузки потока, чтобы не блокировать pause/status
    let reply_rx = {
        let player = state.player.lock().map_err(|e| e.to_string())?;
        player.play_file_async_prep(&audio_url, ym_token.as_deref())?
    };
    tauri::async_runtime::spawn_blocking(move || reply_rx.recv().map_err(|e| e.to_string())?)
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
fn pause_track(state: State<AppState>) -> Result<(), String> {
    let player = state.player.lock().map_err(|e| e.to_string())?;
    player.pause();
    let pos = player.status().position_sec;
    state.media.set_playback(false, pos);
    Ok(())
}

#[tauri::command]
fn resume_track(state: State<AppState>) -> Result<(), String> {
    let player = state.player.lock().map_err(|e| e.to_string())?;
    player.resume();
    let pos = player.status().position_sec;
    state.media.set_playback(true, pos);
    Ok(())
}

#[tauri::command]
fn update_media_metadata(
    title: String,
    artist: String,
    album: String,
    cover_url: Option<String>,
    duration_seconds: u64,
    state: State<AppState>,
) -> Result<(), String> {
    state
        .media
        .set_metadata(title, artist, album, cover_url, duration_seconds);
    state.media.set_playback(true, 0);
    Ok(())
}

#[tauri::command]
fn update_media_playback(
    is_playing: bool,
    position_sec: u64,
    state: State<AppState>,
) -> Result<(), String> {
    state.media.set_playback(is_playing, position_sec);
    Ok(())
}

#[tauri::command]
async fn toggle_desktop_widget(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<bool, String> {
    if let Some(existing) = app.get_webview_window("widget") {
        let _ = existing.close();
        let _ = app.emit("widget-visibility-changed", false);
        return Ok(false);
    }

    let (saved_x, saved_y, saved_w, saved_h) = {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        let x = db::get_setting(&conn, "widget_pos_x")
            .ok()
            .flatten()
            .and_then(|v| v.parse::<f64>().ok());
        let y = db::get_setting(&conn, "widget_pos_y")
            .ok()
            .flatten()
            .and_then(|v| v.parse::<f64>().ok());
        let w = db::get_setting(&conn, "widget_width")
            .ok()
            .flatten()
            .and_then(|v| v.parse::<f64>().ok())
            .map(|v| v.clamp(250.0, 560.0))
            .unwrap_or(392.0);
        let h = db::get_setting(&conn, "widget_height")
            .ok()
            .flatten()
            .and_then(|v| v.parse::<f64>().ok())
            .map(|v| v.clamp(128.0, 300.0))
            .unwrap_or(204.0);
        (x, y, w, h)
    };

    let (mut pos_x, mut pos_y) = (40.0_f64, 40.0_f64);
    if let (Some(x), Some(y)) = (saved_x, saved_y) {
        pos_x = x;
        pos_y = y;
    } else if let Ok(Some(monitor)) = app.primary_monitor() {
        let size = monitor.size();
        let scale = monitor.scale_factor();
        let logical_w = size.width as f64 / scale;
        let logical_h = size.height as f64 / scale;
        pos_x = (logical_w - saved_w - 28.0).max(20.0);
        pos_y = (logical_h - saved_h - 64.0).max(20.0);
    }

    let builder = WebviewWindowBuilder::new(
        &app,
        "widget",
        WebviewUrl::App("index.html?widget=1".into()),
    )
    .title("Abyss Music Widget")
    .inner_size(saved_w, saved_h)
    .min_inner_size(250.0, 128.0)
    .max_inner_size(560.0, 300.0)
    .position(pos_x, pos_y)
    .resizable(true)
    .decorations(false)
    .transparent(true)
    .shadow(false)
    .skip_taskbar(true)
    .always_on_top(true);

    let win = builder.build().map_err(|e| e.to_string())?;
    let app_handle = app.clone();
    let win_for_events = win.clone();
    win.on_window_event(move |event| match event {
        tauri::WindowEvent::Moved(pos) => {
            let scale = win_for_events.scale_factor().unwrap_or(1.0);
            let lx = pos.x as f64 / scale;
            let ly = pos.y as f64 / scale;
            if lx > -5000.0 && ly > -5000.0 {
                if let Some(st) = app_handle.try_state::<AppState>() {
                    if let Ok(conn) = st.db.lock() {
                        let _ = db::set_setting(&conn, "widget_pos_x", &lx.round().to_string());
                        let _ = db::set_setting(&conn, "widget_pos_y", &ly.round().to_string());
                    }
                }
            }
        }
        tauri::WindowEvent::Resized(size) => {
            let scale = win_for_events.scale_factor().unwrap_or(1.0);
            let lw = size.width as f64 / scale;
            let lh = size.height as f64 / scale;
            if lw >= 240.0 && lh >= 120.0 {
                if let Some(st) = app_handle.try_state::<AppState>() {
                    if let Ok(conn) = st.db.lock() {
                        let _ = db::set_setting(&conn, "widget_width", &lw.round().to_string());
                        let _ = db::set_setting(&conn, "widget_height", &lh.round().to_string());
                    }
                }
            }
        }
        tauri::WindowEvent::Destroyed => {
            let _ = app_handle.emit("widget-visibility-changed", false);
        }
        _ => {}
    });

    let _ = app.emit("widget-visibility-changed", true);
    Ok(true)
}

#[tauri::command]
fn is_desktop_widget_open(app: tauri::AppHandle) -> bool {
    app.get_webview_window("widget").is_some()
}

#[tauri::command]
fn set_widget_pinned(app: tauri::AppHandle, pinned: bool) -> Result<(), String> {
    if let Some(win) = app.get_webview_window("widget") {
        win.set_always_on_top(pinned).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn close_desktop_widget(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(win) = app.get_webview_window("widget") {
        win.close().map_err(|e| e.to_string())?;
    }
    let _ = app.emit("widget-visibility-changed", false);
    Ok(())
}

#[tauri::command]
fn request_widget_state(app: tauri::AppHandle) -> Result<(), String> {
    let _ = app.emit("widget-request-state", ());
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
    track: Option<TrackItem>,
    state: State<AppState>,
) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    if let Some(ref tr) = track {
        let _ = db::upsert_single_track(&conn, tr);
    }
    db::add_track_to_playlist(&conn, &playlist_id, &track_id)
}

#[tauri::command]
fn remove_track_from_playlist(
    playlist_id: String,
    track_id: String,
    state: State<AppState>,
) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::remove_track_from_playlist(&conn, &playlist_id, &track_id)
}

#[tauri::command]
fn get_playlist_tracks(playlist_id: String, state: State<AppState>) -> Result<Vec<TrackItem>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::get_playlist_tracks(&conn, &playlist_id)
}

#[tauri::command]
fn rename_playlist(id: String, name: String, state: State<AppState>) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::rename_playlist(&conn, &id, &name)
}

#[tauri::command]
fn delete_playlist(id: String, state: State<AppState>) -> Result<(), String> {
    let mut conn = state.db.lock().map_err(|e| e.to_string())?;
    db::delete_playlist(&mut conn, &id)
}

// ─── История прослушиваний ───────────────────────────────────────────────────

#[tauri::command]
fn get_recent_tracks(limit: Option<usize>, state: State<AppState>) -> Result<Vec<TrackItem>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::get_recent_tracks(&conn, limit.unwrap_or(20))
}

#[tauri::command]
fn get_top_tracks(limit: Option<usize>, state: State<AppState>) -> Result<Vec<TrackItem>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::get_top_tracks(&conn, limit.unwrap_or(20))
}

// ─── Персистентная очередь ───────────────────────────────────────────────────

#[derive(serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueueStatePayload {
    pub track_ids: Vec<String>,
    pub current_track_id: Option<String>,
    pub position_sec: u64,
    #[serde(default)]
    pub queue_tracks: Vec<TrackItem>,
}

#[tauri::command]
fn save_queue_state(payload: QueueStatePayload, state: State<AppState>) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::save_queue_state(
        &conn,
        &payload.track_ids,
        payload.current_track_id.as_deref(),
        payload.position_sec,
        &payload.queue_tracks,
    )
}

#[tauri::command]
fn load_queue_state(state: State<AppState>) -> Result<Option<QueueStatePayload>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    Ok(db::load_queue_state(&conn)?.map(|qs| QueueStatePayload {
        track_ids: qs.track_ids,
        current_track_id: qs.current_track_id,
        position_sec: qs.position_sec,
        queue_tracks: qs.queue_tracks,
    }))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(move |app| {
            let app_dir = app.path().app_data_dir().expect("Не найден каталог данных");
            let cache_dir = app_dir.join("audio_cache");
            let audio_player =
                AudioPlayer::new(cache_dir).expect("Не удалось инициализировать аудиодвижок");

            let conn = db::init_database(app.handle()).expect("Ошибка инициализации SQLite");
            if let Ok(Some(saved_eq)) = db::get_setting(&conn, "eq_gains") {
                if let Ok(arr) = serde_json::from_str::<[f32; 5]>(&saved_eq) {
                    audio_player.set_eq_gains(arr);
                }
            }
            if let Ok(Some(saved_cf)) = db::get_setting(&conn, "crossfade_ms") {
                if let Ok(ms) = saved_cf.parse::<u32>() {
                    audio_player.set_crossfade_ms(ms);
                }
            }

            #[cfg(target_os = "windows")]
            let hwnd_ptr = app
                .get_webview_window("main")
                .and_then(|w| w.hwnd().ok())
                .map(|h| h.0 as usize);
            #[cfg(not(target_os = "windows"))]
            let hwnd_ptr = None;

            let media_controls = MediaControlsManager::new(app.handle().clone(), hwnd_ptr);

            app.manage(AppState {
                db: Mutex::new(conn),
                player: Mutex::new(audio_player),
                media: media_controls,
            });

            // ── Глобальные горячие клавиши ───────────────────────────────────
            global_hotkeys::start_global_hotkeys(app.handle().clone());

            // ── Системный трей ────────────────────────────────────────────────
            let show_item = MenuItem::with_id(app, "show", "Открыть Abyss Music", true, None::<&str>)?;
            let toggle_item = MenuItem::with_id(app, "toggle", "Пауза / Играть", true, None::<&str>)?;
            let next_item = MenuItem::with_id(app, "next", "Следующий трек", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "Выйти", true, None::<&str>)?;
            let tray_menu =
                Menu::with_items(app, &[&show_item, &toggle_item, &next_item, &quit_item])?;

            let mut tray_builder = TrayIconBuilder::new()
                .tooltip("Abyss Music")
                .menu(&tray_menu)
                .show_menu_on_left_click(false)
                .on_menu_event(move |app, event| match event.id.as_ref() {
                    "show" => {
                        if let Some(win) = app.get_webview_window("main") {
                            let _ = win.show();
                            let _ = win.unminimize();
                            let _ = win.set_focus();
                        }
                    }
                    "toggle" => {
                        let _ = app.emit("media-control", "toggle");
                    }
                    "next" => {
                        let _ = app.emit("media-control", "next");
                    }
                    "quit" => {
                        app.exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(win) = app.get_webview_window("main") {
                            if win.is_visible().unwrap_or(false) {
                                let _ = win.hide();
                            } else {
                                let _ = win.show();
                                let _ = win.unminimize();
                                let _ = win.set_focus();
                            }
                        }
                    }
                });

            if let Some(icon) = app.default_window_icon().cloned() {
                tray_builder = tray_builder.icon(icon);
            }
            let tray = tray_builder.build(app)?;
            app.manage(tray);

            // При закрытии главного окна — прятать в трей вместо выхода
            if let Some(main_win) = app.get_webview_window("main") {
                let app_handle_close = app.handle().clone();
                main_win.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        if let Some(w) = app_handle_close.get_webview_window("main") {
                            let _ = w.hide();
                        }
                    }
                });
            }

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
            search_yandex_all,
            resolve_yandex_tracks,
            get_artist_profile,
            get_album_tracks,
            get_yandex_wave,
            send_wave_feedback,
            get_track_lyrics,
            set_eq_gains,
            get_eq_gains,
            set_crossfade_ms,
            get_crossfade_ms,
            get_audio_cache_size_mb,
            clear_audio_cache,
            prefetch_track,
            play_track,
            pause_track,
            resume_track,
            update_media_metadata,
            update_media_playback,
            toggle_desktop_widget,
            is_desktop_widget_open,
            set_widget_pinned,
            close_desktop_widget,
            request_widget_state,
            seek_track,
            set_volume,
            toggle_mute,
            get_playback_status,
            toggle_favorite,
            get_playlists,
            create_playlist,
            add_track_to_playlist,
            remove_track_from_playlist,
            get_playlist_tracks,
            rename_playlist,
            delete_playlist,
            get_recent_tracks,
            get_top_tracks,
            save_queue_state,
            load_queue_state
        ])
        .run(tauri::generate_context!())
        .expect("Ошибка запуска Abyss Music");
}