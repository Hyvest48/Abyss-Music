use std::fs;
use std::path::{Path, PathBuf};
use lofty::config::ParseOptions;
use lofty::file::{AudioFile, TaggedFileExt};
use lofty::probe::Probe;
use lofty::tag::Accessor;
use walkdir::WalkDir;
use crate::models::TrackItem;

const SUPPORTED_EXT: &[&str] = &["mp3", "flac", "wav", "ogg", "m4a", "aac"];

fn get_covers_cache_dir() -> Option<PathBuf> {
    let base = std::env::var_os("LOCALAPPDATA")
        .or_else(|| std::env::var_os("HOME"))
        .map(PathBuf::from)?;
    let dir = base.join("abyss-music").join("covers");
    fs::create_dir_all(&dir).ok()?;
    Some(dir)
}

pub fn scan_directory(dir_path: &str) -> Vec<TrackItem> {
    let mut tracks = Vec::new();
    let cache_dir = get_covers_cache_dir();

    for entry in WalkDir::new(dir_path).into_iter().filter_map(|e| e.ok()) {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }

        let ext_ok = path
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| SUPPORTED_EXT.contains(&e.to_lowercase().as_str()))
            .unwrap_or(false);

        if !ext_ok {
            continue;
        }

        tracks.push(read_track_metadata(path, cache_dir.as_deref()));
    }

    tracks
}

fn read_track_metadata(path: &Path, cache_dir: Option<&Path>) -> TrackItem {
    let path_str = path.to_string_lossy().to_string();
    let hash = format!("{:x}", md5::compute(path_str.as_bytes()));
    let fallback_title = path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("Без названия")
        .to_string();

    if let Ok(tagged_file) = Probe::open(path)
        .and_then(|p| p.options(ParseOptions::new().read_cover_art(true)).read())
    {
        let duration_seconds = tagged_file.properties().duration().as_secs();
        let tag = tagged_file.primary_tag().or_else(|| tagged_file.first_tag());

        let title = tag
            .and_then(|t| t.title().map(|s| s.to_string()))
            .filter(|s| !s.trim().is_empty())
            .unwrap_or(fallback_title);

        let artist = tag
            .and_then(|t| t.artist().map(|s| s.to_string()))
            .filter(|s| !s.trim().is_empty())
            .unwrap_or_else(|| "Локальный исполнитель".to_string());

        let album = tag
            .and_then(|t| t.album().map(|s| s.to_string()))
            .filter(|s| !s.trim().is_empty())
            .unwrap_or_else(|| "Локальная медиатека".to_string());

        let cover_url = tag
            .and_then(|t| t.pictures().first())
            .and_then(|pic| {
                let dir = cache_dir?;
                let cover_path = dir.join(format!("{}.jpg", hash));
                if !cover_path.exists() {
                    fs::write(&cover_path, pic.data()).ok()?;
                }
                Some(cover_path.to_string_lossy().to_string())
            });

        return TrackItem {
            id: format!("local-{}", hash),
            title,
            artist,
            album,
            duration_seconds,
            source_type: "local".to_string(),
            audio_url: path_str,
            cover_url,
            is_favorite: false,
        };
    }

    TrackItem {
        id: format!("local-{}", hash),
        title: fallback_title,
        artist: "Локальный исполнитель".to_string(),
        album: "Локальная медиатека".to_string(),
        duration_seconds: 0,
        source_type: "local".to_string(),
        audio_url: path_str,
        cover_url: None,
        is_favorite: false,
    }
}