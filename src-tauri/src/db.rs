use std::fs;
use rusqlite::{params, Connection, OptionalExtension};
use tauri::{AppHandle, Manager};
use crate::models::{PlaylistItem, TrackItem};

pub fn init_database(app: &AppHandle) -> Result<Connection, String> {
    let app_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&app_dir).map_err(|e| e.to_string())?;
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
        );"
    )
    .map_err(|e| e.to_string())?;

    Ok(conn)
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
        .prepare("SELECT id, title, artist, album, duration_seconds, source_type, audio_url, cover_url, is_favorite FROM tracks ORDER BY title ASC")
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
    conn.execute(
        "UPDATE tracks SET play_count = play_count + 1 WHERE id = ?1",
        params![track_id],
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