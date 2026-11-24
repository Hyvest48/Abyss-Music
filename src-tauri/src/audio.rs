use std::fs::File;
use std::io::{BufReader, Cursor, Read, Seek};
use std::sync::mpsc::{self, Sender};
use std::thread;
use std::time::Duration;
use rodio::{Decoder, OutputStream, Sink};
use crate::models::PlaybackStatus;

trait ReadSeek: Read + Seek + Send + Sync {}
impl<T: Read + Seek + Send + Sync> ReadSeek for T {}

enum AudioCommand {
    Play(String, Sender<Result<(), String>>),
    Pause,
    Resume,
    Seek(u64, Sender<Result<(), String>>),
    SetVolume(f32),
    ToggleMute(Sender<bool>),
    GetStatus(Sender<PlaybackStatus>),
}

pub struct AudioPlayer {
    tx: Sender<AudioCommand>,
}

impl AudioPlayer {
    pub fn new() -> Result<Self, String> {
        let (cmd_tx, cmd_rx) = mpsc::channel::<AudioCommand>();
        let (init_tx, init_rx) = mpsc::channel::<Result<(), String>>();

        thread::spawn(move || {
            let (_stream, stream_handle) = match OutputStream::try_default() {
                Ok(out) => {
                    let _ = init_tx.send(Ok(()));
                    out
                }
                Err(e) => {
                    let _ = init_tx.send(Err(e.to_string()));
                    return;
                }
            };

            let mut sink: Option<Sink> = None;
            let mut volume: f32 = 0.75;
            let mut is_muted = false;
            let mut has_started = false;

            while let Ok(cmd) = cmd_rx.recv() {
                match cmd {
                    AudioCommand::Play(source_path, reply) => {
                        if let Some(old_sink) = sink.take() {
                            old_sink.stop();
                        }
                        let res = (|| -> Result<(), String> {
                            let reader: Box<dyn ReadSeek> = if source_path.starts_with("http://")
                                || source_path.starts_with("https://")
                            {
                                let client = reqwest::blocking::Client::builder()
                                    .timeout(Duration::from_secs(20))
                                    .build()
                                    .map_err(|e| format!("Ошибка HTTP-клиента: {}", e))?;
                                let bytes = client
                                    .get(&source_path)
                                    .send()
                                    .map_err(|e| format!("Ошибка загрузки потока: {}", e))?
                                    .bytes()
                                    .map_err(|e| format!("Ошибка чтения аудиопотока: {}", e))?;
                                Box::new(Cursor::new(bytes.to_vec()))
                            } else {
                                let file = File::open(&source_path)
                                    .map_err(|e| format!("Не удалось открыть файл: {}", e))?;
                                Box::new(BufReader::new(file))
                            };

                            let source = Decoder::new(reader)
                                .map_err(|e| format!("Ошибка декодирования аудио: {}", e))?;
                            let new_sink = Sink::try_new(&stream_handle)
                                .map_err(|e| e.to_string())?;
                            new_sink.set_volume(if is_muted { 0.0 } else { volume });
                            new_sink.append(source);
                            new_sink.play();
                            sink = Some(new_sink);
                            has_started = true;
                            Ok(())
                        })();
                        let _ = reply.send(res);
                    }
                    AudioCommand::Pause => {
                        if let Some(ref s) = sink {
                            s.pause();
                        }
                    }
                    AudioCommand::Resume => {
                        if let Some(ref s) = sink {
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
                        volume = vol.clamp(0.0, 1.0);
                        if volume > 0.0 {
                            is_muted = false;
                        }
                        if let Some(ref s) = sink {
                            s.set_volume(if is_muted { 0.0 } else { volume });
                        }
                    }
                    AudioCommand::ToggleMute(reply) => {
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
                                }
                            }
                            None => PlaybackStatus {
                                is_playing: false,
                                position_sec: 0,
                                volume,
                                is_muted,
                                is_finished: false,
                            },
                        };
                        let _ = reply.send(status);
                    }
                }
            }
        });

        init_rx.recv().map_err(|e| e.to_string())??;
        Ok(Self { tx: cmd_tx })
    }

    pub fn play_file(&self, path: &str) -> Result<(), String> {
        let (reply_tx, reply_rx) = mpsc::channel();
        self.tx
            .send(AudioCommand::Play(path.to_string(), reply_tx))
            .map_err(|e| e.to_string())?;
        reply_rx.recv().map_err(|e| e.to_string())?
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
            };
        }
        reply_rx.recv().unwrap_or(PlaybackStatus {
            is_playing: false,
            position_sec: 0,
            volume: 0.75,
            is_muted: false,
            is_finished: false,
        })
    }
}