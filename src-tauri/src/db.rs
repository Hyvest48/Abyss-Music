use std::fs;
use std::path::Path;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};
use crate::models::{PlaylistItem, TrackItem};

pub fn init_database_at(app_dir: &Path) -> Result<Connection, String> {
    fs::create_dir_all(app_dir).map_err(|e| e.to_string())?;
    let db_path = app_dir.join("abyss_music.db");
    let conn = Connection::open(db_path).map_err(|e| e.to_string())?;

    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS tracks (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            artist TEXT NOT NULL,
            album TEXT NOT NULL,
            duration_seconds INTEGER NOT NULL,
            source_type TEXT NOT NULL,
            audio_url TEXT NOT NULL UNIQUE,
            cover_url TEXT,
            is_favorite INTEGER NOT NULL DEFAULT 0,
            play_count INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS playlists (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            cover_url TEXT
        );
        CREATE TABLE IF NOT EXISTS playlist_tracks (
            playlist_id TEXT NOT NULL,
            track_id TEXT NOT NULL,
            PRIMARY KEY (playlist_id, track_id)
        );
        CREATE TABLE IF NOT EXISTS app_settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS play_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            track_id TEXT NOT NULL,
            played_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_play_history_played_at ON play_history(played_at DESC);
        CREATE TABLE IF NOT EXISTS queue_state (
            id INTEGER PRIMARY KEY CHECK(id=1),
            track_ids TEXT NOT NULL DEFAULT '[]',
            current_track_id TEXT,
            position_sec INTEGER NOT NULL DEFAULT 0,
            queue_json TEXT NOT NULL DEFAULT '[]'
        );
        CREATE TABLE IF NOT EXISTS artist_stats (
            artist_name TEXT PRIMARY KEY,
            total_seconds INTEGER NOT NULL DEFAULT 0
        );"
    )
    .map_err(|e| e.to_string())?;

    let _ = conn.execute(
        "ALTER TABLE queue_state ADD COLUMN queue_json TEXT NOT NULL DEFAULT '[]'",
        [],
    );

    Ok(conn)
}

#[allow(dead_code)]
pub fn init_database(app: &AppHandle) -> Result<Connection, String> {
    let app_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    init_database_at(&app_dir)
}

pub fn get_setting(conn: &Connection, key: &str) -> Result<Option<String>, String> {
    conn.query_row(
        "SELECT value FROM app_settings WHERE key = ?1",
        params![key],
        |row| row.get(0),
    )
    .optional()
    .map_err(|e| e.to_string())
}

pub fn set_setting(conn: &Connection, key: &str, value: &str) -> Result<(), String> {
    conn.execute(
        "INSERT INTO app_settings (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![key, value],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn delete_setting(conn: &Connection, key: &str) -> Result<(), String> {
    conn.execute("DELETE FROM app_settings WHERE key = ?1", params![key])
        .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn get_all_tracks(conn: &Connection) -> Result<Vec<TrackItem>, String> {
    let mut stmt = conn
        .prepare("SELECT id, title, artist, album, duration_seconds, source_type, audio_url, cover_url, is_favorite FROM tracks WHERE source_type = 'local' ORDER BY title ASC")
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([], |row| {
            Ok(TrackItem {
                id: row.get(0)?,
                title: row.get(1)?,
                artist: row.get(2)?,
                album: row.get(3)?,
                duration_seconds: row.get::<_, i64>(4)? as u64,
                source_type: row.get(5)?,
                audio_url: row.get(6)?,
                cover_url: row.get(7)?,
                is_favorite: row.get::<_, i64>(8)? != 0,
            })
        })
        .map_err(|e| e.to_string())?;

    let mut tracks = Vec::new();
    for track in rows {
        tracks.push(track.map_err(|e| e.to_string())?);
    }
    Ok(tracks)
}

pub fn upsert_single_track(conn: &Connection, t: &TrackItem) -> Result<(), String> {
    conn.execute(
        "INSERT INTO tracks (id, title, artist, album, duration_seconds, source_type, audio_url, cover_url, is_favorite)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
         ON CONFLICT(audio_url) DO UPDATE SET
           title = excluded.title,
           artist = excluded.artist,
           album = excluded.album,
           duration_seconds = excluded.duration_seconds,
           cover_url = COALESCE(excluded.cover_url, tracks.cover_url)",
        params![
            t.id,
            t.title,
            t.artist,
            t.album,
            t.duration_seconds as i64,
            t.source_type,
            t.audio_url,
            t.cover_url,
            if t.is_favorite { 1 } else { 0 }
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn upsert_tracks(conn: &mut Connection, tracks: &[TrackItem]) -> Result<(), String> {
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    for t in tracks {
        tx.execute(
            "INSERT INTO tracks (id, title, artist, album, duration_seconds, source_type, audio_url, cover_url, is_favorite)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
             ON CONFLICT(audio_url) DO UPDATE SET
               title = excluded.title,
               artist = excluded.artist,
               album = excluded.album,
               duration_seconds = excluded.duration_seconds,
               cover_url = COALESCE(excluded.cover_url, tracks.cover_url)",
            params![
                t.id,
                t.title,
                t.artist,
                t.album,
                t.duration_seconds as i64,
                t.source_type,
                t.audio_url,
                t.cover_url,
                if t.is_favorite { 1 } else { 0 }
            ],
        )
        .map_err(|e| e.to_string())?;
    }
    tx.commit().map_err(|e| e.to_string())
}

pub fn record_play(conn: &Connection, track_id: &str) -> Result<(), String> {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    conn.execute(
        "UPDATE tracks SET play_count = play_count + 1 WHERE id = ?1",
        params![track_id],
    )
    .map_err(|e| e.to_string())?;
    // Записываем в историю прослушиваний
    conn.execute(
        "INSERT INTO play_history (track_id, played_at) VALUES (?1, ?2)",
        params![track_id, now],
    )
    .map_err(|e| e.to_string())?;
    // Держим историю не более 500 записей
    conn.execute(
        "DELETE FROM play_history WHERE id NOT IN (SELECT id FROM play_history ORDER BY played_at DESC LIMIT 500)",
        [],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn toggle_favorite(conn: &Connection, track_id: &str) -> Result<bool, String> {
    let updated = conn
        .execute(
            "UPDATE tracks SET is_favorite = CASE WHEN is_favorite = 1 THEN 0 ELSE 1 END WHERE id = ?1",
            params![track_id],
        )
        .map_err(|e| e.to_string())?;

    if updated == 0 {
        return Ok(false);
    }

    let is_fav: i64 = conn
        .query_row(
            "SELECT is_favorite FROM tracks WHERE id = ?1",
            params![track_id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;

    Ok(is_fav != 0)
}

pub fn set_track_favorite(
    conn: &Connection,
    track_id: &str,
    is_favorite: bool,
) -> Result<(), String> {
    conn.execute(
        "UPDATE tracks SET is_favorite = ?1 WHERE id = ?2",
        params![if is_favorite { 1 } else { 0 }, track_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn get_playlists(conn: &Connection) -> Result<Vec<PlaylistItem>, String> {
    let mut stmt = conn
        .prepare("SELECT id, name, cover_url FROM playlists")
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, Option<String>>(2)?,
            ))
        })
        .map_err(|e| e.to_string())?;

    let mut playlists = Vec::new();
    for r in rows {
        let (id, name, cover_url) = r.map_err(|e| e.to_string())?;
        let mut track_stmt = conn
            .prepare("SELECT track_id FROM playlist_tracks WHERE playlist_id = ?1")
            .map_err(|e| e.to_string())?;
        let track_rows = track_stmt
            .query_map(params![&id], |tr| tr.get::<_, String>(0))
            .map_err(|e| e.to_string())?;

        let mut track_ids = Vec::new();
        for tid in track_rows {
            track_ids.push(tid.map_err(|e| e.to_string())?);
        }

        playlists.push(PlaylistItem {
            id,
            name,
            cover_url,
            track_ids,
        });
    }
    Ok(playlists)
}

pub fn create_playlist(conn: &Connection, id: &str, name: &str) -> Result<PlaylistItem, String> {
    conn.execute(
        "INSERT INTO playlists (id, name, cover_url) VALUES (?1, ?2, NULL)",
        params![id, name],
    )
    .map_err(|e| e.to_string())?;

    Ok(PlaylistItem {
        id: id.to_string(),
        name: name.to_string(),
        cover_url: None,
        track_ids: Vec::new(),
    })
}

pub fn add_track_to_playlist(conn: &Connection, playlist_id: &str, track_id: &str) -> Result<(), String> {
    conn.execute(
        "INSERT OR IGNORE INTO playlist_tracks (playlist_id, track_id) VALUES (?1, ?2)",
        params![playlist_id, track_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn remove_track_from_playlist(
    conn: &Connection,
    playlist_id: &str,
    track_id: &str,
) -> Result<(), String> {
    conn.execute(
        "DELETE FROM playlist_tracks WHERE playlist_id = ?1 AND track_id = ?2",
        params![playlist_id, track_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn get_playlist_tracks(conn: &Connection, playlist_id: &str) -> Result<Vec<TrackItem>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT t.id, t.title, t.artist, t.album, t.duration_seconds,
                    t.source_type, t.audio_url, t.cover_url, t.is_favorite
             FROM playlist_tracks pt
             JOIN tracks t ON t.id = pt.track_id
             WHERE pt.playlist_id = ?1",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map(params![playlist_id], |row| {
            Ok(TrackItem {
                id: row.get(0)?,
                title: row.get(1)?,
                artist: row.get(2)?,
                album: row.get(3)?,
                duration_seconds: row.get::<_, i64>(4)? as u64,
                source_type: row.get(5)?,
                audio_url: row.get(6)?,
                cover_url: row.get(7)?,
                is_favorite: row.get::<_, i64>(8)? != 0,
            })
        })
        .map_err(|e| e.to_string())?;

    let mut tracks = Vec::new();
    for t in rows {
        tracks.push(t.map_err(|e| e.to_string())?);
    }
    Ok(tracks)
}

pub fn rename_playlist(conn: &Connection, id: &str, name: &str) -> Result<(), String> {
    conn.execute(
        "UPDATE playlists SET name = ?1 WHERE id = ?2",
        params![name, id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn delete_playlist(conn: &mut Connection, id: &str) -> Result<(), String> {
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    tx.execute(
        "DELETE FROM playlist_tracks WHERE playlist_id = ?1",
        params![id],
    )
    .map_err(|e| e.to_string())?;
    tx.execute("DELETE FROM playlists WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

/// Возвращает `limit` последних прослушанных треков (без дублей — берём первый вхождение).
pub fn get_recent_tracks(conn: &Connection, limit: usize) -> Result<Vec<TrackItem>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT t.id, t.title, t.artist, t.album, t.duration_seconds,
                    t.source_type, t.audio_url, t.cover_url, t.is_favorite
             FROM play_history ph
             JOIN tracks t ON t.id = ph.track_id
             GROUP BY ph.track_id
             ORDER BY MAX(ph.played_at) DESC
             LIMIT ?1",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map(params![limit as i64], |row| {
            Ok(TrackItem {
                id: row.get(0)?,
                title: row.get(1)?,
                artist: row.get(2)?,
                album: row.get(3)?,
                duration_seconds: row.get::<_, i64>(4)? as u64,
                source_type: row.get(5)?,
                audio_url: row.get(6)?,
                cover_url: row.get(7)?,
                is_favorite: row.get::<_, i64>(8)? != 0,
            })
        })
        .map_err(|e| e.to_string())?;

    let mut tracks = Vec::new();
    for t in rows {
        tracks.push(t.map_err(|e| e.to_string())?);
    }
    Ok(tracks)
}

/// Возвращает `limit` самых часто слушаемых треков.
pub fn get_top_tracks(conn: &Connection, limit: usize) -> Result<Vec<TrackItem>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, title, artist, album, duration_seconds,
                    source_type, audio_url, cover_url, is_favorite
             FROM tracks
             WHERE play_count > 0
             ORDER BY play_count DESC, title ASC
             LIMIT ?1",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map(params![limit as i64], |row| {
            Ok(TrackItem {
                id: row.get(0)?,
                title: row.get(1)?,
                artist: row.get(2)?,
                album: row.get(3)?,
                duration_seconds: row.get::<_, i64>(4)? as u64,
                source_type: row.get(5)?,
                audio_url: row.get(6)?,
                cover_url: row.get(7)?,
                is_favorite: row.get::<_, i64>(8)? != 0,
            })
        })
        .map_err(|e| e.to_string())?;

    let mut tracks = Vec::new();
    for t in rows {
        tracks.push(t.map_err(|e| e.to_string())?);
    }
    Ok(tracks)
}

#[derive(Debug)]
pub struct QueueState {
    pub track_ids: Vec<String>,
    pub current_track_id: Option<String>,
    pub position_sec: u64,
    pub queue_tracks: Vec<TrackItem>,
}

pub fn save_queue_state(
    conn: &Connection,
    track_ids: &[String],
    current_track_id: Option<&str>,
    position_sec: u64,
    queue_tracks: &[TrackItem],
) -> Result<(), String> {
    let ids_json = serde_json::to_string(track_ids).map_err(|e| e.to_string())?;
    // Ограничиваем сериализованный список 200 треками, чтобы не раздувать БД
    let capped: Vec<&TrackItem> = queue_tracks.iter().take(200).collect();
    let queue_json = serde_json::to_string(&capped).map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO queue_state (id, track_ids, current_track_id, position_sec, queue_json)
         VALUES (1, ?1, ?2, ?3, ?4)
         ON CONFLICT(id) DO UPDATE SET
           track_ids = excluded.track_ids,
           current_track_id = excluded.current_track_id,
           position_sec = excluded.position_sec,
           queue_json = excluded.queue_json",
        params![ids_json, current_track_id, position_sec as i64, queue_json],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn load_queue_state(conn: &Connection) -> Result<Option<QueueState>, String> {
    let result = conn
        .query_row(
            "SELECT track_ids, current_track_id, position_sec, queue_json FROM queue_state WHERE id = 1",
            [],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, Option<String>>(1)?,
                    row.get::<_, i64>(2)?,
                    row.get::<_, String>(3)?,
                ))
            },
        )
        .optional()
        .map_err(|e| e.to_string())?;

    if let Some((ids_json, current_id, pos, queue_json)) = result {
        let track_ids: Vec<String> = serde_json::from_str(&ids_json).unwrap_or_default();
        let queue_tracks: Vec<TrackItem> = serde_json::from_str(&queue_json).unwrap_or_default();
        Ok(Some(QueueState {
            track_ids,
            current_track_id: current_id,
            position_sec: pos.max(0) as u64,
            queue_tracks,
        }))
    } else {
        Ok(None)
    }
}

pub fn add_artist_listening_time(conn: &Connection, artist_raw: &str, seconds: u64) -> Result<(), String> {
    if seconds == 0 {
        return Ok(());
    }
    for part in artist_raw.split(',') {
        let clean = part.trim().to_lowercase();
        if clean.is_empty() || clean == "неизвестный исполнитель" {
            continue;
        }
        conn.execute(
            "INSERT INTO artist_stats (artist_name, total_seconds) VALUES (?1, ?2)
             ON CONFLICT(artist_name) DO UPDATE SET total_seconds = total_seconds + excluded.total_seconds",
            params![clean, seconds as i64],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

pub fn get_artist_listening_time(conn: &Connection, artist_name: &str) -> Result<u64, String> {
    let clean = artist_name.split(',').next().unwrap_or(artist_name).trim().to_lowercase();
    if clean.is_empty() {
        return Ok(0);
    }
    let secs: Option<i64> = conn
        .query_row(
            "SELECT total_seconds FROM artist_stats WHERE artist_name = ?1",
            params![clean],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    Ok(secs.unwrap_or(0).max(0) as u64)
}

// ─── Кросс-платформенный экспорт и импорт базы данных ────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncTrackRow {
    #[serde(flatten)]
    pub track: TrackItem,
    #[serde(default)]
    pub play_count: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncPlayHistoryRow {
    pub track_id: String,
    pub played_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncArtistStatRow {
    pub artist_name: String,
    pub total_seconds: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncQueueRow {
    pub track_ids: Vec<String>,
    pub current_track_id: Option<String>,
    pub position_sec: u64,
    #[serde(default)]
    pub queue_tracks: Vec<TrackItem>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FrontendSyncPrefs {
    #[serde(default)]
    pub theme_id: Option<String>,
    #[serde(default)]
    pub is_night_mode: Option<bool>,
    #[serde(default)]
    pub wave_settings: Option<serde_json::Value>,
    #[serde(default)]
    pub online_favs: Vec<TrackItem>,
    #[serde(default)]
    pub liked_artists: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AbyssSyncSnapshot {
    pub version: u32,
    pub exported_at: i64,
    pub source_device: String,
    #[serde(default)]
    pub settings: Vec<(String, String)>,
    #[serde(default)]
    pub tracks: Vec<SyncTrackRow>,
    #[serde(default)]
    pub playlists: Vec<PlaylistItem>,
    #[serde(default)]
    pub play_history: Vec<SyncPlayHistoryRow>,
    #[serde(default)]
    pub artist_stats: Vec<SyncArtistStatRow>,
    #[serde(default)]
    pub queue_state: Option<SyncQueueRow>,
    #[serde(default)]
    pub frontend_prefs: FrontendSyncPrefs,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncImportSummary {
    pub source_device: String,
    pub tracks_imported: usize,
    pub playlists_imported: usize,
    pub favorites_imported: usize,
    pub history_imported: usize,
    pub yandex_token_updated: bool,
    pub frontend_prefs: FrontendSyncPrefs,
}

pub fn export_sync_snapshot(
    conn: &Connection,
    source_device: &str,
    frontend_prefs: FrontendSyncPrefs,
) -> Result<AbyssSyncSnapshot, String> {
    let exported_at = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);

    let mut settings = Vec::new();
    {
        let mut stmt = conn
            .prepare("SELECT key, value FROM app_settings")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)))
            .map_err(|e| e.to_string())?;
        for r in rows {
            let (k, v) = r.map_err(|e| e.to_string())?;
            if k == "widget_pos_x" || k == "widget_pos_y" {
                continue;
            }
            settings.push((k, v));
        }
    }

    let mut tracks = Vec::new();
    {
        let mut stmt = conn
            .prepare(
                "SELECT id, title, artist, album, duration_seconds, source_type, audio_url, cover_url, is_favorite, play_count
                 FROM tracks",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| {
                Ok(SyncTrackRow {
                    track: TrackItem {
                        id: row.get(0)?,
                        title: row.get(1)?,
                        artist: row.get(2)?,
                        album: row.get(3)?,
                        duration_seconds: row.get::<_, i64>(4)? as u64,
                        source_type: row.get(5)?,
                        audio_url: row.get(6)?,
                        cover_url: row.get(7)?,
                        is_favorite: row.get::<_, i64>(8)? != 0,
                    },
                    play_count: row.get::<_, i64>(9)?.max(0) as u64,
                })
            })
            .map_err(|e| e.to_string())?;
        for r in rows {
            tracks.push(r.map_err(|e| e.to_string())?);
        }
    }

    let playlists = get_playlists(conn)?;

    let mut play_history = Vec::new();
    {
        let mut stmt = conn
            .prepare("SELECT track_id, played_at FROM play_history ORDER BY played_at DESC LIMIT 500")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| {
                Ok(SyncPlayHistoryRow {
                    track_id: row.get(0)?,
                    played_at: row.get(1)?,
                })
            })
            .map_err(|e| e.to_string())?;
        for r in rows {
            play_history.push(r.map_err(|e| e.to_string())?);
        }
    }

    let mut artist_stats = Vec::new();
    {
        let mut stmt = conn
            .prepare("SELECT artist_name, total_seconds FROM artist_stats")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| {
                Ok(SyncArtistStatRow {
                    artist_name: row.get(0)?,
                    total_seconds: row.get::<_, i64>(1)?.max(0) as u64,
                })
            })
            .map_err(|e| e.to_string())?;
        for r in rows {
            artist_stats.push(r.map_err(|e| e.to_string())?);
        }
    }

    let queue_state = load_queue_state(conn)?.map(|qs| SyncQueueRow {
        track_ids: qs.track_ids,
        current_track_id: qs.current_track_id,
        position_sec: qs.position_sec,
        queue_tracks: qs.queue_tracks,
    });

    Ok(AbyssSyncSnapshot {
        version: 1,
        exported_at,
        source_device: source_device.to_string(),
        settings,
        tracks,
        playlists,
        play_history,
        artist_stats,
        queue_state,
        frontend_prefs,
    })
}

fn is_track_playable_here(track: &TrackItem) -> bool {
    if track.source_type != "local" {
        return true;
    }
    Path::new(&track.audio_url).exists()
}

pub fn import_sync_snapshot(
    conn: &mut Connection,
    snapshot: &AbyssSyncSnapshot,
) -> Result<SyncImportSummary, String> {
    let tx = conn.transaction().map_err(|e| e.to_string())?;

    let mut yandex_token_updated = false;
    for (k, v) in &snapshot.settings {
        if k == "widget_pos_x" || k == "widget_pos_y" {
            continue;
        }
        if k == "yandex_token" && !v.trim().is_empty() {
            yandex_token_updated = true;
        }
        tx.execute(
            "INSERT INTO app_settings (key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![k, v],
        )
        .map_err(|e| e.to_string())?;
    }

    let mut imported_track_ids = std::collections::HashSet::new();
    let mut tracks_imported = 0usize;
    let mut favorites_imported = 0usize;

    for row in &snapshot.tracks {
        let t = &row.track;
        if !is_track_playable_here(t) {
            continue;
        }
        tx.execute(
            "INSERT INTO tracks (id, title, artist, album, duration_seconds, source_type, audio_url, cover_url, is_favorite, play_count)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
             ON CONFLICT(audio_url) DO UPDATE SET
               title = excluded.title,
               artist = excluded.artist,
               album = excluded.album,
               duration_seconds = excluded.duration_seconds,
               cover_url = COALESCE(excluded.cover_url, tracks.cover_url),
               is_favorite = CASE WHEN excluded.is_favorite = 1 THEN 1 ELSE tracks.is_favorite END,
               play_count = MAX(tracks.play_count, excluded.play_count)",
            params![
                t.id,
                t.title,
                t.artist,
                t.album,
                t.duration_seconds as i64,
                t.source_type,
                t.audio_url,
                t.cover_url,
                if t.is_favorite { 1 } else { 0 },
                row.play_count as i64,
            ],
        )
        .map_err(|e| e.to_string())?;
        imported_track_ids.insert(t.id.clone());
        tracks_imported += 1;
        if t.is_favorite {
            favorites_imported += 1;
        }
    }

    for fav in &snapshot.frontend_prefs.online_favs {
        if !is_track_playable_here(fav) {
            continue;
        }
        tx.execute(
            "INSERT INTO tracks (id, title, artist, album, duration_seconds, source_type, audio_url, cover_url, is_favorite)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 1)
             ON CONFLICT(audio_url) DO UPDATE SET
               title = excluded.title,
               artist = excluded.artist,
               album = excluded.album,
               cover_url = COALESCE(excluded.cover_url, tracks.cover_url),
               is_favorite = 1",
            params![
                fav.id,
                fav.title,
                fav.artist,
                fav.album,
                fav.duration_seconds as i64,
                fav.source_type,
                fav.audio_url,
                fav.cover_url,
            ],
        )
        .map_err(|e| e.to_string())?;
        imported_track_ids.insert(fav.id.clone());
    }

    let mut playlists_imported = 0usize;
    for pl in &snapshot.playlists {
        tx.execute(
            "INSERT INTO playlists (id, name, cover_url) VALUES (?1, ?2, ?3)
             ON CONFLICT(id) DO UPDATE SET
               name = excluded.name,
               cover_url = COALESCE(excluded.cover_url, playlists.cover_url)",
            params![pl.id, pl.name, pl.cover_url],
        )
        .map_err(|e| e.to_string())?;
        for tid in &pl.track_ids {
            if imported_track_ids.contains(tid) {
                tx.execute(
                    "INSERT OR IGNORE INTO playlist_tracks (playlist_id, track_id) VALUES (?1, ?2)",
                    params![pl.id, tid],
                )
                .map_err(|e| e.to_string())?;
            }
        }
        playlists_imported += 1;
    }

    let mut history_imported = 0usize;
    for h in &snapshot.play_history {
        if !imported_track_ids.contains(&h.track_id) {
            continue;
        }
        let exists: Option<i64> = tx
            .query_row(
                "SELECT 1 FROM play_history WHERE track_id = ?1 AND played_at = ?2 LIMIT 1",
                params![h.track_id, h.played_at],
                |row| row.get(0),
            )
            .optional()
            .map_err(|e| e.to_string())?;
        if exists.is_none() {
            tx.execute(
                "INSERT INTO play_history (track_id, played_at) VALUES (?1, ?2)",
                params![h.track_id, h.played_at],
            )
            .map_err(|e| e.to_string())?;
            history_imported += 1;
        }
    }
    tx.execute(
        "DELETE FROM play_history WHERE id NOT IN (SELECT id FROM play_history ORDER BY played_at DESC LIMIT 500)",
        [],
    )
    .map_err(|e| e.to_string())?;

    for st in &snapshot.artist_stats {
        tx.execute(
            "INSERT INTO artist_stats (artist_name, total_seconds) VALUES (?1, ?2)
             ON CONFLICT(artist_name) DO UPDATE SET total_seconds = MAX(artist_stats.total_seconds, excluded.total_seconds)",
            params![st.artist_name, st.total_seconds as i64],
        )
        .map_err(|e| e.to_string())?;
    }

    if let Some(ref qs) = snapshot.queue_state {
        let filtered_tracks: Vec<TrackItem> = qs
            .queue_tracks
            .iter()
            .filter(|t| is_track_playable_here(t))
            .cloned()
            .take(200)
            .collect();
        if !filtered_tracks.is_empty() {
            let valid_ids: Vec<String> = filtered_tracks.iter().map(|t| t.id.clone()).collect();
            let valid_cur = qs
                .current_track_id
                .as_ref()
                .filter(|id| valid_ids.iter().any(|vid| vid == *id))
                .cloned();
            let ids_json = serde_json::to_string(&valid_ids).map_err(|e| e.to_string())?;
            let queue_json = serde_json::to_string(&filtered_tracks).map_err(|e| e.to_string())?;
            tx.execute(
                "INSERT INTO queue_state (id, track_ids, current_track_id, position_sec, queue_json)
                 VALUES (1, ?1, ?2, ?3, ?4)
                 ON CONFLICT(id) DO UPDATE SET
                   track_ids = excluded.track_ids,
                   current_track_id = excluded.current_track_id,
                   position_sec = excluded.position_sec,
                   queue_json = excluded.queue_json",
                params![ids_json, valid_cur, qs.position_sec as i64, queue_json],
            )
            .map_err(|e| e.to_string())?;
        }
    }

    tx.commit().map_err(|e| e.to_string())?;

    let mut cleaned_prefs = snapshot.frontend_prefs.clone();
    cleaned_prefs.online_favs.retain(is_track_playable_here);

    Ok(SyncImportSummary {
        source_device: snapshot.source_device.clone(),
        tracks_imported,
        playlists_imported,
        favorites_imported,
        history_imported,
        yandex_token_updated,
        frontend_prefs: cleaned_prefs,
    })
}