import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Play,
  Pause,
  SlidersHorizontal,
  Search,
  Heart,
  Music,
  FolderPlus,
  X,
} from 'lucide-react';
import { Sidebar, NavTab } from './components/sidebar';
import { WaveModal } from './components/wave_modal';
import { TrackList } from './components/track_list';
import { PlayerBar } from './components/player_bar';
import {
  PlaybackStatus,
  PlaylistItem,
  TrackItem,
  WaveSettings,
} from './shared/models';
import { tauriApi } from './services/tauri_api';

export const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<NavTab>('home');
  const [activePlaylistId, setActivePlaylistId] = useState<string | null>(null);
  const [tracks, setTracks] = useState<TrackItem[]>([]);
  const [onlineTracks, setOnlineTracks] = useState<TrackItem[]>([]);
  const [playlists, setPlaylists] = useState<PlaylistItem[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoadingStream, setIsLoadingStream] = useState(false);

  // Настройки «Моей волны» сброшены при запуске
  const [waveSettings, setWaveSettings] = useState<WaveSettings>({
    mood: null,
    activity: null,
    character: null,
    genre: null,
  });
  const [isWaveModalOpen, setIsWaveModalOpen] = useState(false);

  // Состояние плеера
  const [currentTrack, setCurrentTrack] = useState<TrackItem | null>(null);
  const [queue, setQueue] = useState<TrackItem[]>([]);
  const [isShuffle, setIsShuffle] = useState(false);
  const [isRepeat, setIsRepeat] = useState(false);
  const [isQueueOpen, setIsQueueOpen] = useState(false);
  const [playbackStatus, setPlaybackStatus] = useState<PlaybackStatus>({
    isPlaying: false,
    positionSec: 0,
    volume: 0.75,
    isMuted: false,
    isFinished: false,
  });

  // Загрузка локальной базы SQLite при старте
  useEffect(() => {
    const initData = async () => {
      try {
        const [savedTracks, savedPlaylists] = await Promise.all([
          tauriApi.getTracks(),
          tauriApi.getPlaylists(),
        ]);
        setTracks(savedTracks);
        setPlaylists(savedPlaylists);
      } catch (err) {
        console.error('Ошибка инициализации данных:', err);
      }
    };
    initData();
  }, []);

  // Живой поиск по Audius + Abyss API (задержка 400 мс)
  useEffect(() => {
    if (activeTab !== 'search') return;
    const trimmed = searchQuery.trim();
    if (!trimmed) {
      setOnlineTracks([]);
      return;
    }

    const timer = setTimeout(async () => {
      setIsLoadingStream(true);
      try {
        const found = await tauriApi.searchOnlineTracks(trimmed);
        setOnlineTracks(found);
      } catch (err) {
        console.error('Ошибка онлайн-поиска:', err);
      } finally {
        setIsLoadingStream(false);
      }
    }, 400);

    return () => clearTimeout(timer);
  }, [searchQuery, activeTab]);

  // Запуск выбранного трека
  const handleSelectTrack = useCallback(
    async (track: TrackItem, customQueue?: TrackItem[]) => {
      try {
        if (customQueue) {
          setQueue(customQueue);
        }
        setCurrentTrack(track);
        await tauriApi.playTrack(track.id, track.audioUrl);
        setPlaybackStatus((prev) => ({
          ...prev,
          isPlaying: true,
          positionSec: 0,
          isFinished: false,
        }));
      } catch (err) {
        console.error('Ошибка воспроизведения:', err);
      }
    },
    []
  );

  // Следующий трек
  const handleNextTrack = useCallback(async () => {
    const activeList =
      queue.length > 0 ? queue : onlineTracks.length > 0 ? onlineTracks : tracks;
    if (activeList.length === 0) return;

    if (isRepeat && currentTrack) {
      await handleSelectTrack(currentTrack, activeList);
      return;
    }

    if (isShuffle) {
      const randomIndex = Math.floor(Math.random() * activeList.length);
      await handleSelectTrack(activeList[randomIndex], activeList);
      return;
    }

    const currentIndex = currentTrack
      ? activeList.findIndex((t) => t.id === currentTrack.id)
      : -1;
    const nextIndex = currentIndex + 1;

    if (nextIndex < activeList.length) {
      await handleSelectTrack(activeList[nextIndex], activeList);
    } else {
      setPlaybackStatus((prev) => ({ ...prev, isPlaying: false }));
    }
  }, [queue, onlineTracks, tracks, isRepeat, currentTrack, isShuffle, handleSelectTrack]);

  // Предыдущий трек
  const handlePrevTrack = useCallback(async () => {
    const activeList =
      queue.length > 0 ? queue : onlineTracks.length > 0 ? onlineTracks : tracks;
    if (activeList.length === 0) return;

    if (playbackStatus.positionSec > 3 && currentTrack) {
      await tauriApi.seekTrack(0);
      setPlaybackStatus((prev) => ({ ...prev, positionSec: 0 }));
      return;
    }

    const currentIndex = currentTrack
      ? activeList.findIndex((t) => t.id === currentTrack.id)
      : 0;
    const prevIndex = currentIndex > 0 ? currentIndex - 1 : activeList.length - 1;
    await handleSelectTrack(activeList[prevIndex], activeList);
  }, [queue, onlineTracks, tracks, playbackStatus.positionSec, currentTrack, handleSelectTrack]);

  // Синхронизация прогресса воспроизведения из Rust
  useEffect(() => {
    if (!currentTrack) return;

    const interval = setInterval(async () => {
      try {
        const status = await tauriApi.getPlaybackStatus();
        setPlaybackStatus(status);
        if (status.isFinished) {
          await handleNextTrack();
        }
      } catch (err) {
        console.error('Ошибка статуса плеера:', err);
      }
    }, 500);

    return () => clearInterval(interval);
  }, [currentTrack, handleNextTrack]);

  // Запуск потока «Моей волны»
  const handleStartWave = async (overrideSettings?: WaveSettings) => {
    const activeSettings = overrideSettings ?? waveSettings;
    setIsLoadingStream(true);
    try {
      const waveTracks = await tauriApi.getWaveTracks(activeSettings);
      if (waveTracks.length > 0) {
        setOnlineTracks(waveTracks);
        await handleSelectTrack(waveTracks[0], waveTracks);
      }
    } catch (err) {
      console.error('Ошибка запуска Моей волны:', err);
    } finally {
      setIsLoadingStream(false);
    }
  };

  const handlePickAndScanFolder = async () => {
    try {
      const scanned = await tauriApi.pickAndScanFolder();
      if (scanned) {
        setTracks(scanned);
      }
    } catch (err) {
      console.error('Ошибка сканирования папки:', err);
    }
  };

  const handleTogglePlay = async () => {
    if (!currentTrack) {
      const fallbackList = onlineTracks.length > 0 ? onlineTracks : tracks;
      if (fallbackList.length > 0) {
        await handleSelectTrack(fallbackList[0], fallbackList);
      } else {
        await handleStartWave();
      }
      return;
    }

    try {
      if (playbackStatus.isPlaying) {
        await tauriApi.pauseTrack();
        setPlaybackStatus((prev) => ({ ...prev, isPlaying: false }));
      } else {
        await tauriApi.resumeTrack();
        setPlaybackStatus((prev) => ({ ...prev, isPlaying: true }));
      }
    } catch (err) {
      console.error('Ошибка паузы/старта:', err);
    }
  };

  const handleSeek = async (seconds: number) => {
    try {
      await tauriApi.seekTrack(seconds);
      setPlaybackStatus((prev) => ({ ...prev, positionSec: seconds }));
    } catch (err) {
      console.error('Ошибка перемотки:', err);
    }
  };

  const handleVolumeChange = async (volume: number) => {
    try {
      await tauriApi.setVolume(volume);
      setPlaybackStatus((prev) => ({
        ...prev,
        volume,
        isMuted: volume === 0,
      }));
    } catch (err) {
      console.error('Ошибка громкости:', err);
    }
  };

  const handleToggleMute = async () => {
    try {
      const isMuted = await tauriApi.toggleMute();
      setPlaybackStatus((prev) => ({ ...prev, isMuted }));
    } catch (err) {
      console.error('Ошибка mute:', err);
    }
  };

  const handleToggleFavorite = async (trackId: string) => {
    try {
      const newFav = await tauriApi.toggleFavorite(trackId);
      setTracks((prev) =>
        prev.map((t) => (t.id === trackId ? { ...t, isFavorite: newFav } : t))
      );
      setOnlineTracks((prev) =>
        prev.map((t) => (t.id === trackId ? { ...t, isFavorite: newFav } : t))
      );
      if (currentTrack?.id === trackId) {
        setCurrentTrack((prev) => (prev ? { ...prev, isFavorite: newFav } : null));
      }
    } catch (err) {
      console.error('Ошибка избранного:', err);
    }
  };

  const handleCreatePlaylist = async () => {
    const index = playlists.length + 1;
    const id = `pl-${Date.now()}`;
    const name = `Плейлист #${index}`;
    try {
      const created = await tauriApi.createPlaylist(id, name);
      setPlaylists((prev) => [...prev, created]);
      setActivePlaylistId(created.id);
      setActiveTab('playlist');
    } catch (err) {
      console.error('Ошибка создания плейлиста:', err);
    }
  };

  const allAvailableTracks = useMemo(() => {
    const map = new Map<string, TrackItem>();
    tracks.forEach((t) => map.set(t.id, t));
    onlineTracks.forEach((t) => {
      if (!map.has(t.id)) map.set(t.id, t);
    });
    return Array.from(map.values());
  }, [tracks, onlineTracks]);

  const displayedTracks = useMemo(() => {
    if (activeTab === 'search') {
      const q = searchQuery.trim().toLowerCase();
      if (!q) return allAvailableTracks;
      return allAvailableTracks.filter(
        (t) =>
          t.title.toLowerCase().includes(q) ||
          t.artist.toLowerCase().includes(q) ||
          t.album.toLowerCase().includes(q)
      );
    }

    if (activeTab === 'favorites') {
      return allAvailableTracks.filter((t) => t.isFavorite);
    }

    if (activeTab === 'playlist' && activePlaylistId) {
      const pl = playlists.find((p) => p.id === activePlaylistId);
      if (!pl) return [];
      return allAvailableTracks.filter((t) => pl.trackIds.includes(t.id));
    }

    return onlineTracks.length > 0 ? onlineTracks : tracks;
  }, [
    activeTab,
    activePlaylistId,
    playlists,
    searchQuery,
    allAvailableTracks,
    onlineTracks,
    tracks,
  ]);

  const activeWaveTags = [
    waveSettings.mood,
    waveSettings.activity,
    waveSettings.character,
    waveSettings.genre,
  ].filter(Boolean) as string[];

  const activePlaylist = playlists.find((p) => p.id === activePlaylistId) || null;
  const activeQueue = queue.length > 0 ? queue : displayedTracks;
  const viewKey = `${activeTab}-${activePlaylistId ?? 'root'}`;

  return (
    <div className="app-shell">
      {/* Динамическая подсветка фона под обложку текущего трека */}
      {currentTrack?.coverUrl && (
        <div
          className="ambient-cover-glow"
          style={{ backgroundImage: `url(${currentTrack.coverUrl})` }}
          aria-hidden="true"
        />
      )}

      <Sidebar
        activeTab={activeTab}
        activePlaylistId={activePlaylistId}
        playlists={playlists}
        onSelectTab={(tab) => {
          setActiveTab(tab);
          if (tab !== 'playlist') {
            setActivePlaylistId(null);
          }
        }}
        onSelectPlaylist={(playlistId) => {
          setActivePlaylistId(playlistId);
          setActiveTab('playlist');
        }}
        onCreatePlaylist={handleCreatePlaylist}
        onScanFolder={handlePickAndScanFolder}
      />

      <main className="main-workspace">
        <div key={viewKey} className="view-transition">
          {activeTab === 'home' && (
            <>
              <section className="wave-hero">
                <svg className="wave-hero-bg-lines" viewBox="0 0 340 240" fill="none">
                  <path
                    d="M-20 190 C 80 110, 170 250, 360 120"
                    stroke="rgba(255,255,255,0.08)"
                    strokeWidth="1.5"
                  />
                  <path
                    d="M-20 140 C 110 60, 210 210, 360 70"
                    stroke="rgba(255,255,255,0.05)"
                    strokeWidth="1.5"
                  />
                </svg>

                <div className="wave-hero-content">
                  <h1 className="wave-hero-title">Моя волна</h1>
                  <p className="wave-hero-subtitle">
                    Бесконечный персональный поток под твоё настроение
                  </p>
                  {activeWaveTags.length > 0 && (
                    <div className="wave-tags-row">
                      {activeWaveTags.map((tag) => (
                        <span key={tag} className="wave-active-tag">
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                <div className="wave-controls">
                  <button
                    className={`wave-play-btn ${isLoadingStream ? 'is-loading' : ''}`}
                    onClick={() => handleStartWave()}
                    disabled={isLoadingStream}
                    title="Запустить Мою волну"
                  >
                    {playbackStatus.isPlaying && onlineTracks.length > 0 ? (
                      <Pause size={22} fill="currentColor" />
                    ) : (
                      <Play size={22} fill="currentColor" style={{ marginLeft: 2 }} />
                    )}
                  </button>
                  <button
                    className="wave-settings-btn"
                    onClick={() => setIsWaveModalOpen(true)}
                  >
                    <SlidersHorizontal size={16} />
                    <span>Настроить волну</span>
                  </button>
                </div>
              </section>

              {isLoadingStream && (
                <div style={{ marginTop: 28 }} className="empty-box">
                  <Music size={34} className="pulse-icon" />
                  <div className="track-name" style={{ fontSize: 16 }}>
                    Подбираем треки в поток...
                  </div>
                  <p className="track-artist" style={{ maxWidth: 380 }}>
                    Загружаем музыку из Audius и Abyss Cloud
                  </p>
                </div>
              )}

              {!isLoadingStream && displayedTracks.length === 0 && (
                <div style={{ marginTop: 28 }} className="empty-box">
                  <FolderPlus size={36} />
                  <div className="track-name" style={{ fontSize: 16 }}>
                    Медиатека пока пуста
                  </div>
                  <p className="track-artist" style={{ maxWidth: 380 }}>
                    Выбери папку с музыкой на компьютере — Rust-сканер прочитает теги и сохранит треки в локальную базу SQLite, или нажми Play в «Моей волне».
                  </p>
                  <button className="btn-primary-pill" onClick={handlePickAndScanFolder}>
                    Выбрать папку с музыкой
                  </button>
                </div>
              )}

              {!isLoadingStream && displayedTracks.length > 0 && (
                <>
                  <div className="section-header-row">
                    <h2 className="section-heading">Недавно добавлено</h2>
                  </div>
                  <div className="recent-grid">
                    {displayedTracks.slice(0, 6).map((track, idx) => {
                      const isCurrent = currentTrack?.id === track.id;
                      return (
                        <button
                          key={track.id}
                          type="button"
                          className={`recent-card stagger-item ${isCurrent ? 'is-playing' : ''}`}
                          style={{ animationDelay: `${idx * 45}ms` }}
                          onClick={() => handleSelectTrack(track, displayedTracks)}
                        >
                          {track.coverUrl ? (
                            <img
                              src={track.coverUrl}
                              alt={track.title}
                              className="recent-thumb"
                            />
                          ) : (
                            <div className="recent-thumb">
                              <Music size={18} />
                            </div>
                          )}
                          <div className="recent-card-text">
                            <span className="recent-card-title">{track.title}</span>
                            <span className="recent-card-artist">{track.artist}</span>
                          </div>
                        </button>
                      );
                    })}
                  </div>

                  <div className="section-header-row">
                    <h2 className="section-heading">
                      {onlineTracks.length > 0
                        ? `Поток «Моей волны» (${displayedTracks.length})`
                        : `Коллекция треков (${tracks.length})`}
                    </h2>
                  </div>
                  <TrackList
                    tracks={displayedTracks}
                    currentTrackId={currentTrack?.id ?? null}
                    isPlaying={playbackStatus.isPlaying}
                    onSelectTrack={(track) => handleSelectTrack(track, displayedTracks)}
                    onToggleFavorite={handleToggleFavorite}
                  />
                </>
              )}
            </>
          )}

          {activeTab === 'search' && (
            <div>
              <div className="search-bar-wrap">
                <Search size={17} className="search-input-icon" />
                <input
                  type="text"
                  className="search-input"
                  placeholder="Поиск треков, исполнителей или жанров (Audius + Abyss API)..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  autoFocus
                />
                {searchQuery && (
                  <button
                    className="icon-ghost-btn search-clear-btn"
                    onClick={() => setSearchQuery('')}
                    title="Очистить"
                  >
                    <X size={16} />
                  </button>
                )}
              </div>

              {isLoadingStream ? (
                <div style={{ marginTop: 28 }} className="empty-box">
                  <Search size={32} className="pulse-icon" />
                  <div className="track-name" style={{ fontSize: 16 }}>
                    Ищем треки в сети...
                  </div>
                </div>
              ) : displayedTracks.length > 0 ? (
                <TrackList
                  tracks={displayedTracks}
                  currentTrackId={currentTrack?.id ?? null}
                  isPlaying={playbackStatus.isPlaying}
                  onSelectTrack={(track) => handleSelectTrack(track, displayedTracks)}
                  onToggleFavorite={handleToggleFavorite}
                />
              ) : (
                <div style={{ marginTop: 28 }} className="empty-box">
                  <Search size={32} />
                  <div className="track-name" style={{ fontSize: 16 }}>
                    Ничего не найдено
                  </div>
                  <p className="track-artist" style={{ maxWidth: 380 }}>
                    Введи название трека или исполнителя для поиска по Audius и локальной базе
                  </p>
                </div>
              )}
            </div>
          )}

          {activeTab === 'favorites' && (
            <div>
              <div className="collection-banner">
                <div className="collection-big-cover">
                  <Heart size={42} />
                </div>
                <div>
                  <div className="collection-banner-label">Плейлист</div>
                  <h1 className="collection-banner-title">Мне нравится</h1>
                  <p className="collection-banner-meta">
                    Треков: {displayedTracks.length}
                  </p>
                </div>
              </div>

              {displayedTracks.length > 0 ? (
                <TrackList
                  tracks={displayedTracks}
                  currentTrackId={currentTrack?.id ?? null}
                  isPlaying={playbackStatus.isPlaying}
                  onSelectTrack={(track) => handleSelectTrack(track, displayedTracks)}
                  onToggleFavorite={handleToggleFavorite}
                />
              ) : (
                <div style={{ marginTop: 28 }} className="empty-box">
                  <Heart size={32} />
                  <div className="track-name" style={{ fontSize: 16 }}>
                    В избранном пока пусто
                  </div>
                  <p className="track-artist" style={{ maxWidth: 380 }}>
                    Нажимай на сердечко рядом с треками, чтобы сохранять их сюда
                  </p>
                </div>
              )}
            </div>
          )}

          {activeTab === 'playlist' && activePlaylist && (
            <div>
              <div className="collection-banner">
                <div className="collection-big-cover">
                  <Music size={42} />
                </div>
                <div>
                  <div className="collection-banner-label">Плейлист</div>
                  <h1 className="collection-banner-title">{activePlaylist.name}</h1>
                  <p className="collection-banner-meta">
                    Треков: {displayedTracks.length}
                  </p>
                </div>
              </div>

              {displayedTracks.length > 0 ? (
                <TrackList
                  tracks={displayedTracks}
                  currentTrackId={currentTrack?.id ?? null}
                  isPlaying={playbackStatus.isPlaying}
                  onSelectTrack={(track) => handleSelectTrack(track, displayedTracks)}
                  onToggleFavorite={handleToggleFavorite}
                />
              ) : (
                <div style={{ marginTop: 28 }} className="empty-box">
                  <Music size={32} />
                  <div className="track-name" style={{ fontSize: 16 }}>
                    Плейлист пуст
                  </div>
                  <p className="track-artist" style={{ maxWidth: 380 }}>
                    Добавляй треки в этот плейлист из поиска или медиатеки
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      </main>

      {isQueueOpen && (
        <aside className="queue-drawer">
          <div className="queue-header">
            <span className="section-heading" style={{ fontSize: 17 }}>
              Очередь
            </span>
            <button
              className="icon-ghost-btn"
              onClick={() => setIsQueueOpen(false)}
              title="Закрыть очередь"
            >
              <X size={18} />
            </button>
          </div>

          {currentTrack && (
            <div className="queue-now-card">
              {currentTrack.coverUrl ? (
                <img
                  src={currentTrack.coverUrl}
                  alt={currentTrack.title}
                  className="queue-big-art"
                />
              ) : (
                <div className="queue-big-art">
                  <Music size={36} />
                </div>
              )}
              <div className="track-name" style={{ fontSize: 16 }}>
                {currentTrack.title}
              </div>
              <div className="track-artist">{currentTrack.artist}</div>
            </div>
          )}

          <div className="modal-group-label" style={{ marginBottom: 10 }}>
            Далее в очереди ({activeQueue.length})
          </div>
          <div className="queue-scroll">
            {activeQueue.map((track) => {
              const isCurrent = currentTrack?.id === track.id;
              return (
                <button
                  key={track.id}
                  type="button"
                  className={`playlist-row ${isCurrent ? 'active' : ''}`}
                  onClick={() => handleSelectTrack(track, activeQueue)}
                >
                  {track.coverUrl ? (
                    <img
                      src={track.coverUrl}
                      alt={track.title}
                      className="track-mini-cover"
                    />
                  ) : (
                    <div className="track-mini-cover">
                      <Music size={14} />
                    </div>
                  )}
                  <div className="recent-card-text">
                    <span className="track-name" style={{ fontSize: 13 }}>
                      {track.title}
                    </span>
                    <span className="track-artist">{track.artist}</span>
                  </div>
                </button>
              );
            })}
          </div>
        </aside>
      )}

      <PlayerBar
        currentTrack={currentTrack}
        isPlaying={playbackStatus.isPlaying}
        isShuffle={isShuffle}
        isRepeat={isRepeat}
        isQueueOpen={isQueueOpen}
        isMuted={playbackStatus.isMuted}
        positionSec={playbackStatus.positionSec}
        volume={playbackStatus.volume}
        onTogglePlay={handleTogglePlay}
        onToggleShuffle={() => setIsShuffle((s) => !s)}
        onToggleRepeat={() => setIsRepeat((r) => !r)}
        onToggleQueue={() => setIsQueueOpen((q) => !q)}
        onNext={handleNextTrack}
        onPrev={handlePrevTrack}
        onSeek={handleSeek}
        onVolumeChange={handleVolumeChange}
        onToggleMute={handleToggleMute}
        onToggleFavorite={() => currentTrack && handleToggleFavorite(currentTrack.id)}
      />

      {isWaveModalOpen && (
        <WaveModal
          isOpen={isWaveModalOpen}
          initialSettings={waveSettings}
          onClose={() => setIsWaveModalOpen(false)}
          onApply={async (newSettings) => {
            setWaveSettings(newSettings);
            setIsWaveModalOpen(false);
            await handleStartWave(newSettings);
          }}
        />
      )}
    </div>
  );
};

export default App;