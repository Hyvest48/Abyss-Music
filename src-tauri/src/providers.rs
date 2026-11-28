use std::sync::OnceLock;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use serde::Serialize;
use serde_json::{json, Value};
use crate::models::TrackItem;

const YM_API: &str = "https://api.music.yandex.net";
const YM_CLIENT_HEADER: &str = "YandexMusicAndroid/24023621";
const LRCLIB_API: &str = "https://lrclib.net/api";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrackLyrics {
    pub synced_lyrics: Option<String>,
    pub plain_lyrics: Option<String>,
    pub instrumental: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArtistAlbum {
    pub id: String,
    pub title: String,
    pub year: Option<u64>,
    pub release_date: Option<String>,
    pub cover_url: Option<String>,
    pub album_type: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SimilarArtist {
    pub id: String,
    pub name: String,
    pub cover_url: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchArtistItem {
    pub id: String,
    pub name: String,
    pub cover_url: Option<String>,
    pub tracks_count: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct YandexSearchResult {
    pub artists: Vec<SearchArtistItem>,
    pub tracks: Vec<TrackItem>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArtistProfile {
    pub id: String,
    pub name: String,
    pub cover_url: Option<String>,
    pub genres: Vec<String>,
    pub tracks_count: u64,
    pub albums_count: u64,
    pub likes_count: u64,
    pub monthly_listeners: u64,
    pub popular_tracks: Vec<TrackItem>,
    pub all_tracks: Vec<TrackItem>,
    pub albums: Vec<ArtistAlbum>,
    pub similar_artists: Vec<SimilarArtist>,
}

fn iso_timestamp_now() -> String {
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64;

    let days = secs.div_euclid(86400);
    let sod = secs.rem_euclid(86400);

    let z = days + 719468;
    let era = if z >= 0 { z } else { z - 146096 } / 146097;
    let doe = (z - era * 146097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = (yoe as i64) + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = if m <= 2 { y + 1 } else { y };

    let hour = sod / 3600;
    let min = (sod % 3600) / 60;
    let sec = sod % 60;

    format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}Z",
        year, m, d, hour, min, sec
    )
}

static SHARED_HTTP_CLIENT: OnceLock<reqwest::blocking::Client> = OnceLock::new();

/// Единый пул HTTP-соединений с Keep-Alive, чтобы не тратить время на новый TLS handshake на каждый запрос
pub fn shared_http_client() -> &'static reqwest::blocking::Client {
    SHARED_HTTP_CLIENT.get_or_init(|| {
        reqwest::blocking::Client::builder()
            .no_proxy()
            .pool_max_idle_per_host(12)
            .pool_idle_timeout(Duration::from_secs(90))
            .tcp_keepalive(Duration::from_secs(30))
            .timeout(Duration::from_secs(10))
            .build()
            .expect("Не удалось создать HTTP-клиент")
    })
}

#[derive(Clone, Copy)]
struct YmClient<'a> {
    http: &'static reqwest::blocking::Client,
    token: &'a str,
}

impl<'a> YmClient<'a> {
    fn get(&self, url: &str) -> reqwest::blocking::RequestBuilder {
        self.http
            .get(url)
            .header(reqwest::header::AUTHORIZATION, format!("OAuth {}", self.token))
            .header("X-Yandex-Music-Client", YM_CLIENT_HEADER)
    }

    fn post(&self, url: &str) -> reqwest::blocking::RequestBuilder {
        self.http
            .post(url)
            .header(reqwest::header::AUTHORIZATION, format!("OAuth {}", self.token))
            .header("X-Yandex-Music-Client", YM_CLIENT_HEADER)
    }
}

fn validate_ym_id(raw: &str) -> Result<String, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty()
        || !trimmed
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == ':' || c == '-' || c == '_')
    {
        return Err("Некорректный идентификатор Яндекс Музыки".to_string());
    }
    Ok(trimmed.to_string())
}

fn send_json(req: reqwest::blocking::RequestBuilder) -> Result<Value, String> {
    req.send()
        .map_err(|e| e.to_string())?
        .error_for_status()
        .map_err(|e| format!("Ошибка API Яндекс Музыки: {}", e))?
        .json::<Value>()
        .map_err(|e| e.to_string())
}

fn ym_client(token: &str) -> Result<YmClient<'_>, String> {
    let clean = token.trim();
    if clean.is_empty() {
        return Err("Токен Яндекс Музыки не задан. Войдите в аккаунт Яндекс ID.".to_string());
    }
    Ok(YmClient {
        http: shared_http_client(),
        token: clean,
    })
}

fn extract_track_year(t: &Value) -> Option<u64> {
    t.get("year")
        .and_then(|v| v.as_u64())
        .or_else(|| {
            t.get("albums")
                .and_then(|a| a.as_array())
                .and_then(|a| a.first())
                .and_then(|a| a.get("year"))
                .and_then(|v| v.as_u64())
        })
        .or_else(|| {
            t.get("albums")
                .and_then(|a| a.as_array())
                .and_then(|a| a.first())
                .and_then(|a| a.get("releaseDate"))
                .and_then(|v| v.as_str())
                .and_then(|s| s.get(0..4))
                .and_then(|y| y.parse::<u64>().ok())
        })
}

fn parse_ym_track(t: &Value) -> Option<TrackItem> {
    let id = t.get("id")?.to_string().trim_matches('"').to_string();
    let title = t.get("title")?.as_str()?.to_string();

    let artist = t
        .get("artists")
        .and_then(|a| a.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|item| item.get("name").and_then(|n| n.as_str()))
                .collect::<Vec<_>>()
                .join(", ")
        })
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "Неизвестный исполнитель".to_string());

    let album_obj = t.get("albums").and_then(|a| a.as_array()).and_then(|a| a.first());
    let album = album_obj
        .and_then(|a| a.get("title"))
        .and_then(|v| v.as_str())
        .unwrap_or("Яндекс Музыка")
        .to_string();

    let duration_ms = t.get("durationMs").and_then(|v| v.as_u64()).unwrap_or(0);

    let cover_url = t
        .get("coverUri")
        .or_else(|| album_obj.and_then(|a| a.get("coverUri")))
        .and_then(|v| v.as_str())
        .map(|uri| format!("https://{}", uri.replace("%%", "400x400")));

    Some(TrackItem {
        id: format!("ym-{}", id),
        title,
        artist,
        album,
        duration_seconds: duration_ms / 1000,
        source_type: "yandex".to_string(),
        audio_url: format!("ym://{}", id),
        cover_url,
        is_favorite: false,
    })
}

fn parse_ym_cover(obj: &Value, size: &str) -> Option<String> {
    obj.pointer("/cover/uri")
        .or_else(|| obj.get("coverUri"))
        .or_else(|| obj.get("ogImage"))
        .and_then(|v| v.as_str())
        .map(|uri| format!("https://{}", uri.replace("%%", size)))
}

fn parse_ym_album(a: &Value) -> Option<ArtistAlbum> {
    let id = a.get("id")?.to_string().trim_matches('"').to_string();
    let title = a.get("title")?.as_str()?.to_string();
    let release_date = a
        .get("releaseDate")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let year = a.get("year").and_then(|v| v.as_u64()).or_else(|| {
        release_date
            .as_deref()
            .and_then(|s| s.get(0..4))
            .and_then(|y| y.parse::<u64>().ok())
    });
    let cover_url = parse_ym_cover(a, "400x400");
    let raw_type = a
        .get("type")
        .or_else(|| a.get("metaType"))
        .and_then(|v| v.as_str())
        .unwrap_or("album");
    let album_type = match raw_type {
        "single" => "Сингл".to_string(),
        "ep" => "EP".to_string(),
        "compilation" => "Сборник".to_string(),
        _ => "Альбом".to_string(),
    };

    Some(ArtistAlbum {
        id,
        title,
        year,
        release_date,
        cover_url,
        album_type,
    })
}

fn resolve_station_id(genre: Option<&str>) -> &'static str {
    match genre.map(|g| g.trim()) {
        Some("Хип-хоп") => "genre:rap",
        Some("Рок") => "genre:rock",
        Some("Электроника") => "genre:electronics",
        Some("Инди") => "genre:indie",
        Some("Лоу-фай") => "genre:lounge",
        Some("Акустика") => "genre:bard",
        _ => "user:onyourwave",
    }
}

pub fn get_yandex_account_name(token: &str) -> Result<String, String> {
    let client = ym_client(token)?;
    let url = format!("{}/account/status", YM_API);
    let resp = send_json(client.get(&url))?;

    let name = resp
        .pointer("/result/account/displayName")
        .or_else(|| resp.pointer("/result/account/login"))
        .and_then(|v| v.as_str())
        .ok_or("Невалидный токен Яндекс Музыки")?;

    Ok(name.to_string())
}

static YANDEX_UID_CACHE: std::sync::OnceLock<std::sync::Mutex<Option<(String, String)>>> =
    std::sync::OnceLock::new();

pub fn get_yandex_account_uid(token: &str) -> Result<String, String> {
    let trimmed = token.trim();
    if trimmed.is_empty() {
        return Err("Пустой токен Яндекс Музыки".to_string());
    }
    let cache = YANDEX_UID_CACHE.get_or_init(|| std::sync::Mutex::new(None));
    if let Ok(guard) = cache.lock() {
        if let Some((cached_tok, cached_uid)) = guard.as_ref() {
            if cached_tok == trimmed {
                return Ok(cached_uid.clone());
            }
        }
    }

    let client = ym_client(trimmed)?;
    let url = format!("{}/account/status", YM_API);
    let resp = send_json(client.get(&url))?;

    let uid_val = if let Some(uid) = resp.pointer("/result/account/uid").and_then(|v| v.as_u64()) {
        Some(uid.to_string())
    } else if let Some(uid_str) = resp.pointer("/result/account/uid").and_then(|v| v.as_str()) {
        let s = uid_str.trim();
        if !s.is_empty() { Some(s.to_string()) } else { None }
    } else if let Some(login) = resp.pointer("/result/account/login").and_then(|v| v.as_str()) {
        let s = login.trim();
        if !s.is_empty() { Some(s.to_string()) } else { None }
    } else {
        None
    };

    if let Some(uid) = uid_val {
        if let Ok(mut guard) = cache.lock() {
            *guard = Some((trimmed.to_string(), uid.clone()));
        }
        return Ok(uid);
    }

    Err("Не удалось определить UID аккаунта Яндекс".to_string())
}

pub fn search_yandex(token: &str, query: &str) -> Result<Vec<TrackItem>, String> {
    if query.trim().is_empty() {
        return Ok(Vec::new());
    }
    let client = ym_client(token)?;
    let url = format!("{}/search", YM_API);
    let resp = send_json(client.get(&url).query(&[
        ("text", query),
        ("type", "track"),
        ("page", "0"),
        ("page-size", "50"),
        ("nocorrect", "false"),
    ]))?;

    let tracks = resp
        .pointer("/result/tracks/results")
        .and_then(|v| v.as_array())
        .map(|arr| arr.iter().filter_map(parse_ym_track).collect())
        .unwrap_or_default();

    Ok(tracks)
}

pub fn resolve_yandex_tracks(token: &str, track_ids: &[String]) -> Result<Vec<TrackItem>, String> {
    let clean_ids: Vec<String> = track_ids
        .iter()
        .map(|id| id.trim_start_matches("ym-").trim_start_matches("ym://").trim().to_string())
        .filter(|id| !id.is_empty())
        .collect();

    if clean_ids.is_empty() {
        return Ok(Vec::new());
    }

    let client = ym_client(token)?;
    let url = format!("{}/tracks", YM_API);
    let joined = clean_ids.join(",");
    let resp = send_json(client.post(&url).form(&[("track-ids", joined.as_str())]))?;

    let tracks = resp
        .get("result")
        .and_then(|v| v.as_array())
        .map(|arr| arr.iter().filter_map(parse_ym_track).collect())
        .unwrap_or_default();

    Ok(tracks)
}

pub fn search_yandex_all(token: &str, query: &str) -> Result<YandexSearchResult, String> {
    if query.trim().is_empty() {
        return Ok(YandexSearchResult {
            artists: Vec::new(),
            tracks: Vec::new(),
        });
    }
    let client = ym_client(token)?;
    let url = format!("{}/search", YM_API);

    let (all_res, tracks_res) = std::thread::scope(|s| {
        let h_all = s.spawn(|| -> Result<Value, String> {
            send_json(client.get(&url).query(&[
                ("text", query),
                ("type", "all"),
                ("page", "0"),
                ("nocorrect", "false"),
            ]))
        });
        let h_tracks = s.spawn(|| -> Vec<TrackItem> {
            client
                .get(&url)
                .query(&[
                    ("text", query),
                    ("type", "track"),
                    ("page", "0"),
                    ("page-size", "50"),
                    ("nocorrect", "false"),
                ])
                .send()
                .ok()
                .and_then(|r| r.json::<Value>().ok())
                .and_then(|val| {
                    val.pointer("/result/tracks/results")
                        .and_then(|v| v.as_array())
                        .map(|arr| arr.iter().filter_map(parse_ym_track).collect())
                })
                .unwrap_or_default()
        });

        let a = h_all.join().unwrap_or_else(|_| Err("Ошибка потока поиска".to_string()));
        let t = h_tracks.join().unwrap_or_default();
        (a, t)
    });

    let resp = all_res?;

    let artists = resp
        .pointer("/result/artists/results")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|a| {
                    let id = a.get("id")?.to_string().trim_matches('"').to_string();
                    let name = a.get("name")?.as_str()?.to_string();
                    let cover_url = parse_ym_cover(a, "300x300");
                    let tracks_count = a
                        .pointer("/counts/tracks")
                        .and_then(|v| v.as_u64())
                        .unwrap_or(0);
                    Some(SearchArtistItem {
                        id,
                        name,
                        cover_url,
                        tracks_count,
                    })
                })
                .collect()
        })
        .unwrap_or_default();

    let mut tracks: Vec<TrackItem> = resp
        .pointer("/result/tracks/results")
        .and_then(|v| v.as_array())
        .map(|arr| arr.iter().filter_map(parse_ym_track).collect())
        .unwrap_or_default();

    for t in tracks_res {
        if !tracks.iter().any(|x| x.id == t.id) {
            tracks.push(t);
        }
    }

    Ok(YandexSearchResult { artists, tracks })
}

/// Полная карточка артиста: инфо, популярные треки, все треки (до 100), альбомы/синглы, похожие артисты
pub fn get_artist_profile(
    token: &str,
    artist_name: &str,
    known_artist_id: Option<&str>,
) -> Result<ArtistProfile, String> {
    let clean_name = artist_name.split(',').next().unwrap_or(artist_name).trim();
    if clean_name.is_empty() {
        return Err("Имя артиста не указано".to_string());
    }

    let client = ym_client(token)?;

    let (artist_id, matched_artist_fallback): (String, Option<Value>) =
        if let Some(kid) = known_artist_id.filter(|s| !s.trim().is_empty()) {
            (kid.trim().to_string(), None)
        } else {
            let search_url = format!("{}/search", YM_API);
            let search_resp: Value = client
                .get(&search_url)
                .query(&[("text", clean_name), ("type", "artist"), ("page", "0")])
                .send()
                .map_err(|e| e.to_string())?
                .json()
                .map_err(|e| e.to_string())?;

            let artists_arr = search_resp
                .pointer("/result/artists/results")
                .and_then(|v| v.as_array())
                .ok_or("Артист не найден в Яндекс Музыке")?;

            let matched_artist = artists_arr
                .iter()
                .find(|a| {
                    a.get("name")
                        .and_then(|n| n.as_str())
                        .map(|n| n.eq_ignore_ascii_case(clean_name))
                        .unwrap_or(false)
                })
                .or_else(|| artists_arr.first())
                .ok_or("Артист не найден в Яндекс Музыке")?;

            let aid = matched_artist
                .get("id")
                .ok_or("Не найден ID артиста")?
                .to_string()
                .trim_matches('"')
                .to_string();
            (aid, Some(matched_artist.clone()))
        };

    // Загружаем brief-info, все треки и прямые альбомы артиста ПАРАЛЛЕЛЬНО
    let safe_artist_id = validate_ym_id(&artist_id)?;
    let brief_url = format!("{}/artists/{}/brief-info", YM_API, safe_artist_id);
    let all_tracks_url = format!("{}/artists/{}/tracks", YM_API, safe_artist_id);
    let direct_albums_url = format!("{}/artists/{}/direct-albums", YM_API, safe_artist_id);

    let (brief_res, tracks_res, direct_albums_res) = std::thread::scope(|s| {
        let brief_handle = s.spawn(|| -> Result<Value, String> { send_json(client.get(&brief_url)) });
        let tracks_handle = s.spawn(|| -> Vec<TrackItem> {
            client
                .get(&all_tracks_url)
                .query(&[("page", "0"), ("page-size", "200")])
                .send()
                .ok()
                .and_then(|r| r.json::<Value>().ok())
                .and_then(|val| {
                    val.pointer("/result/tracks")
                        .and_then(|v| v.as_array())
                        .map(|arr| arr.iter().filter_map(parse_ym_track).collect())
                })
                .unwrap_or_default()
        });
        let albums_handle = s.spawn(|| -> Vec<ArtistAlbum> {
            client
                .get(&direct_albums_url)
                .query(&[("page", "0"), ("page-size", "100"), ("sort-by", "year")])
                .send()
                .ok()
                .and_then(|r| r.json::<Value>().ok())
                .and_then(|val| {
                    val.pointer("/result/albums")
                        .and_then(|v| v.as_array())
                        .map(|arr| arr.iter().filter_map(parse_ym_album).collect())
                })
                .unwrap_or_default()
        });

        let b = brief_handle.join().unwrap_or_else(|_| Err("Ошибка потока brief-info".to_string()));
        let t = tracks_handle.join().unwrap_or_default();
        let da = albums_handle.join().unwrap_or_default();
        (b, t, da)
    });

    let brief_resp = brief_res?;

    let fallback_val = matched_artist_fallback.unwrap_or(Value::Null);
    let artist_obj = brief_resp.pointer("/result/artist").unwrap_or(&fallback_val);
    let name = artist_obj
        .get("name")
        .and_then(|v| v.as_str())
        .unwrap_or(clean_name)
        .to_string();
    let cover_url = parse_ym_cover(artist_obj, "1000x1000");

    let genres: Vec<String> = artist_obj
        .get("genres")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|g| g.as_str().map(|s| s.to_string()))
                .collect()
        })
        .unwrap_or_default();

    let tracks_count = artist_obj
        .pointer("/counts/tracks")
        .and_then(|v| v.as_u64())
        .unwrap_or(0);
    let albums_count = artist_obj
        .pointer("/counts/directAlbums")
        .and_then(|v| v.as_u64())
        .unwrap_or(0);
    let likes_count = artist_obj
        .get("likesCount")
        .and_then(|v| v.as_u64())
        .unwrap_or(0);
    let monthly_listeners = brief_resp
        .pointer("/result/stats/lastMonthListeners")
        .or_else(|| artist_obj.pointer("/stats/lastMonthListeners"))
        .or_else(|| brief_resp.pointer("/result/artist/stats/lastMonthListeners"))
        .and_then(|v| v.as_u64())
        .unwrap_or(0);

    let popular_tracks: Vec<TrackItem> = brief_resp
        .pointer("/result/popularTracks")
        .and_then(|v| v.as_array())
        .map(|arr| arr.iter().filter_map(parse_ym_track).collect())
        .unwrap_or_default();

    let mut albums: Vec<ArtistAlbum> = Vec::new();
    for parsed in direct_albums_res {
        if !albums.iter().any(|x| x.id == parsed.id) {
            albums.push(parsed);
        }
    }
    if let Some(direct) = brief_resp.pointer("/result/albums").and_then(|v| v.as_array()) {
        for a in direct {
            if let Some(parsed) = parse_ym_album(a) {
                if !albums.iter().any(|x| x.id == parsed.id) {
                    albums.push(parsed);
                }
            }
        }
    }
    if let Some(also) = brief_resp.pointer("/result/alsoAlbums").and_then(|v| v.as_array()) {
        for a in also {
            if let Some(parsed) = parse_ym_album(a) {
                if !albums.iter().any(|x| x.id == parsed.id) {
                    albums.push(parsed);
                }
            }
        }
    }
    albums.sort_by(|a, b| {
        b.year
            .unwrap_or(0)
            .cmp(&a.year.unwrap_or(0))
            .then_with(|| {
                b.release_date
                    .as_deref()
                    .unwrap_or("")
                    .cmp(a.release_date.as_deref().unwrap_or(""))
            })
    });

    // Подгружаем треки из самых свежих релизов (включая вышедшие сегодня), т.к. /artists/{id}/tracks может не сразу их индексировать
    let newest_album_ids: Vec<String> = albums.iter().take(6).map(|a| a.id.clone()).collect();
    let newest_release_tracks: Vec<TrackItem> = if !newest_album_ids.is_empty() {
        std::thread::scope(|s| {
            let handles: Vec<_> = newest_album_ids
                .iter()
                .map(|aid| s.spawn(move || get_album_tracks(token, aid).unwrap_or_default()))
                .collect();
            let mut collected = Vec::new();
            for h in handles {
                if let Ok(list) = h.join() {
                    for t in list {
                        if !collected.iter().any(|x: &TrackItem| x.id == t.id) {
                            collected.push(t);
                        }
                    }
                }
            }
            collected
        })
    } else {
        Vec::new()
    };

    let similar_artists: Vec<SimilarArtist> = brief_resp
        .pointer("/result/similarArtists")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .take(12)
                .filter_map(|sa| {
                    let sid = sa.get("id")?.to_string().trim_matches('"').to_string();
                    let sname = sa.get("name")?.as_str()?.to_string();
                    let scover = parse_ym_cover(sa, "300x300");
                    Some(SimilarArtist {
                        id: sid,
                        name: sname,
                        cover_url: scover,
                    })
                })
                .collect()
        })
        .unwrap_or_default();

    let mut all_tracks: Vec<TrackItem> = Vec::new();
    for t in newest_release_tracks {
        if !all_tracks.iter().any(|x| x.id == t.id) {
            all_tracks.push(t);
        }
    }
    for t in tracks_res {
        if !all_tracks.iter().any(|x| x.id == t.id) {
            all_tracks.push(t);
        }
    }
    if all_tracks.is_empty() {
        all_tracks = popular_tracks.clone();
    }

    let final_tracks_count = if tracks_count > 0 {
        tracks_count
    } else {
        all_tracks.len() as u64
    };

    Ok(ArtistProfile {
        id: artist_id,
        name,
        cover_url,
        genres,
        tracks_count: final_tracks_count,
        albums_count: if albums_count > 0 {
            albums_count
        } else {
            albums.len() as u64
        },
        likes_count,
        monthly_listeners,
        popular_tracks,
        all_tracks,
        albums,
        similar_artists,
    })
}

/// Загрузка треков конкретного альбома/сингла артиста
pub fn get_album_tracks(token: &str, album_id: &str) -> Result<Vec<TrackItem>, String> {
    let client = ym_client(token)?;
    let safe_album_id = validate_ym_id(album_id)?;
    let url = format!("{}/albums/{}/with-tracks", YM_API, safe_album_id);
    let resp = send_json(client.get(&url))?;

    let mut tracks = Vec::new();
    if let Some(volumes) = resp.pointer("/result/volumes").and_then(|v| v.as_array()) {
        for vol in volumes {
            if let Some(t_arr) = vol.as_array() {
                for t in t_arr {
                    if let Some(parsed) = parse_ym_track(t) {
                        tracks.push(parsed);
                    }
                }
            }
        }
    }
    Ok(tracks)
}

fn fetch_fresh_2026_releases(
    client: YmClient<'_>,
    token: &str,
    genre: Option<&str>,
) -> Vec<TrackItem> {
    let mut fresh = Vec::new();

    let landing_url = format!("{}/landing3/new-releases", YM_API);
    if let Ok(resp) = client.get(&landing_url).send() {
        if let Ok(json_val) = resp.json::<Value>() {
            if let Some(album_ids) = json_val
                .pointer("/result/newReleases")
                .and_then(|v| v.as_array())
            {
                for aid in album_ids.iter().take(6) {
                    let album_id_str = aid.to_string().trim_matches('"').to_string();
                    let album_url = format!("{}/albums/{}/with-tracks", YM_API, album_id_str);
                    if let Ok(a_resp) = client.get(&album_url).send() {
                        if let Ok(a_json) = a_resp.json::<Value>() {
                            let year = a_json
                                .pointer("/result/year")
                                .and_then(|v| v.as_u64())
                                .unwrap_or(0);
                            if year >= 2026 {
                                if let Some(volumes) = a_json
                                    .pointer("/result/volumes")
                                    .and_then(|v| v.as_array())
                                {
                                    for vol in volumes {
                                        if let Some(t_arr) = vol.as_array() {
                                            if let Some(first_track) = t_arr.first() {
                                                if let Some(parsed) = parse_ym_track(first_track) {
                                                    fresh.push(parsed);
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                    if fresh.len() >= 8 {
                        break;
                    }
                }
            }
        }
    }

    if fresh.len() < 6 {
        let search_q = match genre {
            Some(g) if !g.trim().is_empty() => format!("{} 2026", g.trim()),
            _ => "новинки 2026".to_string(),
        };
        if let Ok(found) = search_yandex(token, &search_q) {
            for t in found {
                if !fresh.iter().any(|x| x.id == t.id) {
                    fresh.push(t);
                }
            }
        }
    }

    fresh
}

pub fn wave_yandex(
    token: &str,
    mood: Option<&str>,
    activity: Option<&str>,
    character: Option<&str>,
    genre: Option<&str>,
    language: Option<&str>,
    queue_track_id: Option<&str>,
) -> Result<Vec<TrackItem>, String> {
    let client = ym_client(token)?;
    let station_id = resolve_station_id(genre);
    let is_new_only = character.map(|c| c.trim() == "Новинки").unwrap_or(false);

    if queue_track_id.is_none() {
        let mut settings = serde_json::Map::new();
        let mood_val = match mood.map(|m| m.trim()) {
            Some("Бодрое") | Some("Весёлое") => "energetic",
            Some("Спокойное") | Some("Романтичное") => "calm",
            Some("Грустное") | Some("Мрачное") => "sad",
            _ => "all",
        };
        settings.insert("moodEnergy".to_string(), Value::String(mood_val.to_string()));

        let diversity_val = if let Some(c) = character {
            match c.trim() {
                "Любимое" => "favorite",
                "Незнакомое" | "Новинки" => "discover",
                _ => "default",
            }
        } else if let Some(a) = activity {
            match a.trim() {
                "Для фокуса" | "Для кода" => "work",
                "Тренировка" => "workout",
                "В дорогу" => "road-trip",
                "Вечерний чилл" | "Ночью" => "fall-asleep",
                _ => "default",
            }
        } else {
            "default"
        };
        settings.insert("diversity".to_string(), Value::String(diversity_val.to_string()));

        let lang_val = match language.map(|l| l.trim()) {
            Some("Русский") => "russian",
            Some("Английский") | Some("Иностранный") => "not-russian",
            Some("Без слов") => "without-words",
            _ => "any",
        };
        settings.insert("language".to_string(), Value::String(lang_val.to_string()));

        let settings_url = format!("{}/rotor/station/{}/settings2", YM_API, station_id);
        let _ = client.post(&settings_url).json(&settings).send();

        let token_owned = token.to_string();
        let feedback_url = format!("{}/rotor/station/{}/feedback", YM_API, station_id);
        // Отправляем событие старта волны в фоне, не задерживая загрузку треков
        std::thread::spawn(move || {
            if let Ok(bg_client) = ym_client(&token_owned) {
                let _ = bg_client
                    .post(&feedback_url)
                    .json(&json!({
                        "type": "radioStarted",
                        "timestamp": iso_timestamp_now()
                    }))
                    .send();
            }
        });
    }

    let url = format!("{}/rotor/station/{}/tracks", YM_API, station_id);
    let mut req = client.get(&url).query(&[("settings2", "true")]);

    if let Some(qid) = queue_track_id {
        let clean_qid = qid.trim_start_matches("ym-").trim_start_matches("ym://");
        if !clean_qid.is_empty() {
            req = req.query(&[("queue", clean_qid)]);
        }
    }

    let resp = send_json(req)?;

    let raw_items: Vec<&Value> = resp
        .pointer("/result/sequence")
        .and_then(|v| v.as_array())
        .map(|arr| arr.iter().filter_map(|item| item.get("track")).collect())
        .unwrap_or_default();

    if is_new_only {
        let mut tracks: Vec<TrackItem> = raw_items
            .iter()
            .filter(|t| extract_track_year(t).unwrap_or(0) >= 2026)
            .filter_map(|t| parse_ym_track(t))
            .collect();

        if tracks.len() < 4 {
            let fresh = fetch_fresh_2026_releases(client, token, genre);
            for t in fresh {
                if !tracks.iter().any(|x| x.id == t.id) {
                    tracks.push(t);
                }
            }
        }

        if !tracks.is_empty() {
            return Ok(tracks);
        }
    }

    let mut tracks: Vec<TrackItem> = raw_items.into_iter().filter_map(parse_ym_track).collect();

    if tracks.is_empty() && station_id != "user:onyourwave" {
        let fallback_url = format!("{}/rotor/station/user:onyourwave/tracks", YM_API);
        let fallback_resp: Value = client
            .get(&fallback_url)
            .query(&[("settings2", "true")])
            .send()
            .map_err(|e| e.to_string())?
            .json()
            .map_err(|e| e.to_string())?;

        tracks = fallback_resp
            .pointer("/result/sequence")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|item| item.get("track"))
                    .filter_map(parse_ym_track)
                    .collect()
            })
            .unwrap_or_default();
    }

    Ok(tracks)
}

pub fn send_yandex_wave_feedback(
    token: &str,
    genre: Option<&str>,
    event_type: &str,
    track_id: Option<&str>,
    total_played_seconds: Option<u64>,
) -> Result<(), String> {
    let client = ym_client(token)?;
    let station_id = resolve_station_id(genre);
    let url = format!("{}/rotor/station/{}/feedback", YM_API, station_id);

    let mut payload = serde_json::Map::new();
    payload.insert("type".to_string(), Value::String(event_type.to_string()));
    payload.insert("timestamp".to_string(), Value::String(iso_timestamp_now()));

    if let Some(tid) = track_id {
        let clean_tid = tid.trim_start_matches("ym-").trim_start_matches("ym://");
        if !clean_tid.is_empty() {
            payload.insert("trackId".to_string(), Value::String(clean_tid.to_string()));
        }
    }

    if let Some(sec) = total_played_seconds {
        payload.insert("totalPlayedSeconds".to_string(), json!(sec));
    }

    let _ = client.post(&url).json(&Value::Object(payload)).send();
    Ok(())
}

pub fn resolve_yandex_stream_url(token: &str, raw_id_or_url: &str) -> Result<String, String> {
    let raw_id = raw_id_or_url.trim_start_matches("ym://").trim_start_matches("ym-");
    let track_id = validate_ym_id(raw_id)?;
    let client = ym_client(token)?;

    let info_url = format!("{}/tracks/{}/download-info", YM_API, track_id);
    let info_resp = send_json(client.get(&info_url))?;

    let results = info_resp
        .get("result")
        .and_then(|v| v.as_array())
        .ok_or("Не удалось получить download-info от Яндекса")?;

    let best = results
        .iter()
        .filter(|item| item.get("codec").and_then(|c| c.as_str()) == Some("mp3"))
        .max_by_key(|item| item.get("bitrateInKbps").and_then(|b| b.as_u64()).unwrap_or(0))
        .or_else(|| results.first())
        .ok_or("Нет доступных потоков для трека")?;

    let download_info_url = best
        .get("downloadInfoUrl")
        .and_then(|v| v.as_str())
        .ok_or("Отсутствует downloadInfoUrl")?;

    if !download_info_url.starts_with("https://") {
        return Err("Небезопасный URL downloadInfoUrl".to_string());
    }

    // Запрашиваем XML без OAuth-заголовка, т.к. downloadInfoUrl ведёт на CDN/storage-хост
    let xml_text = shared_http_client()
        .get(download_info_url)
        .send()
        .map_err(|e| e.to_string())?
        .error_for_status()
        .map_err(|e| format!("Ошибка загрузки downloadInfoUrl: {}", e))?
        .text()
        .map_err(|e| e.to_string())?;

    let extract_tag = |tag: &str| -> Result<String, String> {
        let open = format!("<{}>", tag);
        let close = format!("</{}>", tag);
        let start = xml_text.find(&open).ok_or_else(|| format!("Нет тега {}", tag))? + open.len();
        let end = xml_text[start..].find(&close).ok_or_else(|| format!("Не закрыт тег {}", tag))? + start;
        Ok(xml_text[start..end].to_string())
    };

    let host = extract_tag("host")?;
    let path = extract_tag("path")?;
    let ts = extract_tag("ts")?;
    let s = extract_tag("s")?;

    let sign_payload = format!("XGRlBW9FXlekgbPrRHuSiA{}{}", path.trim_start_matches('/'), s);
    let sign = format!("{:x}", md5::compute(sign_payload.as_bytes()));

    Ok(format!("https://{}/get-mp3/{}/{}{}", host, sign, ts, path))
}

fn fetch_yandex_lyrics(
    client: &reqwest::blocking::Client,
    token: &str,
    ym_id: &str,
) -> Option<(Option<String>, Option<String>)> {
    if token.trim().is_empty() {
        return None;
    }
    let safe_ym_id = validate_ym_id(ym_id).ok()?;

    let lrc_endpoint = format!("{}/tracks/{}/lyrics", YM_API, safe_ym_id);
    if let Ok(resp) = client
        .get(&lrc_endpoint)
        .query(&[("format", "LRC")])
        .header("Authorization", format!("OAuth {}", token.trim()))
        .header("X-Yandex-Music-Client", YM_CLIENT_HEADER)
        .send()
    {
        if resp.status().is_success() {
            if let Ok(val) = resp.json::<Value>() {
                if let Some(dl_url) = val.pointer("/result/downloadUrl").and_then(|v| v.as_str()) {
                    if let Ok(lrc_resp) = client.get(dl_url).send() {
                        if let Ok(lrc_text) = lrc_resp.text() {
                            let trimmed = lrc_text.trim().to_string();
                            if !trimmed.is_empty() && trimmed.contains('[') {
                                return Some((Some(trimmed), None));
                            }
                        }
                    }
                }
            }
        }
    }

    let url = format!("{}/tracks/{}/supplement", YM_API, safe_ym_id);
    let resp = client
        .get(&url)
        .header("Authorization", format!("OAuth {}", token.trim()))
        .header("X-Yandex-Music-Client", YM_CLIENT_HEADER)
        .send()
        .ok()?;
    if !resp.status().is_success() {
        return None;
    }
    let val: Value = resp.json().ok()?;
    let full_lyrics = val
        .get("result")?
        .get("lyrics")?
        .get("fullLyrics")?
        .as_str()?
        .trim();
    if full_lyrics.is_empty() {
        None
    } else {
        Some((None, Some(full_lyrics.to_string())))
    }
}

fn strip_html_tags(html: &str) -> String {
    let with_newlines = html
        .replace("<br>", "\n")
        .replace("<br/>", "\n")
        .replace("<br />", "\n")
        .replace("</div>", "\n");
    let mut out = String::with_capacity(with_newlines.len());
    let mut in_tag = false;
    for ch in with_newlines.chars() {
        match ch {
            '<' => in_tag = true,
            '>' => in_tag = false,
            _ if !in_tag => out.push(ch),
            _ => {}
        }
    }
    out.replace("&amp;", "&")
        .replace("&quot;", "\"")
        .replace("&#x27;", "'")
        .replace("&#39;", "'")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&nbsp;", " ")
}

fn clean_title_for_search(title: &str) -> String {
    let mut result = title.to_string();
    for (open, close) in [('(', ')'), ('[', ']')] {
        let mut offset = 0;
        while let Some(rel_start) = result[offset..].find(open) {
            let start = offset + rel_start;
            if let Some(end_rel) = result[start..].find(close) {
                let inner = result[start + 1..start + end_rel].to_lowercase();
                if inner.contains("feat")
                    || inner.contains("ft.")
                    || inner.contains("prod")
                    || inner.contains("remix")
                    || inner.contains("explicit")
                {
                    result.replace_range(start..=start + end_rel, "");
                } else {
                    offset = start + end_rel + 1;
                }
            } else {
                break;
            }
        }
    }
    result.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn fetch_genius_lyrics(client: &reqwest::blocking::Client, artist: &str, title: &str) -> Option<String> {
    let clean_title = clean_title_for_search(title);
    let q = format!("{} {}", artist, clean_title);
    let resp = client
        .get("https://genius.com/api/search/multi")
        .query(&[("q", q.as_str())])
        .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36")
        .header("Accept", "application/json")
        .send()
        .ok()?;
    if !resp.status().is_success() {
        return None;
    }
    let val: Value = resp.json().ok()?;
    let sections = val.get("response")?.get("sections")?.as_array()?;
    let song_url = sections
        .iter()
        .find(|s| s.get("type").and_then(|t| t.as_str()) == Some("song"))
        .and_then(|s| s.get("hits")?.as_array())
        .and_then(|hits| hits.first())
        .and_then(|hit| hit.get("result")?.get("url")?.as_str())
        .or_else(|| {
            sections
                .iter()
                .find(|s| s.get("type").and_then(|t| t.as_str()) == Some("top_hit"))
                .and_then(|s| s.get("hits")?.as_array())
                .and_then(|hits| {
                    hits.iter().find(|h| h.get("type").and_then(|t| t.as_str()) == Some("song"))
                })
                .and_then(|hit| hit.get("result")?.get("url")?.as_str())
        })?;

    let page_html = client
        .get(song_url)
        .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36")
        .header("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8")
        .send()
        .ok()?
        .text()
        .ok()?;

    let mut collected = String::new();
    let mut rest = page_html.as_str();
    loop {
        let pos = rest
            .find("data-lyrics-container=\"true\"")
            .or_else(|| rest.find("data-lyrics-container='true'"));
        let Some(pos) = pos else { break };
        let after_marker = &rest[pos..];
        let Some(gt_pos) = after_marker.find('>') else { break };
        let content_start = &after_marker[gt_pos + 1..];

        let mut depth = 1_i32;
        let mut idx = 0_usize;
        let mut end_idx = content_start.len();

        while idx < content_start.len() && depth > 0 {
            let next_open = content_start[idx..].find("<div").map(|p| idx + p);
            let next_close = content_start[idx..].find("</div>").map(|p| idx + p);
            match (next_open, next_close) {
                (Some(o), Some(c)) if o < c => {
                    depth += 1;
                    idx = o + 4;
                }
                (_, Some(c)) => {
                    depth -= 1;
                    if depth == 0 {
                        end_idx = c;
                        break;
                    }
                    idx = c + 6;
                }
                _ => break,
            }
        }

        let chunk = &content_start[..end_idx];
        let clean = strip_html_tags(chunk);
        if !clean.trim().is_empty() {
            if !collected.is_empty() {
                collected.push('\n');
            }
            collected.push_str(clean.trim());
        }
        rest = &content_start[end_idx..];
    }

    let trimmed = collected.trim().to_string();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed)
    }
}

pub fn fetch_lyrics(
    track_id: Option<&str>,
    yandex_token: &str,
    title: &str,
    artist: &str,
    album: &str,
    duration_seconds: u64,
) -> Result<TrackLyrics, String> {
    let client = shared_http_client();

    let primary_artist = artist.split(',').next().unwrap_or(artist).trim();

    if let Some(id) = track_id {
        if let Some(ym_id) = id.strip_prefix("ym-") {
            if let Some((synced, plain)) = fetch_yandex_lyrics(client, yandex_token, ym_id) {
                return Ok(TrackLyrics {
                    synced_lyrics: synced,
                    plain_lyrics: plain,
                    instrumental: false,
                });
            }
        }
    }

    if let Some(genius_lyrics) = fetch_genius_lyrics(client, primary_artist, title.trim()) {
        return Ok(TrackLyrics {
            synced_lyrics: None,
            plain_lyrics: Some(genius_lyrics),
            instrumental: false,
        });
    }

    let clean_title = title.trim();
    let title_lower = clean_title.to_lowercase();
    let artist_lower = primary_artist.to_lowercase();

    let extract_lrclib_lyrics = |val: &Value| -> Option<TrackLyrics> {
        let synced = val
            .get("syncedLyrics")
            .and_then(|v| v.as_str())
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty());
        let plain = val
            .get("plainLyrics")
            .and_then(|v| v.as_str())
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty());

        if synced.is_some() || plain.is_some() {
            return Some(TrackLyrics {
                synced_lyrics: synced,
                plain_lyrics: plain,
                instrumental: false,
            });
        }
        None
    };

    let is_lrclib_match = |val: &Value, strict: bool| -> bool {
        let dur_ok = if duration_seconds > 0 {
            val.get("duration")
                .and_then(|v| v.as_f64())
                .map(|d| (d - duration_seconds as f64).abs() <= if strict { 12.0 } else { 20.0 })
                .unwrap_or(true)
        } else {
            true
        };
        if !dur_ok {
            return false;
        }
        let tr = val
            .get("trackName")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_lowercase();
        let ar = val
            .get("artistName")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_lowercase();
        if strict {
            !tr.is_empty()
                && !ar.is_empty()
                && (tr.contains(&title_lower) || title_lower.contains(&tr))
                && (ar.contains(&artist_lower) || artist_lower.contains(&ar))
        } else {
            tr.contains(&title_lower)
                || title_lower.contains(&tr)
                || ar.contains(&artist_lower)
                || artist_lower.contains(&ar)
        }
    };

    let get_url = format!("{}/get", LRCLIB_API);
    let mut req = client
        .get(&get_url)
        .timeout(Duration::from_secs(2))
        .query(&[
            ("track_name", clean_title),
            ("artist_name", primary_artist),
        ]);

    if !album.trim().is_empty() && album != "Яндекс Музыка" && album != "Локальная медиатека" {
        req = req.query(&[("album_name", album.trim())]);
    }
    if duration_seconds > 0 {
        req = req.query(&[("duration", duration_seconds.to_string().as_str())]);
    }

    if let Ok(resp) = req.send() {
        if resp.status().is_success() {
            if let Ok(val) = resp.json::<Value>() {
                if let Some(lyrics) = extract_lrclib_lyrics(&val) {
                    return Ok(lyrics);
                }
                if val.get("instrumental").and_then(|v| v.as_bool()).unwrap_or(false)
                    && is_lrclib_match(&val, true)
                {
                    return Ok(TrackLyrics {
                        synced_lyrics: None,
                        plain_lyrics: None,
                        instrumental: true,
                    });
                }
            }
        }
    }

    let search_url = format!("{}/search", LRCLIB_API);
    let search_queries: Vec<Vec<(&str, String)>> = vec![
        vec![
            ("track_name", clean_title.to_string()),
            ("artist_name", primary_artist.to_string()),
        ],
        vec![("q", format!("{} {}", primary_artist, clean_title))],
    ];

    for params in search_queries {
        if let Ok(resp) = client
            .get(&search_url)
            .timeout(Duration::from_secs(2))
            .query(&params)
            .send()
        {
            if let Ok(Value::Array(arr)) = resp.json::<Value>() {
                if let Some(best) = arr
                    .iter()
                    .find(|item| {
                        is_lrclib_match(item, false)
                            && item
                                .get("syncedLyrics")
                                .and_then(|v| v.as_str())
                                .map(|s| !s.trim().is_empty())
                                .unwrap_or(false)
                    })
                    .or_else(|| {
                        arr.iter().find(|item| {
                            is_lrclib_match(item, false)
                                && item
                                    .get("plainLyrics")
                                    .and_then(|v| v.as_str())
                                    .map(|s| !s.trim().is_empty())
                                    .unwrap_or(false)
                        })
                    })
                {
                    if let Some(lyrics) = extract_lrclib_lyrics(best) {
                        return Ok(lyrics);
                    }
                }
            }
        }
    }

    Ok(TrackLyrics {
        synced_lyrics: None,
        plain_lyrics: None,
        instrumental: false,
    })
}