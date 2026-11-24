use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::path::Path;
use lofty::file::{AudioFile, TaggedFileExt};
use lofty::probe::Probe;
use lofty::tag::Accessor;
use walkdir::WalkDir;
use crate::models::TrackItem;

const SUPPORTED_EXT: &[&str] = &["mp3", "flac", "wav", "ogg", "m4a", "aac"];

fn make_track_id(path: &str) -> String {
    let mut hasher = DefaultHasher::new();
    path.hash(&mut hasher);
    format!("loc-{:x}", hasher.finish())
}

pub fn scan_directory(folder_path: &str) -> Vec<TrackItem> {
    let mut tracks = Vec::new();

    for entry in WalkDir::new(folder_path)
        .follow_links(true)
        .into_iter()
        .filter_map(|e| e.ok())
    {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }

        let ext_ok = path
            .extension()
            .and_then(|s| s.to_str())
            .map(|s| SUPPORTED_EXT.contains(&s.to_lowercase().as_str()))
            .unwrap_or(false);

        if !ext_ok {
            continue;
        }

        if let Some(track) = extract_track(path) {
            tracks.push(track);
        }
    }

    tracks
}

fn extract_track(path: &Path) -> Option<TrackItem> {
    let full_path = path.to_string_lossy().to_string();
    let fallback_title = path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("Без названия")
        .to_string();

    let tagged_file = Probe::open(path).ok()?.read().ok()?;
    let duration_seconds = tagged_file.properties().duration().as_secs();

    let tag = tagged_file
        .primary_tag()
        .or_else(|| tagged_file.first_tag());

    let title = tag
        .and_then(|t| t.title().map(|s| s.to_string()))
        .filter(|s| !s.trim().is_empty())
        .unwrap_or(fallback_title);

    let artist = tag
        .and_then(|t| t.artist().map(|s| s.to_string()))
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| "Неизвестный исполнитель".to_string());

    let album = tag
        .and_then(|t| t.album().map(|s| s.to_string()))
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| "Без альбома".to_string());

    Some(TrackItem {
        id: make_track_id(&full_path),
        title,
        artist,
        album,
        duration_seconds,
        source_type: "local".to_string(),
        audio_url: full_path,
        cover_url: None,
        is_favorite: false,
    })
}