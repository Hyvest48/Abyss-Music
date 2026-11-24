use std::path::PathBuf;
use rusqlite::{params, Connection};
use tauri::{AppHandle, Manager};
use crate::models::{PlaylistItem, TrackItem};

pub fn init_database(app: &AppHandle) -> Result<Connection, String> {
    let mut db_dir: PathBuf = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&db_dir).map_err(|e| e.to_string())?;
    db_dir.push("abyss_music.db");

    let conn = Connection::open(db_dir).map_err(|e| e.to_string())?;
    conn.execute_batch(
        "
        PRAGMA foreign_keys = ON;

        CREATE TABLE IF NOT EXISTS tracks (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            artist TEXT NOT NULL,
            album TEXT DEFAULT 'Без альбома',
            duration_seconds INTEGER DEFAULT 0,
            source_type TEXT NOT NULL,
            audio_url TEXT NOT NULL,
            cover_url TEXT,
            is_favorite INTEGER DEFAULT 0,
            added_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS playlists (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            cover_url TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS playlist_tracks (
            playlist_id TEXT NOT NULL,
            track_id TEXT NOT NULL,
            position INTEGER DEFAULT 0,
            PRIMARY KEY (playlist_id, track_id),
            FOREIGN KEY (playlist_id) REFERENCES playlists(id) ON DELETE CASCADE,
            FOREIGN KEY (track_id) REFERENCES tracks(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS play_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            track_id TEXT NOT NULL,
            played_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (track_id) REFERENCES tracks(id) ON DELETE CASCADE
        );
        ",
    )
    .map_err(|e| e.to_string())?;

    Ok(conn)
}

pub fn get_all_tracks(conn: &Connection) -> Result<Vec<TrackItem>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, title, artist, album, duration_seconds, source_type, audio_url, cover_url, is_favorite
             FROM tracks ORDER BY added_at DESC",
        )
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
                is_favorite: row.get::<_, i32>(8)? == 1,
            })
        })
        .map_err(|e| e.to_string())?;

    let mut result = Vec::new();
    for item in rows {
        result.push(item.map_err(|e| e.to_string())?);
    }
    Ok(result)
}

pub fn upsert_tracks(conn: &mut Connection, tracks: &[TrackItem]) -> Result<(), String> {
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    {
        let mut stmt = tx
            .prepare(
                "INSERT INTO tracks (id, title, artist, album, duration_seconds, source_type, audio_url, cover_url, is_favorite)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
                 ON CONFLICT(id) DO UPDATE SET
                   title = excluded.title,
                   artist = excluded.artist,
                   album = excluded.album,
                   duration_seconds = excluded.duration_seconds,
                   audio_url = excluded.audio_url",
            )
            .map_err(|e| e.to_string())?;

        for t in tracks {
            stmt.execute(params![
                t.id,
                t.title,
                t.artist,
                t.album,
                t.duration_seconds as i64,
                t.source_type,
                t.audio_url,
                t.cover_url,
                if t.is_favorite { 1 } else { 0 }
            ])
            .map_err(|e| e.to_string())?;
        }
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

pub fn toggle_favorite(conn: &Connection, track_id: &str) -> Result<bool, String> {
    conn.execute(
        "UPDATE tracks SET is_favorite = CASE WHEN is_favorite = 1 THEN 0 ELSE 1 END WHERE id = ?1",
        params![track_id],
    )
    .map_err(|e| e.to_string())?;

    let val: i32 = conn
        .query_row(
            "SELECT is_favorite FROM tracks WHERE id = ?1",
            params![track_id],
            |row| row.get(0),
        )
        .unwrap_or(0);

    Ok(val == 1)
}

pub fn record_play(conn: &Connection, track_id: &str) -> Result<(), String> {
    conn.execute(
        "INSERT INTO play_history (track_id) VALUES (?1)",
        params![track_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn get_playlists(conn: &Connection) -> Result<Vec<PlaylistItem>, String> {
    let mut pl_stmt = conn
        .prepare("SELECT id, name, cover_url FROM playlists ORDER BY created_at ASC")
        .map_err(|e| e.to_string())?;

    let pl_rows = pl_stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, Option<String>>(2)?,
            ))
        })
        .map_err(|e| e.to_string())?;

    let mut playlists = Vec::new();
    for pl in pl_rows {
        let (id, name, cover_url) = pl.map_err(|e| e.to_string())?;
        let mut tr_stmt = conn
            .prepare("SELECT track_id FROM playlist_tracks WHERE playlist_id = ?1 ORDER BY position ASC")
            .map_err(|e| e.to_string())?;

        let tr_rows = tr_stmt
            .query_map(params![&id], |row| row.get::<_, String>(0))
            .map_err(|e| e.to_string())?;

        let mut track_ids = Vec::new();
        for tid in tr_rows {
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
        "INSERT INTO playlists (id, name) VALUES (?1, ?2)",
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

pub fn add_track_to_playlist(
    conn: &Connection,
    playlist_id: &str,
    track_id: &str,
) -> Result<(), String> {
    conn.execute(
        "INSERT OR IGNORE INTO playlist_tracks (playlist_id, track_id, position)
         VALUES (?1, ?2, (SELECT COALESCE(MAX(position), 0) + 1 FROM playlist_tracks WHERE playlist_id = ?1))",
        params![playlist_id, track_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}