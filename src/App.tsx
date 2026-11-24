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
  PlaylistItem,
  TrackItem,
  WaveSettings,
  getCoverGradient,
} from './shared/models';
import { tauriApi } from './services/tauri_api';

export const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<NavTab>('home');
  const [activePlaylistId, setActivePlaylistId] = useState<string | null>(null);
  const [tracks, setTracks] = useState<TrackItem[]>([]);
  const [playlists, setPlaylists] = useState<PlaylistItem[]>([]);

  const [currentTrack, setCurrentTrack] = useState<TrackItem | null>(null);
  const [queue, setQueue] = useState<TrackItem[]>([]);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isShuffle, setIsShuffle] = useState(false);
  const [isRepeat, setIsRepeat] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [isQueueOpen, setIsQueueOpen] = useState(false);
  const [positionSec, setPositionSec] = useState(0);
  const [volume, setVolume] = useState(0.75);

  const [searchQuery, setSearchQuery] = useState('');
  const [isWaveModalOpen, setIsWaveModalOpen] = useState(false);
  const [waveSettings, setWaveSettings] = useState<WaveSettings>({
    mood: 'Спокойное',
    activity: 'Для фокуса',
    character: 'Незнакомое',
    genre: null,
  });

  // Загружаем треки и плейлисты из Rust SQLite при запуске
  useEffect(() => {
    void (async () => {
      try {
        const [dbTracks, dbPlaylists] = await Promise.all([
          tauriApi.getTracks(),
          tauriApi.getPlaylists(),
        ]);
        setTracks(dbTracks);
        setQueue(dbTracks);
        setPlaylists(dbPlaylists);
        if (dbTracks.length > 0) {
          setCurrentTrack(dbTracks[0]);
        }
      } catch (err) {
        console.error('Ошибка загрузки медиатеки:', err);
      }
    })();
  }, []);

  const handlePlayTrack = useCallback(
    async (track: TrackItem, contextQueue?: TrackItem[]) => {
      const nextQueue = contextQueue ?? (queue.length > 0 ? queue : tracks);
      setQueue(nextQueue);
      setCurrentTrack(track);
      setPositionSec(0);
      setIsPlaying(true);
      try {
        await tauriApi.playTrack(track.id, track.audioUrl);
      } catch (err) {
        console.error('Ошибка запуска трека:', err);
        setIsPlaying(false);
      }
    },
    [queue, tracks]
  );

  const handleNext = useCallback(async () => {
    if (queue.length === 0) return;

    if (isShuffle && queue.length > 1) {
      const candidates = queue.filter((t) => t.id !== currentTrack?.id);
      const randomTrack = candidates[Math.floor(Math.random() * candidates.length)];
      await handlePlayTrack(randomTrack, queue);
      return;
    }

    const idx = currentTrack
      ? queue.findIndex((t) => t.id === currentTrack.id)
      : -1;
    const nextIdx = (idx + 1) % queue.length;
    await handlePlayTrack(queue[nextIdx], queue);
  }, [queue, isShuffle, currentTrack, handlePlayTrack]);

  const handlePrev = useCallback(async () => {
    if (queue.length === 0) return;
    if (positionSec > 3) {
      setPositionSec(0);
      await tauriApi.seekTrack(0);
      return;
    }
    const idx = currentTrack
      ? queue.findIndex((t) => t.id === currentTrack.id)
      : 0;
    const prevIdx = (idx - 1 + queue.length) % queue.length;
    await handlePlayTrack(queue[prevIdx], queue);
  }, [queue, currentTrack, positionSec, handlePlayTrack]);

  // Синхронизируем таймер и автопереключение с Rust rodio
  useEffect(() => {
    if (!isPlaying || !currentTrack) return;
    const timer = window.setInterval(() => {
      void (async () => {
        try {
          const status = await tauriApi.getPlaybackStatus();
          setPositionSec(status.positionSec);
          if (status.isFinished) {
            if (isRepeat) {
              await handlePlayTrack(currentTrack, queue);
            } else {
              await handleNext();
            }
          }
        } catch {
          // Игнорируем разовые пропуски опроса
        }
      })();
    }, 500);

    return () => window.clearInterval(timer);
  }, [isPlaying, currentTrack, isRepeat, queue, handlePlayTrack, handleNext]);

  const handleTogglePlay = async () => {
    if (!currentTrack) {
      if (tracks.length > 0) {
        await handlePlayTrack(tracks[0], tracks);
      }
      return;
    }

    if (isPlaying) {
      await tauriApi.pauseTrack();
      setIsPlaying(false);
    } else {
      await tauriApi.resumeTrack();
      setIsPlaying(true);
    }
  };

  const handleSeek = async (sec: number) => {
    setPositionSec(sec);
    await tauriApi.seekTrack(sec);
  };

  const handleVolumeChange = async (val: number) => {
    setVolume(val);
    if (val > 0 && isMuted) setIsMuted(false);
    await tauriApi.setVolume(val);
  };

  const handleToggleMute = async () => {
    const muted = await tauriApi.toggleMute();
    setIsMuted(muted);
  };

  const handleToggleFavorite = async (trackId: string) => {
    const nextFav = await tauriApi.toggleFavorite(trackId);
    setTracks((prev) =>
      prev.map((t) => (t.id === trackId ? { ...t, isFavorite: nextFav } : t))
    );
    setCurrentTrack((prev) =>
      prev && prev.id === trackId ? { ...prev, isFavorite: nextFav } : prev
    );
  };

  const handleCreatePlaylist = async () => {
    const id = `pl-${Date.now()}`;
    const name = `Плейлист #${playlists.length + 1}`;
    const created = await tauriApi.createPlaylist(id, name);
    setPlaylists((prev) => [...prev, created]);
  };

  const handleScanFolder = async () => {
    const updatedTracks = await tauriApi.pickAndScanFolder();
    if (!updatedTracks) return;
    setTracks(updatedTracks);
    setQueue(updatedTracks);
    if (!currentTrack && updatedTracks.length > 0) {
      setCurrentTrack(updatedTracks[0]);
    }
  };

  const favoriteTracks = useMemo(() => tracks.filter((t) => t.isFavorite), [tracks]);

  const filteredTracks = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return tracks;
    return tracks.filter(
      (t) =>
        t.title.toLowerCase().includes(q) ||
        t.artist.toLowerCase().includes(q) ||
        t.album.toLowerCase().includes(q)
    );
  }, [tracks, searchQuery]);

  const activePlaylist = useMemo(
    () => playlists.find((p) => p.id === activePlaylistId) ?? null,
    [playlists, activePlaylistId]
  );

  const activePlaylistTracks = useMemo(() => {
    if (!activePlaylist) return [];
    return tracks.filter((t) => activePlaylist.trackIds.includes(t.id));
  }, [tracks, activePlaylist]);

  const activeWaveTags = Object.values(waveSettings).filter(Boolean) as string[];

  return (
    <div className="app-shell">
      <Sidebar
        activeTab={activeTab}
        activePlaylistId={activePlaylistId}
        playlists={playlists}
        onSelectTab={(tab) => {
          setActiveTab(tab);
          setActivePlaylistId(null);
        }}
        onSelectPlaylist={(id) => {
          setActiveTab('playlist');
          setActivePlaylistId(id);
        }}
        onCreatePlaylist={() => void handleCreatePlaylist()}
        onScanFolder={() => void handleScanFolder()}
      />

      <main className="main-workspace">
        {activeTab === 'home' && (
          <>
            <section className="wave-hero">
              <svg className="wave-hero-bg-lines" viewBox="0 0 340 240" fill="none">
                <circle cx="210" cy="120" r="70" stroke="white" strokeWidth="1.2" />
                <circle cx="210" cy="120" r="105" stroke="white" strokeWidth="1" />
                <circle cx="210" cy="120" r="140" stroke="white" strokeWidth="0.8" />
              </svg>

              <div>
                <h1 className="wave-hero-title">Моя волна</h1>
                <p className="wave-hero-subtitle">
                  Бесконечный персональный поток под твоё настроение
                </p>
                {activeWaveTags.length > 0 && (
                  <span className="wave-active-tag">
                    {activeWaveTags.join(' • ')}
                  </span>
                )}
              </div>

              <div className="wave-controls">
                <button
                  type="button"
                  className="wave-play-btn"
                  onClick={() => void handleTogglePlay()}
                  title="Запустить Мою волну"
                >
                  {isPlaying ? (
                    <Pause size={22} fill="#141416" />
                  ) : (
                    <Play size={22} fill="#141416" style={{ marginLeft: 3 }} />
                  )}
                </button>

                <button
                  type="button"
                  className="wave-settings-btn"
                  onClick={() => setIsWaveModalOpen(true)}
                >
                  <SlidersHorizontal size={16} />
                  <span>Настроить волну</span>
                </button>
              </div>
            </section>

            {tracks.length === 0 ? (
              <div style={{ marginTop: 28 }} className="empty-box">
                <FolderPlus size={36} color="rgba(255,255,255,0.6)" />
                <div className="track-name" style={{ fontSize: 16 }}>
                  Медиатека пока пуста
                </div>
                <p className="track-artist" style={{ maxWidth: 380 }}>
                  Выбери папку с музыкой на компьютере — Rust-сканер прочитает теги и сохранит треки в локальную базу SQLite.
                </p>
                <button
                  type="button"
                  className="btn-primary-pill"
                  style={{ marginTop: 6 }}
                  onClick={() => void handleScanFolder()}
                >
                  Выбрать папку с музыкой
                </button>
              </div>
            ) : (
              <>
                <div className="section-header-row">
                  <h2 className="section-heading">Недавно добавлено</h2>
                </div>

                <div className="recent-grid">
                  {tracks.slice(0, 6).map((track) => {
                    const isCurrent = currentTrack?.id === track.id;
                    return (
                      <button
                        key={track.id}
                        type="button"
                        className={`recent-card ${isCurrent ? 'is-playing' : ''}`}
                        onClick={() => void handlePlayTrack(track, tracks)}
                      >
                        <div
                          className="recent-thumb"
                          style={{ background: getCoverGradient(track.id) }}
                        >
                          <Music size={19} />
                        </div>
                        <div className="recent-card-text">
                          <span className="recent-card-title">{track.title}</span>
                          <span className="recent-card-artist">{track.artist}</span>
                        </div>
                      </button>
                    );
                  })}
                </div>

                <div className="section-header-row">
                  <h2 className="section-heading">Коллекция треков ({tracks.length})</h2>
                </div>

                <TrackList
                  tracks={tracks}
                  currentTrackId={currentTrack?.id ?? null}
                  isPlaying={isPlaying}
                  onSelectTrack={(t) => void handlePlayTrack(t, tracks)}
                  onToggleFavorite={(id) => void handleToggleFavorite(id)}
                />
              </>
            )}
          </>
        )}

        {activeTab === 'search' && (
          <>
            <div className="search-bar-wrap">
              <Search size={17} className="search-input-icon" />
              <input
                type="text"
                className="search-input"
                placeholder="Треки, исполнители, альбомы..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            <TrackList
              tracks={filteredTracks}
              currentTrackId={currentTrack?.id ?? null}
              isPlaying={isPlaying}
              onSelectTrack={(t) => void handlePlayTrack(t, filteredTracks)}
              onToggleFavorite={(id) => void handleToggleFavorite(id)}
            />
          </>
        )}

        {activeTab === 'favorites' && (
          <>
            <div className="collection-banner">
              <div className="collection-big-cover">
                <Heart size={54} fill="#ffffff" color="#ffffff" />
              </div>
              <div>
                <div className="collection-banner-label">Плейлист</div>
                <h1 className="collection-banner-title">Мне нравится</h1>
                <p className="collection-banner-meta">
                  Коллекция • {favoriteTracks.length} треков
                </p>
              </div>
            </div>
            <TrackList
              tracks={favoriteTracks}
              currentTrackId={currentTrack?.id ?? null}
              isPlaying={isPlaying}
              onSelectTrack={(t) => void handlePlayTrack(t, favoriteTracks)}
              onToggleFavorite={(id) => void handleToggleFavorite(id)}
            />
          </>
        )}

        {activeTab === 'playlist' && activePlaylist && (
          <>
            <div className="collection-banner">
              <div
                className="collection-big-cover"
                style={{ background: getCoverGradient(activePlaylist.id) }}
              >
                <Music size={54} />
              </div>
              <div>
                <div className="collection-banner-label">Плейлист</div>
                <h1 className="collection-banner-title">{activePlaylist.name}</h1>
                <p className="collection-banner-meta">
                  {activePlaylistTracks.length} треков
                </p>
              </div>
            </div>
            <TrackList
              tracks={activePlaylistTracks}
              currentTrackId={currentTrack?.id ?? null}
              isPlaying={isPlaying}
              onSelectTrack={(t) => void handlePlayTrack(t, activePlaylistTracks)}
              onToggleFavorite={(id) => void handleToggleFavorite(id)}
            />
          </>
        )}
      </main>

      {isQueueOpen && (
        <aside className="queue-drawer">
          <div className="queue-header">
            <span className="section-heading" style={{ fontSize: 17 }}>
              Сейчас играет
            </span>
            <button
              type="button"
              className="icon-ghost-btn"
              onClick={() => setIsQueueOpen(false)}
            >
              <X size={18} />
            </button>
          </div>

          {currentTrack && (
            <div className="queue-now-card">
              <div
                className="queue-big-art"
                style={{ background: getCoverGradient(currentTrack.id) }}
              >
                <Music size={46} />
              </div>
              <div className="track-name" style={{ fontSize: 16 }}>
                {currentTrack.title}
              </div>
              <div className="track-artist">{currentTrack.artist}</div>
            </div>
          )}

          <div className="modal-group-label" style={{ marginBottom: 10 }}>
            Далее в очереди ({queue.length})
          </div>

          <div className="queue-scroll">
            {queue
              .filter((t) => t.id !== currentTrack?.id)
              .map((track) => (
                <button
                  key={track.id}
                  type="button"
                  className="playlist-row"
                  onClick={() => void handlePlayTrack(track, queue)}
                >
                  <div
                    className="track-mini-cover"
                    style={{ background: getCoverGradient(track.id) }}
                  >
                    <Music size={14} />
                  </div>
                  <div className="recent-card-text">
                    <span className="track-name" style={{ fontSize: 13 }}>
                      {track.title}
                    </span>
                    <span className="track-artist">{track.artist}</span>
                  </div>
                </button>
              ))}
          </div>
        </aside>
      )}

      <PlayerBar
        currentTrack={currentTrack}
        isPlaying={isPlaying}
        isShuffle={isShuffle}
        isRepeat={isRepeat}
        isQueueOpen={isQueueOpen}
        isMuted={isMuted}
        positionSec={positionSec}
        volume={volume}
        onTogglePlay={() => void handleTogglePlay()}
        onToggleShuffle={() => setIsShuffle((s) => !s)}
        onToggleRepeat={() => setIsRepeat((r) => !r)}
        onToggleQueue={() => setIsQueueOpen((q) => !q)}
        onToggleMute={() => void handleToggleMute()}
        onPrev={() => void handlePrev()}
        onNext={() => void handleNext()}
        onSeek={(sec) => void handleSeek(sec)}
        onVolumeChange={(val) => void handleVolumeChange(val)}
        onToggleFavorite={(id) => void handleToggleFavorite(id)}
      />

      <WaveModal
        isOpen={isWaveModalOpen}
        initialSettings={waveSettings}
        onClose={() => setIsWaveModalOpen(false)}
        onApply={setWaveSettings}
      />
    </div>
  );
};

export default App;