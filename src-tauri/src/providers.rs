use std::time::Duration;
use serde::Deserialize;
use crate::models::TrackItem;

const AUDIUS_HOST: &str = "https://discoveryprovider.audius.co/v1";
const APP_NAME: &str = "AbyssMusic";

#[derive(Deserialize)]
struct AudiusResponse {
    data: Vec<AudiusTrack>,
}

#[derive(Deserialize)]
struct AudiusTrack {
    id: String,
    title: String,
    duration: Option<u64>,
    genre: Option<String>,
    user: AudiusUser,
    artwork: Option<AudiusArtwork>,
}

#[derive(Deserialize)]
struct AudiusUser {
    name: String,
}

#[derive(Deserialize)]
struct AudiusArtwork {
    #[serde(rename = "480x480")]
    medium: Option<String>,
    #[serde(rename = "150x150")]
    small: Option<String>,
}

fn http_client() -> Result<reqwest::blocking::Client, String> {
    reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(8))
        .build()
        .map_err(|e| e.to_string())
}

fn map_audius_track(t: AudiusTrack) -> TrackItem {
    let cover_url = t.artwork.and_then(|a| a.medium.or(a.small));

    TrackItem {
        id: format!("audius-{}", t.id),
        title: t.title,
        artist: t.user.name,
        album: t.genre.unwrap_or_else(|| "Audius Stream".to_string()),
        duration_seconds: t.duration.unwrap_or(0),
        source_type: "audius".to_string(),
        audio_url: format!("{}/tracks/{}/stream?app_name={}", AUDIUS_HOST, t.id, APP_NAME),
        cover_url,
        is_favorite: false,
    }
}

fn map_mood_keyword(mood: &str) -> &'static str {
    match mood.trim() {
        "Бодрое" | "Энергичное" => "energetic",
        "Спокойное" | "Расслабленное" => "chill",
        "Грустное" | "Меланхоличное" => "sad",
        "Эпичное" | "Мощное" => "epic",
        "Романтичное" => "romantic",
        _ => "vibe",
    }
}

fn map_activity_keyword(activity: &str) -> &'static str {
    match activity.trim() {
        "Для кода" | "Для фокуса" | "Работа" | "Учёба" => "coding lofi",
        "Тренировка" | "Спорт" => "workout",
        "В дорогу" | "За рулём" => "night drive",
        "Перед сном" | "Отдых" => "ambient",
        "Вечеринка" => "club",
        _ => "instrumental",
    }
}

fn map_genre_keyword(genre: &str) -> &'static str {
    match genre.trim() {
        "Хип-хоп" | "Рэп" => "hip hop",
        "Электроника" => "electronic",
        "Фонк" => "phonk",
        "Рок" => "rock",
        "Поп" => "pop",
        "Лоу-фай" | "Lo-Fi" => "lofi",
        "Джаз" => "jazz",
        "Классика" => "classical",
        "Метал" => "metal",
        _ => "electronic",
    }
}

fn map_audius_trending_genre(genre: &str) -> Option<&'static str> {
    match genre.trim() {
        "Хип-хоп" | "Рэп" => Some("Hip-Hop/Rap"),
        "Электроника" | "Фонк" | "Лоу-фай" | "Lo-Fi" => Some("Electronic"),
        "Рок" => Some("Rock"),
        "Поп" => Some("Pop"),
        "Джаз" => Some("Jazz"),
        "Классика" => Some("Classical"),
        "Метал" => Some("Metal"),
        _ => None,
    }
}

pub fn search_audius(query: &str) -> Result<Vec<TrackItem>, String> {
    let client = http_client()?;
    let url = format!("{}/tracks/search", AUDIUS_HOST);
    let resp: AudiusResponse = client
        .get(&url)
        .query(&[("query", query), ("app_name", APP_NAME)])
        .send()
        .map_err(|e| e.to_string())?
        .json()
        .map_err(|e| e.to_string())?;

    Ok(resp.data.into_iter().take(25).map(map_audius_track).collect())
}

fn fetch_audius_trending(genre: Option<&str>) -> Result<Vec<TrackItem>, String> {
    let client = http_client()?;
    let url = format!("{}/tracks/trending", AUDIUS_HOST);
    let mut req = client.get(&url).query(&[("app_name", APP_NAME)]);
    if let Some(g) = genre.and_then(map_audius_trending_genre) {
        req = req.query(&[("genre", g)]);
    }

    let resp: AudiusResponse = req
        .send()
        .map_err(|e| e.to_string())?
        .json()
        .map_err(|e| e.to_string())?;

    Ok(resp.data.into_iter().take(25).map(map_audius_track).collect())
}

pub fn wave_audius(
    mood: Option<&str>,
    activity: Option<&str>,
    genre: Option<&str>,
) -> Result<Vec<TrackItem>, String> {
    // 1. Пробуем поиск по комбинации переведённых тегов (не более 2-3 слов, чтобы не сужать выдачу до нуля)
    let mut keywords = Vec::new();
    if let Some(g) = genre {
        keywords.push(map_genre_keyword(g));
    }
    if let Some(a) = activity {
        keywords.push(map_activity_keyword(a));
    } else if let Some(m) = mood {
        keywords.push(map_mood_keyword(m));
    }

    if !keywords.is_empty() {
        let query = keywords.join(" ");
        if let Ok(tracks) = search_audius(&query) {
            if !tracks.is_empty() {
                return Ok(tracks);
            }
        }
    }

    // 2. Если по связке тегов пусто — ищем только по жанру
    if let Some(g) = genre {
        if let Ok(tracks) = search_audius(map_genre_keyword(g)) {
            if !tracks.is_empty() {
                return Ok(tracks);
            }
        }
    }

    // 3. Резервный вариант — всегда отдаём актуальные тренды Audius (по жанру или общие)
    fetch_audius_trending(genre)
}

pub fn search_custom_api(base_url: &str, query: &str) -> Result<Vec<TrackItem>, String> {
    let clean_base = base_url.trim_end_matches('/');
    if clean_base.is_empty() {
        return Ok(Vec::new());
    }
    let client = http_client()?;
    let url = format!("{}/api/tracks/search", clean_base);
    let mut tracks: Vec<TrackItem> = client
        .get(&url)
        .query(&[("q", query)])
        .send()
        .map_err(|e| e.to_string())?
        .json()
        .map_err(|e| e.to_string())?;

    for t in &mut tracks {
        t.source_type = "custom".to_string();
        if t.audio_url.starts_with('/') {
            t.audio_url = format!("{}{}", clean_base, t.audio_url);
        }
    }
    Ok(tracks)
}

pub fn wave_custom_api(
    base_url: &str,
    mood: Option<&str>,
    activity: Option<&str>,
    character: Option<&str>,
    genre: Option<&str>,
) -> Result<Vec<TrackItem>, String> {
    let clean_base = base_url.trim_end_matches('/');
    if clean_base.is_empty() {
        return Ok(Vec::new());
    }
    let client = http_client()?;
    let url = format!("{}/api/wave", clean_base);
    let mut req = client.get(&url);
    if let Some(v) = mood {
        req = req.query(&[("mood", v)]);
    }
    if let Some(v) = activity {
        req = req.query(&[("activity", v)]);
    }
    if let Some(v) = character {
        req = req.query(&[("character", v)]);
    }
    if let Some(v) = genre {
        req = req.query(&[("genre", v)]);
    }

    let mut tracks: Vec<TrackItem> = req
        .send()
        .map_err(|e| e.to_string())?
        .json()
        .map_err(|e| e.to_string())?;

    for t in &mut tracks {
        t.source_type = "custom".to_string();
        if t.audio_url.starts_with('/') {
            t.audio_url = format!("{}{}", clean_base, t.audio_url);
        }
    }
    Ok(tracks)
}