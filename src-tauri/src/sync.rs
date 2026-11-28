use std::io::{Read, Write};
use std::net::{IpAddr, Ipv4Addr, SocketAddr, TcpListener, TcpStream, UdpSocket};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::thread;
use std::time::{Duration, Instant};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use crate::db::AbyssSyncSnapshot;
use crate::providers;

const DISCOVERY_PORT: u16 = 47822;
const DISCOVERY_MAGIC: &[u8] = b"ABYSS_DISCOVER_V1";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LanSyncHostInfo {
    pub ip: String,
    pub port: u16,
    pub pin: String,
    pub device_name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveredSyncDevice {
    pub name: String,
    pub ip: String,
    pub port: u16,
    pub platform: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct LanSyncEvent {
    pub state: String,
    pub peer: String,
}

struct ActiveSyncHost {
    stop: Arc<AtomicBool>,
}

static ACTIVE_HOST: OnceLock<Mutex<Option<ActiveSyncHost>>> = OnceLock::new();

fn active_host_slot() -> &'static Mutex<Option<ActiveSyncHost>> {
    ACTIVE_HOST.get_or_init(|| Mutex::new(None))
}

pub fn get_device_name() -> String {
    let host = std::env::var("COMPUTERNAME")
        .or_else(|_| std::env::var("HOSTNAME"))
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());

    if let Some(name) = host {
        return name;
    }

    if cfg!(target_os = "android") {
        "Android-устройство".to_string()
    } else if cfg!(target_os = "windows") {
        "Windows ПК".to_string()
    } else {
        "Abyss Music".to_string()
    }
}

fn is_virtual_or_vpn_ip(ip: Ipv4Addr) -> bool {
    let o = ip.octets();
    // 198.18.0.0/15 часто используют VPN TUN (Amnezia / Clash / Sing-Box)
    if o[0] == 198 && (o[1] == 18 || o[1] == 19) {
        return true;
    }
    // 172.16.0.0/12 (кроме 172.16.0.x? на Windows 172.17..172.31 — почти всегда WSL2 / Hyper-V / Docker)
    if o[0] == 172 && (16..=31).contains(&o[1]) {
        return true;
    }
    // 169.254.0.0/16 APIPA, 100.64.0.0/10 Tailscale/CGNAT
    if (o[0] == 169 && o[1] == 254) || (o[0] == 100 && (64..=127).contains(&o[1])) {
        return true;
    }
    false
}

pub fn detect_local_ipv4() -> Option<Ipv4Addr> {
    // Сначала пробуем локальные LAN-шлюзы (они идут через Wi-Fi/Ethernet, минуя VPN-туннель)
    let probes = [
        "192.168.1.1:80",
        "192.168.0.1:80",
        "192.168.31.1:80",
        "192.168.100.1:80",
        "192.168.43.1:80",
        "10.0.0.1:80",
        "8.8.8.8:80",
    ];
    let mut fallback: Option<Ipv4Addr> = None;
    for target in probes {
        if let Ok(sock) = UdpSocket::bind("0.0.0.0:0") {
            if sock.connect(target).is_ok() {
                if let Ok(SocketAddr::V4(addr)) = sock.local_addr() {
                    let ip = *addr.ip();
                    if ip.is_loopback() || ip.is_unspecified() {
                        continue;
                    }
                    if !is_virtual_or_vpn_ip(ip) {
                        return Some(ip);
                    }
                    if fallback.is_none() {
                        fallback = Some(ip);
                    }
                }
            }
        }
    }
    fallback
}

fn generate_pin() -> String {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.subsec_nanos() as u64 ^ d.as_secs())
        .unwrap_or(4829);
    let pin = 1000 + (nanos % 9000);
    format!("{:04}", pin)
}

fn send_http_response(
    stream: &mut TcpStream,
    status: &str,
    content_type: &str,
    body: &[u8],
) {
    let header = format!(
        "HTTP/1.1 {}\r\nContent-Type: {}\r\nContent-Length: {}\r\nConnection: close\r\nAccess-Control-Allow-Origin: *\r\n\r\n",
        status,
        content_type,
        body.len()
    );
    let _ = stream.write_all(header.as_bytes());
    let _ = stream.write_all(body);
    let _ = stream.flush();
}

fn handle_http_client(
    mut stream: TcpStream,
    peer_ip: String,
    pin: &str,
    snapshot_bytes: &[u8],
    device_name: &str,
    app: &AppHandle,
) {
    let _ = stream.set_read_timeout(Some(Duration::from_secs(3)));
    let mut buf = [0u8; 2048];
    let n = match stream.read(&mut buf) {
        Ok(n) if n > 0 => n,
        _ => return,
    };

    let req = String::from_utf8_lossy(&buf[..n]);
    let first_line = req.lines().next().unwrap_or("");
    let path = first_line.split_whitespace().nth(1).unwrap_or("/");

    if path.starts_with("/ping") {
        let pong = serde_json::json!({
            "app": "abyss-music",
            "device": device_name
        })
        .to_string();
        send_http_response(&mut stream, "200 OK", "application/json; charset=utf-8", pong.as_bytes());
        return;
    }

    if path.starts_with("/sync") {
        let query = path.split_once('?').map(|(_, q)| q).unwrap_or("");
        let req_pin = query
            .split('&')
            .filter_map(|p| p.split_once('='))
            .find(|(k, _)| *k == "pin")
            .map(|(_, v)| v.trim())
            .unwrap_or("");

        if req_pin == pin {
            send_http_response(
                &mut stream,
                "200 OK",
                "application/json; charset=utf-8",
                snapshot_bytes,
            );
            let _ = app.emit(
                "lan-sync-status",
                LanSyncEvent {
                    state: "transferred".to_string(),
                    peer: peer_ip,
                },
            );
        } else {
            let err_body = br#"{"error":"Invalid PIN"}"#;
            send_http_response(
                &mut stream,
                "403 Forbidden",
                "application/json; charset=utf-8",
                err_body,
            );
            let _ = app.emit(
                "lan-sync-status",
                LanSyncEvent {
                    state: "wrong-pin".to_string(),
                    peer: peer_ip,
                },
            );
        }
        return;
    }

    send_http_response(
        &mut stream,
        "404 Not Found",
        "text/plain; charset=utf-8",
        b"Abyss Music Sync Endpoint",
    );
}

pub fn stop_lan_host() {
    if let Ok(mut slot) = active_host_slot().lock() {
        if let Some(prev) = slot.take() {
            prev.stop.store(true, Ordering::Release);
        }
    }
}

pub fn start_lan_host(
    app: AppHandle,
    snapshot: &AbyssSyncSnapshot,
) -> Result<LanSyncHostInfo, String> {
    stop_lan_host();

    let snapshot_bytes = Arc::new(serde_json::to_vec(snapshot).map_err(|e| e.to_string())?);
    let listener = TcpListener::bind("0.0.0.0:0").map_err(|e| format!("Ошибка запуска Wi-Fi сервера: {}", e))?;
    listener
        .set_nonblocking(true)
        .map_err(|e| e.to_string())?;

    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    let ip = detect_local_ipv4()
        .map(|a| a.to_string())
        .unwrap_or_else(|| "127.0.0.1".to_string());
    let pin = generate_pin();
    let device_name = get_device_name();

    let info = LanSyncHostInfo {
        ip: ip.clone(),
        port,
        pin: pin.clone(),
        device_name: device_name.clone(),
    };

    let stop = Arc::new(AtomicBool::new(false));

    // HTTP раздача снимка БД
    {
        let stop_http = Arc::clone(&stop);
        let pin_http = pin.clone();
        let snap_http = Arc::clone(&snapshot_bytes);
        let name_http = device_name.clone();
        let app_http = app.clone();
        thread::spawn(move || {
            while !stop_http.load(Ordering::Acquire) {
                match listener.accept() {
                    Ok((stream, addr)) => {
                        let peer_ip = addr.ip().to_string();
                        handle_http_client(
                            stream,
                            peer_ip,
                            &pin_http,
                            &snap_http,
                            &name_http,
                            &app_http,
                        );
                    }
                    Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                        thread::sleep(Duration::from_millis(80));
                    }
                    Err(_) => break,
                }
            }
        });
    }

    // UDP автопоиск в локальной Wi-Fi сети
    {
        let stop_udp = Arc::clone(&stop);
        let advertise = DiscoveredSyncDevice {
            name: device_name,
            ip,
            port,
            platform: std::env::consts::OS.to_string(),
        };
        let advertise_json = serde_json::to_vec(&advertise).unwrap_or_default();

        thread::spawn(move || {
            let Ok(udp) = UdpSocket::bind(("0.0.0.0", DISCOVERY_PORT)) else {
                return;
            };
            let _ = udp.set_read_timeout(Some(Duration::from_millis(160)));
            let mut buf = [0u8; 256];
            while !stop_udp.load(Ordering::Acquire) {
                if let Ok((len, src)) = udp.recv_from(&mut buf) {
                    if &buf[..len] == DISCOVERY_MAGIC {
                        let _ = udp.send_to(&advertise_json, src);
                    }
                }
            }
        });
    }

    if let Ok(mut slot) = active_host_slot().lock() {
        *slot = Some(ActiveSyncHost { stop });
    }

    Ok(info)
}

pub fn discover_lan_hosts() -> Result<Vec<DiscoveredSyncDevice>, String> {
    let udp = UdpSocket::bind("0.0.0.0:0").map_err(|e| e.to_string())?;
    udp.set_broadcast(true).map_err(|e| e.to_string())?;
    udp.set_read_timeout(Some(Duration::from_millis(200)))
        .map_err(|e| e.to_string())?;

    let mut targets: Vec<SocketAddr> = vec![
        SocketAddr::new(IpAddr::V4(Ipv4Addr::BROADCAST), DISCOVERY_PORT),
    ];
    if let Some(local) = detect_local_ipv4() {
        let octets = local.octets();
        let subnet_bcast = Ipv4Addr::new(octets[0], octets[1], octets[2], 255);
        targets.push(SocketAddr::new(IpAddr::V4(subnet_bcast), DISCOVERY_PORT));
    }

    for target in &targets {
        let _ = udp.send_to(DISCOVERY_MAGIC, target);
    }

    let deadline = Instant::now() + Duration::from_millis(1100);
    let mut found = Vec::new();
    let mut seen = std::collections::HashSet::new();
    let mut buf = [0u8; 1024];

    while Instant::now() < deadline {
        match udp.recv_from(&mut buf) {
            Ok((len, src)) => {
                if let Ok(mut dev) = serde_json::from_slice::<DiscoveredSyncDevice>(&buf[..len]) {
                    if dev.ip.is_empty() || dev.ip == "127.0.0.1" {
                        dev.ip = src.ip().to_string();
                    }
                    let key = format!("{}:{}", dev.ip, dev.port);
                    if seen.insert(key) {
                        found.push(dev);
                    }
                }
            }
            Err(_) => {
                // Повторим еще один широковещательный пинг на случай потери UDP-пакета
                if Instant::now() + Duration::from_millis(550) < deadline {
                    for target in &targets {
                        let _ = udp.send_to(DISCOVERY_MAGIC, target);
                    }
                }
            }
        }
    }

    Ok(found)
}

pub fn fetch_lan_snapshot(ip: &str, port: u16, pin: &str) -> Result<AbyssSyncSnapshot, String> {
    let clean_ip = ip.trim().trim_start_matches("http://").trim_end_matches('/');
    let url = format!("http://{}:{}/sync?pin={}", clean_ip, port, pin.trim());

    let resp = providers::shared_http_client()
        .get(&url)
        .timeout(Duration::from_secs(10))
        .send()
        .map_err(|e| format!("Не удалось подключиться к {}:{} ({})", clean_ip, port, e))?;

    if resp.status().as_u16() == 403 {
        return Err("Неверный 4-значный PIN-код".to_string());
    }
    if !resp.status().is_success() {
        return Err(format!("Устройство вернуло ошибку HTTP {}", resp.status().as_u16()));
    }

    resp.json::<AbyssSyncSnapshot>()
        .map_err(|e| format!("Ошибка чтения данных синхронизации: {}", e))
}

// ─── Облачная синхронизация (Supabase PostgreSQL REST API) ──────────────────

const SUPABASE_URL: &str = "https://qahvmioaytmvuguxrrdk.supabase.co";
const SUPABASE_KEY: &str = "sb_publishable_QthZ0YbTQU-HLVaZUj6rNA_REY1sOsE";

static LAST_CLOUD_UPDATED_AT: OnceLock<Mutex<Option<(String, String)>>> = OnceLock::new();

fn last_cloud_stamp_slot() -> &'static Mutex<Option<(String, String)>> {
    LAST_CLOUD_UPDATED_AT.get_or_init(|| Mutex::new(None))
}

#[derive(Debug, Deserialize)]
struct SupabaseMetaRow {
    updated_at: Option<String>,
}

#[derive(Debug, Deserialize)]
struct SupabaseProfileRow {
    payload: AbyssSyncSnapshot,
    updated_at: Option<String>,
}

pub fn cloud_push_snapshot(yandex_uid: &str, snapshot: &AbyssSyncSnapshot) -> Result<(), String> {
    let uid = yandex_uid.trim();
    if uid.is_empty() {
        return Err("Пустой идентификатор аккаунта".to_string());
    }

    // Не сохраняем приватный OAuth-токен в открытом облачном профиле
    let mut sanitized = snapshot.clone();
    sanitized.settings.retain(|(k, _)| k != "yandex_token");

    let now_iso = {
        let secs = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        // Используем unix-метку в теле ответа Postgres default/now() — Postgres сам обновит updated_at через триггер?
        // Нет, при upsert передаём текущее ISO UTC время из секунд, чтобы updated_at всегда рос!
        format_unix_iso8601(secs)
    };

    let url = format!(
        "{}/rest/v1/abyss_profiles?on_conflict=yandex_uid&select=updated_at",
        SUPABASE_URL
    );
    let body = serde_json::json!({
        "yandex_uid": uid,
        "payload": sanitized,
        "updated_at": now_iso,
    });

    let resp = providers::shared_http_client()
        .post(&url)
        .timeout(Duration::from_secs(10))
        .header("apikey", SUPABASE_KEY)
        .header("Authorization", format!("Bearer {}", SUPABASE_KEY))
        .header("Content-Type", "application/json")
        .header("Prefer", "resolution=merge-duplicates,return=representation")
        .json(&body)
        .send()
        .map_err(|e| format!("Ошибка отправки в облако: {}", e))?;

    if !resp.status().is_success() {
        let code = resp.status().as_u16();
        let err_text = resp.text().unwrap_or_default();
        return Err(format!("Supabase HTTP {}: {}", code, err_text));
    }

    if let Ok(rows) = resp.json::<Vec<SupabaseMetaRow>>() {
        if let Some(stamp) = rows.into_iter().next().and_then(|r| r.updated_at) {
            if let Ok(mut guard) = last_cloud_stamp_slot().lock() {
                *guard = Some((uid.to_string(), stamp));
            }
        }
    }

    Ok(())
}

fn format_unix_iso8601(secs: u64) -> String {
    // Преобразование Unix-секунд в UTC ISO-8601 (алгоритм Howard Hinnant)
    let days = (secs / 86400) as i64;
    let rem = secs % 86400;
    let h = rem / 3600;
    let m = (rem % 3600) / 60;
    let s = rem % 60;

    let z = days + 719468;
    let era = if z >= 0 { z } else { z - 146096 } / 146097;
    let doe = (z - era * 146097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = (yoe as i64) + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let mo = if mp < 10 { mp + 3 } else { mp - 9 };
    let yr = y + if mo <= 2 { 1 } else { 0 };
    format!("{:04}-{:02}-{:02}T{:02}:{:02}:{:02}Z", yr, mo, d, h, m, s)
}

pub fn cloud_pull_snapshot(yandex_uid: &str) -> Result<Option<AbyssSyncSnapshot>, String> {
    let uid = yandex_uid.trim();
    if uid.is_empty() {
        return Ok(None);
    }

    // Лёгкий предварительный запрос только updated_at, чтобы не качать весь JSON каждые 3 сек
    let meta_url = format!("{}/rest/v1/abyss_profiles", SUPABASE_URL);
    let meta_resp = providers::shared_http_client()
        .get(&meta_url)
        .timeout(Duration::from_secs(6))
        .header("apikey", SUPABASE_KEY)
        .header("Authorization", format!("Bearer {}", SUPABASE_KEY))
        .query(&[
            ("yandex_uid", format!("eq.{}", uid)),
            ("select", "updated_at".to_string()),
            ("limit", "1".to_string()),
        ])
        .send()
        .map_err(|e| format!("Ошибка проверки облака: {}", e))?;

    if !meta_resp.status().is_success() {
        let code = meta_resp.status().as_u16();
        let err_text = meta_resp.text().unwrap_or_default();
        return Err(format!("Supabase HTTP {}: {}", code, err_text));
    }

    let meta_rows: Vec<SupabaseMetaRow> = meta_resp
        .json()
        .map_err(|e| format!("Ошибка чтения метаданных облака: {}", e))?;
    let Some(remote_stamp) = meta_rows.into_iter().next().and_then(|r| r.updated_at) else {
        return Ok(None);
    };

    if let Ok(guard) = last_cloud_stamp_slot().lock() {
        if let Some((cached_uid, cached_stamp)) = guard.as_ref() {
            if cached_uid == uid && cached_stamp == &remote_stamp {
                return Ok(None);
            }
        }
    }

    let resp = providers::shared_http_client()
        .get(&meta_url)
        .timeout(Duration::from_secs(10))
        .header("apikey", SUPABASE_KEY)
        .header("Authorization", format!("Bearer {}", SUPABASE_KEY))
        .query(&[
            ("yandex_uid", format!("eq.{}", uid)),
            ("select", "payload,updated_at".to_string()),
            ("limit", "1".to_string()),
        ])
        .send()
        .map_err(|e| format!("Ошибка загрузки из облака: {}", e))?;

    if !resp.status().is_success() {
        let code = resp.status().as_u16();
        let err_text = resp.text().unwrap_or_default();
        return Err(format!("Supabase HTTP {}: {}", code, err_text));
    }

    let rows: Vec<SupabaseProfileRow> = resp
        .json()
        .map_err(|e| format!("Ошибка разбора облачного профиля: {}", e))?;

    if let Some(row) = rows.into_iter().next() {
        if let Some(stamp) = row.updated_at.or(Some(remote_stamp)) {
            if let Ok(mut guard) = last_cloud_stamp_slot().lock() {
                *guard = Some((uid.to_string(), stamp));
            }
        }
        return Ok(Some(row.payload));
    }

    Ok(None)
}
