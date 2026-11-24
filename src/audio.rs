use std::fs::File;
use std::io::BufReader;
use std::time::Duration;
use rodio::{Decoder, OutputStream, OutputStreamHandle, Sink};
use crate::models::PlaybackStatus;

pub struct AudioPlayer {
    _stream: OutputStream,
    stream_handle: OutputStreamHandle,
    sink: Option<Sink>,
    pub volume: f32,
    pub is_muted: bool,
}

impl AudioPlayer {
    pub fn new() -> Result<Self, String> {
        let (stream, stream_handle) = OutputStream::try_default()
            .map_err(|e| format!("Аудиоустройство недоступно: {e}"))?;

        Ok(Self {
            _stream: stream,
            stream_handle,
            sink: None,
            volume: 0.75,
            is_muted: false,
        })
    }

    pub fn play_file(&mut self, path: &str) -> Result<(), String> {
        if let Some(old) = self.sink.take() {
            old.stop();
        }

        if path.trim().is_empty() {
            return Ok(());
        }

        let file = File::open(path).map_err(|e| format!("Ошибка открытия файла: {e}"))?;
        let source = Decoder::new(BufReader::new(file))
            .map_err(|e| format!("Формат аудио не поддерживается: {e}"))?;

        let sink = Sink::try_new(&self.stream_handle).map_err(|e| e.to_string())?;
        sink.set_volume(if self.is_muted { 0.0 } else { self.volume });
        sink.append(source);
        sink.play();

        self.sink = Some(sink);
        Ok(())
    }

    pub fn pause(&self) {
        if let Some(sink) = &self.sink {
            sink.pause();
        }
    }

    pub fn resume(&self) {
        if let Some(sink) = &self.sink {
            sink.play();
        }
    }

    pub fn seek(&self, seconds: u64) -> Result<(), String> {
        if let Some(sink) = &self.sink {
            sink.try_seek(Duration::from_secs(seconds))
                .map_err(|e| format!("Ошибка перемотки: {e:?}"))?;
        }
        Ok(())
    }

    pub fn set_volume(&mut self, val: f32) {
        let clamped = val.clamp(0.0, 1.0);
        self.volume = clamped;
        if clamped > 0.0 {
            self.is_muted = false;
        }
        if let Some(sink) = &self.sink {
            sink.set_volume(if self.is_muted { 0.0 } else { self.volume });
        }
    }

    pub fn toggle_mute(&mut self) -> bool {
        self.is_muted = !self.is_muted;
        if let Some(sink) = &self.sink {
            sink.set_volume(if self.is_muted { 0.0 } else { self.volume });
        }
        self.is_muted
    }

    pub fn status(&self) -> PlaybackStatus {
        match &self.sink {
            Some(sink) => PlaybackStatus {
                is_playing: !sink.is_paused() && !sink.empty(),
                position_sec: sink.get_pos().as_secs(),
                volume: self.volume,
                is_muted: self.is_muted,
                is_finished: sink.empty(),
            },
            None => PlaybackStatus {
                is_playing: false,
                position_sec: 0,
                volume: self.volume,
                is_muted: self.is_muted,
                is_finished: false,
            },
        }
    }
}