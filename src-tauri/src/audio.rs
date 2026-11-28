use std::collections::HashSet;
use std::f32::consts::PI;
use std::fs::{self, File};
use std::io::{BufReader, Cursor, Read, Seek, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, AtomicU64, Ordering};
use std::sync::mpsc::{self, Sender};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant, SystemTime};
use rodio::source::SeekError;
use rodio::{Decoder, OutputStream, Sink, Source};
use crate::models::PlaybackStatus;
use crate::providers;

static CURRENT_AUDIO_LEVEL: AtomicU32 = AtomicU32::new(0);
const MAX_CACHE_BYTES: u64 = 100 * 1024 * 1024; // 100 МБ офлайн-кэш (~15–20 треков)

trait ReadSeek: Read + Seek + Send + Sync {}
impl<T: Read + Seek + Send + Sync> ReadSeek for T {}

const EQ_FREQS: [f32; 5] = [60.0, 230.0, 910.0, 3600.0, 14000.0];
const EQ_Q: f32 = 1.1;

#[derive(Clone, Copy)]
struct BiquadCoeffs {
    b0: f32,
    b1: f32,
    b2: f32,
    a1: f32,
    a2: f32,
}

impl BiquadCoeffs {
    fn peaking(sample_rate: f32, freq: f32, q: f32, gain_db: f32) -> Self {
        if gain_db.abs() < 0.05 || sample_rate <= 0.0 {
            return Self {
                b0: 1.0,
                b1: 0.0,
                b2: 0.0,
                a1: 0.0,
                a2: 0.0,
            };
        }
        let a = 10.0_f32.powf(gain_db / 40.0);
        let w0 = 2.0 * PI * (freq.min(sample_rate * 0.45)) / sample_rate;
        let cos_w0 = w0.cos();
        let sin_w0 = w0.sin();
        let alpha = sin_w0 / (2.0 * q);

        let b0 = 1.0 + alpha * a;
        let b1 = -2.0 * cos_w0;
        let b2 = 1.0 - alpha * a;
        let a0 = 1.0 + alpha / a;
        let a1 = -2.0 * cos_w0;
        let a2 = 1.0 - alpha / a;

        Self {
            b0: b0 / a0,
            b1: b1 / a0,
            b2: b2 / a0,
            a1: a1 / a0,
            a2: a2 / a0,
        }
    }
}

#[derive(Clone, Copy, Default)]
struct BiquadState {
    x1: f32,
    x2: f32,
    y1: f32,
    y2: f32,
}

impl BiquadState {
    #[inline]
    fn process(&mut self, x: f32, c: &BiquadCoeffs) -> f32 {
        let y = c.b0 * x + c.b1 * self.x1 + c.b2 * self.x2 - c.a1 * self.y1 - c.a2 * self.y2;
        self.x2 = self.x1;
        self.x1 = x;
        self.y2 = self.y1;
        self.y1 = y;
        y
    }
}

struct EqualizerSource<S> {
    inner: S,
    gains_db: Arc<Mutex<[f32; 5]>>,
    cached_gains: [f32; 5],
    coeffs: [BiquadCoeffs; 5],
    states: Vec<[BiquadState; 5]>,
    channel_idx: usize,
    sample_counter: u32,
    local_level: f32,
    sample_rate: u32,
    channels: u16,
}

impl<S> EqualizerSource<S>
where
    S: Source<Item = i16>,
{
    fn new(inner: S, gains_db: Arc<Mutex<[f32; 5]>>) -> Self {
        let sample_rate = inner.sample_rate().max(8000);
        let channels = inner.channels().max(1);
        let initial_gains = gains_db.lock().map(|g| *g).unwrap_or([0.0; 5]);
        let coeffs = Self::compute_coeffs(sample_rate as f32, &initial_gains);

        Self {
            inner,
            gains_db,
            cached_gains: initial_gains,
            coeffs,
            states: vec![[BiquadState::default(); 5]; channels as usize],
            channel_idx: 0,
            sample_counter: 0,
            local_level: 0.0,
            sample_rate,
            channels,
        }
    }

    fn compute_coeffs(sr: f32, gains: &[f32; 5]) -> [BiquadCoeffs; 5] {
        [
            BiquadCoeffs::peaking(sr, EQ_FREQS[0], EQ_Q, gains[0]),
            BiquadCoeffs::peaking(sr, EQ_FREQS[1], EQ_Q, gains[1]),
            BiquadCoeffs::peaking(sr, EQ_FREQS[2], EQ_Q, gains[2]),
            BiquadCoeffs::peaking(sr, EQ_FREQS[3], EQ_Q, gains[3]),
            BiquadCoeffs::peaking(sr, EQ_FREQS[4], EQ_Q, gains[4]),
        ]
    }
}

impl<S> Iterator for EqualizerSource<S>
where
    S: Source<Item = i16>,
{
    type Item = i16;

    fn next(&mut self) -> Option<Self::Item> {
        let raw = self.inner.next()?;

        if self.channel_idx == 0 {
            if let Ok(g) = self.gains_db.try_lock() {
                if *g != self.cached_gains {
                    self.cached_gains = *g;
                    self.coeffs = Self::compute_coeffs(self.sample_rate as f32, &self.cached_gains);
                }
            }
        }

        let ch = self.channel_idx;
        self.channel_idx = (self.channel_idx + 1) % (self.channels as usize);

        let abs_val = (raw as f32).abs() / 32768.0;
        self.local_level = if abs_val > self.local_level {
            self.local_level * 0.85 + abs_val * 0.15
        } else {
            self.local_level * 0.9992 + abs_val * 0.0008
        };
        // Обновляем атомарный уровень раз в 64 сэмпла, чтобы не нагружать шину на каждом сэмпле
        self.sample_counter = self.sample_counter.wrapping_add(1);
        if self.sample_counter & 63 == 0 {
            CURRENT_AUDIO_LEVEL.store(self.local_level.to_bits(), Ordering::Relaxed);
        }

        if self.cached_gains.iter().all(|g| g.abs() < 0.05) {
            return Some(raw);
        }

        let mut sample = raw as f32 / 32768.0;
        for band in 0..5 {
            sample = self.states[ch][band].process(sample, &self.coeffs[band]);
        }

        let clamped = (sample * 32768.0).clamp(-32768.0, 32767.0) as i16;
        Some(clamped)
    }
}

impl<S> Source for EqualizerSource<S>
where
    S: Source<Item = i16>,
{
    fn current_frame_len(&self) -> Option<usize> {
        self.inner.current_frame_len()
    }

    fn channels(&self) -> u16 {
        self.inner.channels()
    }

    fn sample_rate(&self) -> u32 {
        self.inner.sample_rate()
    }

    fn total_duration(&self) -> Option<Duration> {
        self.inner.total_duration()
    }

    fn try_seek(&mut self, pos: Duration) -> Result<(), SeekError> {
        for ch_state in &mut self.states {
            *ch_state = [BiquadState::default(); 5];
        }
        self.channel_idx = 0;
        self.inner.try_seek(pos)
    }
}

fn cache_key_path(cache_dir: &Path, source_key: &str) -> PathBuf {
    let digest = format!("{:x}", md5::compute(source_key.as_bytes()));
    cache_dir.join(format!("{}.audio", digest))
}

fn touch_file(path: &Path) {
    if let Ok(f) = fs::OpenOptions::new().write(true).open(path) {
        let _ = f.set_modified(SystemTime::now());
    }
}

fn save_to_cache_lru(cache_dir: &Path, key_path: &Path, bytes: &[u8]) {
    if fs::create_dir_all(cache_dir).is_err() {
        return;
    }
    let tmp_path = key_path.with_extension("tmp");
    if let Ok(mut f) = File::create(&tmp_path) {
        if f.write_all(bytes).is_ok() && f.flush().is_ok() {
            drop(f);
            let _ = fs::rename(&tmp_path, key_path);
        } else {
            let _ = fs::remove_file(&tmp_path);
            return;
        }
    }
    prune_cache_dir(cache_dir);
}

fn prune_cache_dir(cache_dir: &Path) {
    let Ok(entries) = fs::read_dir(cache_dir) else {
        return;
    };
    let mut files: Vec<(PathBuf, u64, SystemTime)> = Vec::new();
    let mut total: u64 = 0;

    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("audio") {
            continue;
        }
        if let Ok(meta) = entry.metadata() {
            let size = meta.len();
            let modified = meta.modified().unwrap_or(SystemTime::UNIX_EPOCH);
            total = total.saturating_add(size);
            files.push((path, size, modified));
        }
    }

    if total <= MAX_CACHE_BYTES {
        return;
    }

    files.sort_by_key(|item| item.2);
    for (path, size, _) in files {
        if total <= MAX_CACHE_BYTES {
            break;
        }
        if fs::remove_file(&path).is_ok() {
            total = total.saturating_sub(size);
        }
    }
}

pub fn get_cache_size_bytes(cache_dir: &Path) -> u64 {
    let Ok(entries) = fs::read_dir(cache_dir) else {
        return 0;
    };
    entries
        .flatten()
        .filter(|e| e.path().extension().and_then(|ext| ext.to_str()) == Some("audio"))
        .filter_map(|e| e.metadata().ok())
        .map(|m| m.len())
        .sum()
}

pub fn clear_cache_dir(cache_dir: &Path) -> Result<(), String> {
    if !cache_dir.exists() {
        return Ok(());
    }
    for entry in fs::read_dir(cache_dir).map_err(|e| e.to_string())?.flatten() {
        let p = entry.path();
        if p.is_file() {
            let _ = fs::remove_file(p);
        }
    }
    Ok(())
}

enum AudioCommand {
    LoadDecoded {
        generation: u64,
        source: Box<EqualizerSource<Decoder<Box<dyn ReadSeek>>>>,
        reply: Sender<Result<(), String>>,
    },
    FadeStep(u64),
    PrepareDuck,
    StopForNewPlay,
    Pause,
    Resume,
    Seek(u64, Sender<Result<(), String>>),
    SetVolume(f32),
    ToggleMute(Sender<bool>),
    GetStatus(Sender<PlaybackStatus>),
}

pub struct AudioPlayer {
    tx: Sender<AudioCommand>,
    eq_gains: Arc<Mutex<[f32; 5]>>,
    crossfade_ms: Arc<AtomicU32>,
    play_generation: Arc<AtomicU64>,
    cache_dir: PathBuf,
    in_flight_prefetch: Arc<Mutex<HashSet<String>>>,
}

impl AudioPlayer {
    pub fn new(cache_dir: PathBuf) -> Result<Self, String> {
        let _ = fs::create_dir_all(&cache_dir);
        prune_cache_dir(&cache_dir);
        let (cmd_tx, cmd_rx) = mpsc::channel::<AudioCommand>();
        let eq_gains = Arc::new(Mutex::new([0.0_f32; 5]));
        let crossfade_ms = Arc::new(AtomicU32::new(500));
        let play_generation = Arc::new(AtomicU64::new(0));
        let in_flight_prefetch = Arc::new(Mutex::new(HashSet::new()));
        let play_gen_thread = Arc::clone(&play_generation);
        let crossfade_thread = Arc::clone(&crossfade_ms);
        let cmd_tx_fade = cmd_tx.clone();

        thread::spawn(move || {
            let mut _stream_guard: Option<OutputStream> = None;
            let mut stream_handle = None;

            let mut sink: Option<Sink> = None;
            let mut volume: f32 = 0.75;
            let mut is_muted = false;
            let mut has_started = false;
            let mut fade_in_started: Option<(u64, Instant, u32)> = None;

            while let Ok(cmd) = cmd_rx.recv() {
                match cmd {
                    AudioCommand::PrepareDuck => {
                        if let Some(ref s) = sink {
                            if !s.empty() && !s.is_paused() && !is_muted {
                                s.set_volume(volume * 0.45);
                            }
                        }
                    }
                    AudioCommand::StopForNewPlay => {
                        if let Some(old_sink) = sink.take() {
                            old_sink.stop();
                        }
                        fade_in_started = None;
                        has_started = false;
                        CURRENT_AUDIO_LEVEL.store(0.0_f32.to_bits(), Ordering::Relaxed);
                    }
                    AudioCommand::LoadDecoded {
                        generation,
                        source,
                        reply,
                    } => {
                        if generation != play_gen_thread.load(Ordering::Acquire) {
                            let _ = reply.send(Ok(()));
                            continue;
                        }

                        let cf_ms = crossfade_thread.load(Ordering::Relaxed);
                        let target_vol = if is_muted { 0.0 } else { volume };

                        // Если включён crossfade и старый трек играет — быстро и плавно затухаем его в фоне
                        if let Some(old_sink) = sink.take() {
                            if cf_ms > 0 && !old_sink.empty() && !old_sink.is_paused() && target_vol > 0.01 {
                                let fade_steps = (cf_ms / 20).max(4);
                                let step_dur = Duration::from_millis(20);
                                let start_vol = old_sink.volume().min(target_vol);
                                thread::spawn(move || {
                                    for i in 1..=fade_steps {
                                        let ratio = i as f32 / fade_steps as f32;
                                        let curve = (1.0 - ratio).powf(1.8);
                                        old_sink.set_volume(start_vol * curve);
                                        thread::sleep(step_dur);
                                    }
                                    old_sink.stop();
                                });
                            } else {
                                old_sink.stop();
                            }
                        }

                        CURRENT_AUDIO_LEVEL.store(0.0_f32.to_bits(), Ordering::Relaxed);

                        // Ленивая инициализация аудиовыхода при первом воспроизведении (безопасно для Android)
                        if stream_handle.is_none() {
                            if let Ok(Ok((s, h))) = std::panic::catch_unwind(
                                std::panic::AssertUnwindSafe(OutputStream::try_default),
                            ) {
                                _stream_guard = Some(s);
                                stream_handle = Some(h);
                            }
                        }

                        let res = match stream_handle.as_ref() {
                            Some(handle) => Sink::try_new(handle)
                                .map_err(|e| e.to_string())
                                .map(|new_sink| {
                                    if cf_ms > 0 && !is_muted && volume > 0.01 {
                                        new_sink.set_volume(target_vol * 0.12);
                                        fade_in_started = Some((generation, Instant::now(), cf_ms));
                                        let tx_clone = cmd_tx_fade.clone();
                                        let gen_id = generation;
                                        thread::spawn(move || {
                                            let steps = (cf_ms / 20).max(4) + 2;
                                            for _ in 0..steps {
                                                thread::sleep(Duration::from_millis(20));
                                                if tx_clone.send(AudioCommand::FadeStep(gen_id)).is_err() {
                                                    break;
                                                }
                                            }
                                        });
                                    } else {
                                        fade_in_started = None;
                                        new_sink.set_volume(target_vol);
                                    }
                                    new_sink.append(*source);
                                    new_sink.play();
                                    sink = Some(new_sink);
                                    has_started = true;
                                }),
                            None => Err("Аудиоустройство вывода не найдено".to_string()),
                        };
                        let _ = reply.send(res);
                    }
                    AudioCommand::FadeStep(gen_id) => {
                        if let Some((active_gen, started_at, cf_ms)) = fade_in_started {
                            if active_gen != gen_id {
                                continue;
                            }
                            let elapsed = started_at.elapsed().as_millis() as f32;
                            let progress = (elapsed / cf_ms.max(1) as f32).clamp(0.0, 1.0);
                            // Перцептивная equal-power кривая нарастания — старт слышен сразу, без провала
                            let curved = 0.12 + 0.88 * progress.sqrt();
                            if let Some(ref s) = sink {
                                let target = if is_muted { 0.0 } else { volume };
                                s.set_volume(target * if progress >= 1.0 { 1.0 } else { curved });
                            }
                            if progress >= 1.0 {
                                fade_in_started = None;
                            }
                        }
                    }
                    AudioCommand::Pause => {
                        fade_in_started = None;
                        if let Some(ref s) = sink {
                            s.pause();
                        }
                        CURRENT_AUDIO_LEVEL.store(0.0_f32.to_bits(), Ordering::Relaxed);
                    }
                    AudioCommand::Resume => {
                        if let Some(ref s) = sink {
                            s.set_volume(if is_muted { 0.0 } else { volume });
                            s.play();
                        }
                    }
                    AudioCommand::Seek(seconds, reply) => {
                        let res = if let Some(ref s) = sink {
                            s.try_seek(Duration::from_secs(seconds))
                                .map_err(|e| format!("Ошибка перемотки: {:?}", e))
                        } else {
                            Ok(())
                        };
                        let _ = reply.send(res);
                    }
                    AudioCommand::SetVolume(vol) => {
                        fade_in_started = None;
                        volume = vol.clamp(0.0, 1.0);
                        if volume > 0.0 {
                            is_muted = false;
                        }
                        if let Some(ref s) = sink {
                            s.set_volume(if is_muted { 0.0 } else { volume });
                        }
                    }
                    AudioCommand::ToggleMute(reply) => {
                        fade_in_started = None;
                        is_muted = !is_muted;
                        if let Some(ref s) = sink {
                            s.set_volume(if is_muted { 0.0 } else { volume });
                        }
                        let _ = reply.send(is_muted);
                    }
                    AudioCommand::GetStatus(reply) => {
                        let status = match &sink {
                            Some(s) => {
                                let empty = s.empty();
                                let paused = s.is_paused();
                                PlaybackStatus {
                                    is_playing: !empty && !paused,
                                    position_sec: s.get_pos().as_secs(),
                                    volume,
                                    is_muted,
                                    is_finished: has_started && empty,
                                    audio_level: if !empty && !paused {
                                        f32::from_bits(CURRENT_AUDIO_LEVEL.load(Ordering::Relaxed))
                                    } else {
                                        0.0
                                    },
                                }
                            }
                            None => PlaybackStatus {
                                is_playing: false,
                                position_sec: 0,
                                volume,
                                is_muted,
                                is_finished: false,
                                audio_level: 0.0,
                            },
                        };
                        let _ = reply.send(status);
                    }
                }
            }
        });

        Ok(Self {
            tx: cmd_tx,
            eq_gains,
            crossfade_ms,
            play_generation,
            cache_dir,
            in_flight_prefetch,
        })
    }

    pub fn prefetch_track(&self, path: &str, ym_token: Option<&str>) {
        let is_remote = path.starts_with("ym://")
            || path.starts_with("http://")
            || path.starts_with("https://");
        if !is_remote {
            return;
        }
        let cached_path = cache_key_path(&self.cache_dir, path);
        if cached_path.exists() {
            return;
        }
        if let Ok(mut set) = self.in_flight_prefetch.lock() {
            if !set.insert(path.to_string()) {
                return;
            }
        } else {
            return;
        }

        let source_path = path.to_string();
        let token_opt = ym_token.map(|t| t.to_string());
        let cache_dir = self.cache_dir.clone();
        let in_flight = Arc::clone(&self.in_flight_prefetch);

        thread::spawn(move || {
            struct PrefetchGuard {
                set: Arc<Mutex<HashSet<String>>>,
                key: String,
            }
            impl Drop for PrefetchGuard {
                fn drop(&mut self) {
                    if let Ok(mut s) = self.set.lock() {
                        s.remove(&self.key);
                    }
                }
            }
            let _cleanup = PrefetchGuard {
                set: in_flight,
                key: source_path.clone(),
            };
            let resolved = if source_path.starts_with("ym://") {
                let Some(token) = token_opt.as_deref().filter(|t| !t.trim().is_empty()) else {
                    return;
                };
                match providers::resolve_yandex_stream_url(token, &source_path) {
                    Ok(u) => u,
                    Err(_) => return,
                }
            } else {
                source_path.clone()
            };

            if resolved.starts_with("http://") || resolved.starts_with("https://") {
                if let Ok(resp) = providers::shared_http_client()
                    .get(&resolved)
                    .timeout(Duration::from_secs(35))
                    .send()
                {
                    if let Ok(ok_resp) = resp.error_for_status() {
                        if let Ok(bytes) = ok_resp.bytes() {
                            if !bytes.is_empty() {
                                save_to_cache_lru(&cache_dir, &cached_path, &bytes);
                            }
                        }
                    }
                }
            }
        });
    }

    pub fn set_eq_gains(&self, gains: [f32; 5]) {
        if let Ok(mut g) = self.eq_gains.lock() {
            for (i, val) in gains.iter().enumerate() {
                g[i] = val.clamp(-12.0, 12.0);
            }
        }
    }

    pub fn get_eq_gains(&self) -> [f32; 5] {
        self.eq_gains.lock().map(|g| *g).unwrap_or([0.0; 5])
    }

    pub fn set_crossfade_ms(&self, ms: u32) {
        self.crossfade_ms.store(ms.min(8000), Ordering::Relaxed);
    }

    pub fn get_crossfade_ms(&self) -> u32 {
        self.crossfade_ms.load(Ordering::Relaxed)
    }

    pub fn cache_dir(&self) -> &Path {
        &self.cache_dir
    }

    pub fn play_file_async_prep(
        &self,
        path: &str,
        ym_token: Option<&str>,
    ) -> Result<mpsc::Receiver<Result<(), String>>, String> {
        let generation = self.play_generation.fetch_add(1, Ordering::AcqRel) + 1;
        // При отключённом crossfade останавливаем старый трек мгновенно, иначе — приглушаем при сетевой загрузке
        if self.crossfade_ms.load(Ordering::Relaxed) == 0 {
            let _ = self.tx.send(AudioCommand::StopForNewPlay);
        } else if !cache_key_path(&self.cache_dir, path).exists()
            && (path.starts_with("ym://") || path.starts_with("http://") || path.starts_with("https://"))
        {
            let _ = self.tx.send(AudioCommand::PrepareDuck);
        }

        let (reply_tx, reply_rx) = mpsc::channel();
        let source_path = path.to_string();
        let token_opt = ym_token.map(|t| t.to_string());
        let eq_gains = Arc::clone(&self.eq_gains);
        let play_gen = Arc::clone(&self.play_generation);
        let cmd_tx = self.tx.clone();
        let cache_dir = self.cache_dir.clone();

        thread::spawn(move || {
            let load_res = (|| -> Result<EqualizerSource<Decoder<Box<dyn ReadSeek>>>, String> {
                let is_remote = source_path.starts_with("ym://")
                    || source_path.starts_with("http://")
                    || source_path.starts_with("https://");

                // 1. Сначала пробуем офлайн-кэш для удалённых треков
                if is_remote {
                    let cached_path = cache_key_path(&cache_dir, &source_path);
                    if cached_path.exists() {
                        if let Ok(file) = File::open(&cached_path) {
                            if let Ok(decoded) = Decoder::new(Box::new(BufReader::new(file)) as Box<dyn ReadSeek>) {
                                touch_file(&cached_path);
                                return Ok(EqualizerSource::new(decoded, eq_gains));
                            }
                        }
                        let _ = fs::remove_file(&cached_path);
                    }
                }

                let resolved_source = if source_path.starts_with("ym://") {
                    let token = token_opt
                        .as_deref()
                        .filter(|t| !t.trim().is_empty())
                        .ok_or("Для воспроизведения треков Яндекс Музыки войдите в Яндекс ID")?;
                    providers::resolve_yandex_stream_url(token, &source_path)?
                } else {
                    source_path.clone()
                };

                if generation != play_gen.load(Ordering::Acquire) {
                    return Err("cancelled".to_string());
                }

                let reader: Box<dyn ReadSeek> = if resolved_source.starts_with("http://")
                    || resolved_source.starts_with("https://")
                {
                    let resp = providers::shared_http_client()
                        .get(&resolved_source)
                        .timeout(Duration::from_secs(45))
                        .send()
                        .map_err(|e| format!("Ошибка загрузки потока: {}", e))?
                        .error_for_status()
                        .map_err(|e| format!("Сервер вернул ошибку потока: {}", e))?;
                    let bytes = resp
                        .bytes()
                        .map_err(|e| format!("Ошибка чтения аудиопотока: {}", e))?;

                    if is_remote && !bytes.is_empty() {
                        let cached_path = cache_key_path(&cache_dir, &source_path);
                        let cache_dir_bg = cache_dir.clone();
                        let bytes_clone = bytes.clone();
                        thread::spawn(move || {
                            save_to_cache_lru(&cache_dir_bg, &cached_path, &bytes_clone);
                        });
                    }

                    Box::new(Cursor::new(bytes))
                } else {
                    let file = File::open(&resolved_source)
                        .map_err(|e| format!("Не удалось открыть файл: {}", e))?;
                    Box::new(BufReader::new(file))
                };

                if generation != play_gen.load(Ordering::Acquire) {
                    return Err("cancelled".to_string());
                }

                let decoded = Decoder::new(reader)
                    .map_err(|e| format!("Ошибка декодирования аудио: {}", e))?;
                Ok(EqualizerSource::new(decoded, eq_gains))
            })();

            match load_res {
                Ok(eq_source) => {
                    if generation != play_gen.load(Ordering::Acquire) {
                        let _ = reply_tx.send(Ok(()));
                        return;
                    }
                    let _ = cmd_tx.send(AudioCommand::LoadDecoded {
                        generation,
                        source: Box::new(eq_source),
                        reply: reply_tx,
                    });
                }
                Err(err) => {
                    if err == "cancelled" {
                        let _ = reply_tx.send(Ok(()));
                    } else {
                        let _ = reply_tx.send(Err(err));
                    }
                }
            }
        });

        Ok(reply_rx)
    }

    pub fn pause(&self) {
        let _ = self.tx.send(AudioCommand::Pause);
    }

    pub fn resume(&self) {
        let _ = self.tx.send(AudioCommand::Resume);
    }

    pub fn seek(&self, seconds: u64) -> Result<(), String> {
        let (reply_tx, reply_rx) = mpsc::channel();
        self.tx
            .send(AudioCommand::Seek(seconds, reply_tx))
            .map_err(|e| e.to_string())?;
        reply_rx.recv().map_err(|e| e.to_string())?
    }

    pub fn set_volume(&self, volume: f32) {
        let _ = self.tx.send(AudioCommand::SetVolume(volume));
    }

    pub fn toggle_mute(&self) -> bool {
        let (reply_tx, reply_rx) = mpsc::channel();
        if self.tx.send(AudioCommand::ToggleMute(reply_tx)).is_err() {
            return false;
        }
        reply_rx.recv().unwrap_or(false)
    }

    pub fn status(&self) -> PlaybackStatus {
        let (reply_tx, reply_rx) = mpsc::channel();
        if self.tx.send(AudioCommand::GetStatus(reply_tx)).is_err() {
            return PlaybackStatus {
                is_playing: false,
                position_sec: 0,
                volume: 0.75,
                is_muted: false,
                is_finished: false,
                audio_level: 0.0,
            };
        }
        reply_rx.recv().unwrap_or(PlaybackStatus {
            is_playing: false,
            position_sec: 0,
            volume: 0.75,
            is_muted: false,
            is_finished: false,
            audio_level: 0.0,
        })
    }
}
