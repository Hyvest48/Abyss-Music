#[cfg(not(any(target_os = "android", target_os = "ios")))]
mod desktop_media {
    use std::sync::mpsc::{self, Sender};
    use std::thread;
    use std::time::Duration;
    use souvlaki::{
        MediaControlEvent, MediaControls, MediaMetadata, MediaPlayback, MediaPosition, PlatformConfig,
    };
    use tauri::{AppHandle, Emitter};

    #[allow(clippy::enum_variant_names)]
    enum MediaCmd {
        SetMetadata {
            title: String,
            artist: String,
            album: String,
            cover_url: Option<String>,
            duration_sec: u64,
        },
        SetPlayback {
            is_playing: bool,
            position_sec: u64,
        },
        SetStopped,
    }

    pub struct MediaControlsManager {
        tx: Option<Sender<MediaCmd>>,
    }

    impl MediaControlsManager {
        pub fn new(app: AppHandle, hwnd_ptr: Option<usize>) -> Self {
            let (tx, rx) = mpsc::channel::<MediaCmd>();

            thread::spawn(move || {
                #[cfg(target_os = "windows")]
                let hwnd = hwnd_ptr.map(|p| p as *mut std::ffi::c_void);
                #[cfg(not(target_os = "windows"))]
                let hwnd = None;

                let config = PlatformConfig {
                    dbus_name: "abyss_music",
                    display_name: "Abyss Music",
                    hwnd,
                };

                let mut controls = match MediaControls::new(config) {
                    Ok(c) => c,
                    Err(e) => {
                        eprintln!("Не удалось инициализировать системные медиа-контролы: {:?}", e);
                        return;
                    }
                };

                let app_handle = app.clone();
                if let Err(e) = controls.attach(move |event: MediaControlEvent| {
                    let action = match event {
                        MediaControlEvent::Play => Some("play"),
                        MediaControlEvent::Pause => Some("pause"),
                        MediaControlEvent::Toggle => Some("toggle"),
                        MediaControlEvent::Next => Some("next"),
                        MediaControlEvent::Previous => Some("previous"),
                        MediaControlEvent::Stop => Some("stop"),
                        _ => None,
                    };
                    if let Some(act) = action {
                        let _ = app_handle.emit("media-control", act);
                    } else if let MediaControlEvent::SetPosition(pos) = event {
                        let _ = app_handle.emit("media-seek", pos.0.as_secs());
                    }
                }) {
                    eprintln!("Ошибка подключения обработчика медиа-контролов: {:?}", e);
                    return;
                }

                while let Ok(cmd) = rx.recv() {
                    match cmd {
                        MediaCmd::SetMetadata {
                            title,
                            artist,
                            album,
                            cover_url,
                            duration_sec,
                        } => {
                            let duration = if duration_sec > 0 {
                                Some(Duration::from_secs(duration_sec))
                            } else {
                                None
                            };
                            let meta = MediaMetadata {
                                title: Some(title.as_str()),
                                artist: Some(artist.as_str()),
                                album: Some(album.as_str()),
                                cover_url: cover_url.as_deref(),
                                duration,
                            };
                            let _ = controls.set_metadata(meta);
                        }
                        MediaCmd::SetPlayback {
                            is_playing,
                            position_sec,
                        } => {
                            let progress = Some(MediaPosition(Duration::from_secs(position_sec)));
                            let playback = if is_playing {
                                MediaPlayback::Playing { progress }
                            } else {
                                MediaPlayback::Paused { progress }
                            };
                            let _ = controls.set_playback(playback);
                        }
                        MediaCmd::SetStopped => {
                            let _ = controls.set_playback(MediaPlayback::Stopped);
                        }
                    }
                }
            });

            Self { tx: Some(tx) }
        }

        pub fn set_metadata(
            &self,
            title: String,
            artist: String,
            album: String,
            cover_url: Option<String>,
            duration_sec: u64,
        ) {
            if let Some(ref tx) = self.tx {
                let _ = tx.send(MediaCmd::SetMetadata {
                    title,
                    artist,
                    album,
                    cover_url,
                    duration_sec,
                });
            }
        }

        pub fn set_playback(&self, is_playing: bool, position_sec: u64) {
            if let Some(ref tx) = self.tx {
                let _ = tx.send(MediaCmd::SetPlayback {
                    is_playing,
                    position_sec,
                });
            }
        }

        #[allow(dead_code)]
        pub fn set_stopped(&self) {
            if let Some(ref tx) = self.tx {
                let _ = tx.send(MediaCmd::SetStopped);
            }
        }
    }
}

#[cfg(any(target_os = "android", target_os = "ios"))]
mod desktop_media {
    use tauri::AppHandle;

    pub struct MediaControlsManager;

    impl MediaControlsManager {
        pub fn new(_app: AppHandle, _hwnd_ptr: Option<usize>) -> Self {
            Self
        }
        pub fn set_metadata(
            &self,
            title: String,
            artist: String,
            album: String,
            cover_url: Option<String>,
            duration_sec: u64,
        ) {
            #[cfg(target_os = "android")]
            crate::android_call_media_metadata(
                &title,
                &artist,
                &album,
                cover_url.as_deref().unwrap_or(""),
                duration_sec,
            );
            #[cfg(not(target_os = "android"))]
            let _ = (title, artist, album, cover_url, duration_sec);
        }
        pub fn set_playback(&self, is_playing: bool, position_sec: u64) {
            #[cfg(target_os = "android")]
            crate::android_call_media_playback(is_playing, position_sec);
            #[cfg(not(target_os = "android"))]
            let _ = (is_playing, position_sec);
        }
        #[allow(dead_code)]
        pub fn set_stopped(&self) {}
    }
}

pub use desktop_media::MediaControlsManager;
