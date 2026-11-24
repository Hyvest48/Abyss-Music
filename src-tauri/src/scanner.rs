use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::path::Path;
use lofty::prelude::*;
use lofty::probe::Probe;
use walkdir::WalkDir;
use crate::models::TrackItem;

const AUDIO_EXTS: &[&str] = &["mp3", "flac", "wav", "ogg", "m4a", "aac"];

fn hash_path(path: &str) -> String {
    let mut hasher = DefaultHasher::new();
    path.hash(&mut hasher);
    format!("trk-{:x}", hasher.finish())
}

pub fn scan_directory(folder_path: &str) -> Vec<TrackItem> {
    let mut tracks = Vec::new();

    for entry in WalkDir::new(folder_path).into_iter().filter_map(|e| e.ok()) {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }

        let ext = path
            .extension()
            .and_then(|s| s.to_str())
            .map(|s| s.to_lowercase())
            .unwrap_or_default();

        if !AUDIO_EXTS.contains(&ext.as_str()) {
            continue;
        }

        let path_str = path.to_string_lossy().to_string();
        let fallback_title = Path::new(path)
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("Без названия")
            .to_string();

        let mut title = fallback_title;
        let mut artist = "Неизвестный исполнитель".to_string();
        let mut album = "Локальная коллекция".to_string();
        let mut duration_seconds = 0;

        if let Ok(tagged_file) = Probe::open(path).and_then(|p| p.read()) {
            duration_seconds = tagged_file.properties().duration().as_secs();
            if let Some(tag) = tagged_file.primary_tag().or_else(|| tagged_file.first_tag()) {
                if let Some(t) = tag.title() {
                    if !t.trim().is_empty() {
                        title = t.to_string();
                    }
                }
                if let Some(a) = tag.artist() {
                    if !a.trim().is_empty() {
                        artist = a.to_string();
                    }
                }
                if let Some(al) = tag.album() {
                    if !al.trim().is_empty() {
                        album = al.to_string();
                    }
                }
            }
        }

        tracks.push(TrackItem {
            id: hash_path(&path_str),
            title,
            artist,
            album,
            duration_seconds,
            source_type: "local".to_string(),
            audio_url: path_str,
            cover_url: None,
            is_favorite: false,
        });
    }

    tracks
}
