import React, {
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
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
import { NowPlayingOverlay } from './components/now_playing_overlay';
import { CommandPalette } from './components/command_palette';
import { ThemeModal } from './components/theme_modal';
import { THEME_PRESETS, ThemePreset } from './shared/themes';
import {
  PlaybackStatus,
  PlaylistItem,
  TrackItem,
  WaveSettings,
} from './shared/models';
import { tauriApi } from './services/tauri_api';

interface TopSearchBarProps {
  externalValue: string;
  onSearchCommit: (value: string) => void;
}

const TopSearchBar: React.FC<TopSearchBarProps> = React.memo(
  ({ externalValue, onSearchCommit }) => {
    const [localValue, setLocalValue] = useState(externalValue);
    const lastCommittedRef = useRef(externalValue);

    useEffect(() => {
      if (externalValue !== lastCommittedRef.current) {
        lastCommittedRef.current = externalValue;
        setLocalValue(externalValue);
      }
    }, [externalValue]);

    useEffect(() => {
      const timer = setTimeout(() => {
        if (localValue !== lastCommittedRef.current) {
          lastCommittedRef.current = localValue;
          onSearchCommit(localValue);
        }
      }, 300);
      return () => clearTimeout(timer);
    }, [localValue, onSearchCommit]);

    const handleImmediateSubmit = () => {
      if (localValue !== lastCommittedRef.current) {
        lastCommittedRef.current = localValue;
        onSearchCommit(localValue);
      }
    };

    return (
      <header className="top-search-header">
        <div className="search-bar-wrap">
          <Search size={17} className="search-input-icon" />
          <input
            type="text"
            className="search-input"
            placeholder="Поиск треков, исполнителей или жанров..."
            value={localValue}
            onChange={(e) => setLocalValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleImmediateSubmit();
            }}
          />
          {localValue ? (
            <button
              type="button"
              className="icon-ghost-btn search-clear-btn"
              onClick={() => {
                setLocalValue('');
                lastCommittedRef.current = '';
                onSearchCommit('');
              }}
              title="Очистить"
            >
              <X size={16} />
            </button>
          ) : (
            <kbd className="search-kbd">Ctrl K</kbd>
          )}
        </div>
      </header>
    );
  }
);

const INITIAL_RENDER_LIMIT = 40;

export const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<NavTab>('home');
  const [activePlaylistId, setActivePlaylistId] = useState<string | null>(null);
  const [tracks, setTracks] = useState<TrackItem[]>([]);
  const [onlineTracks, setOnlineTracks] = useState<TrackItem[]>([]);
  const [searchResults, setSearchResults] = useState<TrackItem[]>([]);
  const [playlists, setPlaylists] = useState<PlaylistItem[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoadingStream, setIsLoadingStream] = useState(false);
  const [isSearchingApi, setIsSearchingApi] = useState(false);
  const [renderLimit, setRenderLimit] = useState(INITIAL_RENDER_LIMIT);

  const [savedOnlineFavs, setSavedOnlineFavs] = useState<TrackItem[]>(() => {
    try {
      const raw = localStorage.getItem('abyss-online-favs');
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  });

  const [waveSettings, setWaveSettings] = useState<WaveSettings>({
    mood: null,
    activity: null,
    character: null,
    genre: null,
  });
  const [isWaveModalOpen, setIsWaveModalOpen] = useState(false);

  const [isNowPlayingOpen, setIsNowPlayingOpen] = useState(false);
  const [isCmdOpen, setIsCmdOpen] = useState(false);

  const [isThemeModalOpen, setIsThemeModalOpen] = useState(false);
  const [currentThemeId, setCurrentThemeId] = useState<string>(
    () => localStorage.getItem('abyss-theme') || 'abyss-violet'
  );

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

  const isTransitioningRef = useRef(false);
  const bloomRef = useRef<HTMLDivElement>(null);
  const searchCacheRef = useRef(new Map<string, TrackItem[]>());
  const allTracksRef = useRef<TrackItem[]>([]);

  // Применение выбранной темы
  useEffect(() => {
    const theme =
      THEME_PRESETS.find((t) => t.id === currentThemeId) || THEME_PRESETS[0];
    const root = document.documentElement;
    root.style.setProperty('--accent-warm', theme.accent);
    root.style.setProperty('--accent-secondary', theme.accent2);
    root.style.setProperty('--accent-glow', theme.glow);
    root.style.setProperty('--bg-base', theme.bgBase);
    root.style.setProperty('--sidebar-top', theme.sidebarTop);
    localStorage.setItem('abyss-theme', theme.id);
  }, [currentThemeId]);

  // Идеально центрированный и плавный белый блум за курсором
  useEffect(() => {
    const el = bloomRef.current;
    if (!el) return;

    let targetX = 0;
    let targetY = 0;
    let curX = 0;
    let curY = 0;
    let isInitialized = false;
    let rafId = 0;

    const animate = () => {
      if (!isInitialized) {
        rafId = 0;
        return;
      }

      const dx = targetX - curX;
      const dy = targetY - curY;

      if (Math.abs(dx) < 0.15 && Math.abs(dy) < 0.15) {
        curX = targetX;
        curY = targetY;
        el.style.transform = `translate3d(${curX}px, ${curY}px, 0)`;
        rafId = 0;
        return;
      }

      curX += dx * 0.14;
      curY += dy * 0.14;
      el.style.transform = `translate3d(${curX.toFixed(2)}px, ${curY.toFixed(2)}px, 0)`;
      rafId = requestAnimationFrame(animate);
    };

    const onMove = (e: PointerEvent) => {
      targetX = e.clientX;
      targetY = e.clientY;

      if (!isInitialized) {
        isInitialized = true;
        curX = targetX;
        curY = targetY;
        el.style.transform = `translate3d(${curX}px, ${curY}px, 0)`;
        el.style.opacity = '1';
        return;
      }

      if (!rafId) {
        rafId = requestAnimationFrame(animate);
      }
    };

    const onLeave = () => {
      isInitialized = false;
      el.style.opacity = '0';
    };

    window.addEventListener('pointermove', onMove, { passive: true });
    document.addEventListener('mouseleave', onLeave);

    return () => {
      window.removeEventListener('pointermove', onMove);
      document.removeEventListener('mouseleave', onLeave);
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, []);

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

  // Быстрый поиск без лагов, с кэшированием и отменой устаревших запросов
  useEffect(() => {
    const trimmed = searchQuery.trim();
    setRenderLimit(INITIAL_RENDER_LIMIT);

    if (!trimmed) {
      setIsSearchingApi(false);
      startTransition(() => {
        setSearchResults([]);
      });
      return;
    }

    const cacheKey = trimmed.toLowerCase();
    const cached = searchCacheRef.current.get(cacheKey);
    if (cached) {
      setIsSearchingApi(false);
      startTransition(() => {
        setSearchResults(cached);
      });
      return;
    }

    let cancelled = false;
    setIsSearchingApi(true);

    const runSearch = async () => {
      try {
        const found = await tauriApi.searchOnlineTracks(trimmed);
        if (cancelled) return;

        searchCacheRef.current.set(cacheKey, found);
        if (searchCacheRef.current.size > 30) {
          const firstKey = searchCacheRef.current.keys().next().value;
          if (firstKey !== undefined) searchCacheRef.current.delete(firstKey);
        }

        startTransition(() => {
          setSearchResults(found);
        });
      } catch (err) {
        if (!cancelled) {
          console.error('Ошибка онлайн-поиска:', err);
        }
      } finally {
        if (!cancelled) {
          setIsSearchingApi(false);
        }
      }
    };

    runSearch();

    return () => {
      cancelled = true;
    };
  }, [searchQuery]);

  // Запуск выбранного трека
  const handleSelectTrack = useCallback(
    async (track: TrackItem, customQueue?: TrackItem[]) => {
      isTransitioningRef.current = true;
      try {
        if (customQueue) {
          setQueue(customQueue);
        }
        setCurrentTrack(track);
        setPlaybackStatus((prev) => ({
          ...prev,
          isPlaying: true,
          positionSec: 0,
          isFinished: false,
        }));
        await tauriApi.playTrack(track.id, track.audioUrl);
      } catch (err) {
        console.error('Ошибка воспроизведения:', err);
        setPlaybackStatus((prev) => ({ ...prev, isPlaying: false }));
      } finally {
        setTimeout(() => {
          isTransitioningRef.current = false;
        }, 300);
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
      if (isTransitioningRef.current) return;
      try {
        const status = await tauriApi.getPlaybackStatus();
        if (isTransitioningRef.current) return;
        setPlaybackStatus(status);
        if (status.isFinished && status.positionSec > 1) {
          await handleNextTrack();
        }
      } catch (err) {
        console.error('Ошибка статуса плеера:', err);
      }
    }, 500);

    return () => clearInterval(interval);
  }, [currentTrack, handleNextTrack]);

  // Запуск потока «Моей волны»
  const handleStartWave = useCallback(
    async (overrideSettings?: WaveSettings) => {
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
    },
    [waveSettings, handleSelectTrack]
  );

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

  const handleTogglePlay = useCallback(async () => {
    if (!currentTrack) {
      const fallbackList = onlineTracks.length > 0 ? onlineTracks : tracks;
      if (fallbackList.length > 0) {
        await handleSelectTrack(fallbackList[0], fallbackList);
      } else {
        await handleStartWave();
      }
      return;
    }

    if (playbackStatus.isFinished) {
      await handleSelectTrack(currentTrack);
      return;
    }

    isTransitioningRef.current = true;
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
    } finally {
      setTimeout(() => {
        isTransitioningRef.current = false;
      }, 250);
    }
  }, [
    currentTrack,
    onlineTracks,
    tracks,
    playbackStatus.isPlaying,
    playbackStatus.isFinished,
    handleSelectTrack,
    handleStartWave,
  ]);

  const handleSeek = useCallback(async (seconds: number) => {
    isTransitioningRef.current = true;
    try {
      await tauriApi.seekTrack(seconds);
      setPlaybackStatus((prev) => ({ ...prev, positionSec: seconds }));
    } catch (err) {
      console.error('Ошибка перемотки:', err);
    } finally {
      setTimeout(() => {
        isTransitioningRef.current = false;
      }, 250);
    }
  }, []);

  const handleVolumeChange = useCallback(async (volume: number) => {
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
  }, []);

  const handleToggleMute = useCallback(async () => {
    try {
      const isMuted = await tauriApi.toggleMute();
      setPlaybackStatus((prev) => ({ ...prev, isMuted }));
    } catch (err) {
      console.error('Ошибка mute:', err);
    }
  }, []);

  // Мгновенный лайк для локальных и онлайн-треков
  const handleToggleFavorite = useCallback(async (trackId: string) => {
    const target = allTracksRef.current.find((t) => t.id === trackId);
    const nextFav = target ? !target.isFavorite : true;

    const updateList = (list: TrackItem[]) =>
      list.map((t) => (t.id === trackId ? { ...t, isFavorite: nextFav } : t));

    setTracks(updateList);
    setOnlineTracks(updateList);
    setSearchResults(updateList);
    setCurrentTrack((prev) =>
      prev && prev.id === trackId ? { ...prev, isFavorite: nextFav } : prev
    );

    searchCacheRef.current.forEach((cachedList, key) => {
      searchCacheRef.current.set(key, updateList(cachedList));
    });

    setSavedOnlineFavs((prev) => {
      const filtered = prev.filter((t) => t.id !== trackId);
      const updated =
        nextFav && target ? [{ ...target, isFavorite: true }, ...filtered] : filtered;
      try {
        localStorage.setItem('abyss-online-favs', JSON.stringify(updated));
      } catch {}
      return updated;
    });

    try {
      await tauriApi.toggleFavorite(trackId);
    } catch {
      // Онлайн-трек может отсутствовать в SQLite — локальное состояние уже обновлено
    }
  }, []);

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

  // Глобальные горячие клавиши
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      const isTyping = tag === 'INPUT' || tag === 'TEXTAREA';

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setIsCmdOpen((v) => !v);
        return;
      }

      if (e.key === 'Escape') {
        setIsCmdOpen(false);
        setIsNowPlayingOpen(false);
        setIsWaveModalOpen(false);
        setIsThemeModalOpen(false);
        return;
      }

      if (isTyping) return;

      if (e.code === 'Space') {
        e.preventDefault();
        handleTogglePlay();
      } else if (e.key === 'ArrowRight' && currentTrack) {
        handleSeek(
          Math.min(currentTrack.durationSeconds ?? 0, playbackStatus.positionSec + 5)
        );
      } else if (e.key === 'ArrowLeft' && currentTrack) {
        handleSeek(Math.max(0, playbackStatus.positionSec - 5));
      } else if (e.key.toLowerCase() === 'm') {
        handleToggleMute();
      } else if (e.key.toLowerCase() === 'l' && currentTrack) {
        handleToggleFavorite(currentTrack.id);
      } else if (e.key.toLowerCase() === 'f' && currentTrack) {
        setIsNowPlayingOpen((v) => !v);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    currentTrack,
    playbackStatus.positionSec,
    handleTogglePlay,
    handleSeek,
    handleToggleMute,
    handleToggleFavorite,
  ]);

  const allAvailableTracks = useMemo(() => {
    const favIds = new Set(savedOnlineFavs.map((t) => t.id));
    const map = new Map<string, TrackItem>();

    tracks.forEach((t) =>
      map.set(t.id, favIds.has(t.id) ? { ...t, isFavorite: true } : t)
    );
    onlineTracks.forEach((t) => {
      if (!map.has(t.id)) {
        map.set(t.id, favIds.has(t.id) ? { ...t, isFavorite: true } : t);
      }
    });
    searchResults.forEach((t) => {
      if (!map.has(t.id)) {
        map.set(t.id, favIds.has(t.id) ? { ...t, isFavorite: true } : t);
      }
    });
    savedOnlineFavs.forEach((t) => {
      if (!map.has(t.id)) {
        map.set(t.id, { ...t, isFavorite: true });
      }
    });

    return Array.from(map.values());
  }, [tracks, onlineTracks, searchResults, savedOnlineFavs]);

  useEffect(() => {
    allTracksRef.current = allAvailableTracks;
  }, [allAvailableTracks]);

  const isSearching = searchQuery.trim().length > 0;

  const displayedTracks = useMemo(() => {
    const favIds = new Set(savedOnlineFavs.map((t) => t.id));
    const applyFav = (t: TrackItem) =>
      favIds.has(t.id) ? { ...t, isFavorite: true } : t;

    if (isSearching) {
      const q = searchQuery.trim().toLowerCase();
      const map = new Map<string, TrackItem>();

      tracks.forEach((t) => {
        if (
          t.title.toLowerCase().includes(q) ||
          t.artist.toLowerCase().includes(q) ||
          t.album.toLowerCase().includes(q)
        ) {
          map.set(t.id, applyFav(t));
        }
      });

      searchResults.forEach((t) => {
        if (!map.has(t.id)) map.set(t.id, applyFav(t));
      });

      return Array.from(map.values());
    }

    if (activeTab === 'favorites') {
      return allAvailableTracks.filter((t) => t.isFavorite);
    }

    if (activeTab === 'playlist' && activePlaylistId) {
      const pl = playlists.find((p) => p.id === activePlaylistId);
      if (!pl) return [];
      return allAvailableTracks.filter((t) => pl.trackIds.includes(t.id));
    }

    return (onlineTracks.length > 0 ? onlineTracks : tracks).map(applyFav);
  }, [
    savedOnlineFavs,
    isSearching,
    searchQuery,
    tracks,
    searchResults,
    activeTab,
    activePlaylistId,
    playlists,
    allAvailableTracks,
    onlineTracks,
  ]);

  const visibleTracks = useMemo(
    () => displayedTracks.slice(0, renderLimit),
    [displayedTracks, renderLimit]
  );

  const activeWaveTags = [
    waveSettings.mood,
    waveSettings.activity,
    waveSettings.character,
    waveSettings.genre,
  ].filter(Boolean) as string[];

  const activePlaylist = playlists.find((p) => p.id === activePlaylistId) || null;
  const activeQueue = queue.length > 0 ? queue : displayedTracks;
  const viewKey = isSearching ? 'search-view' : `${activeTab}-${activePlaylistId ?? 'root'}`;

  const syncedCurrentTrack = useMemo(() => {
    if (!currentTrack) return null;
    const isFav =
      currentTrack.isFavorite ||
      savedOnlineFavs.some((t) => t.id === currentTrack.id);
    return isFav === currentTrack.isFavorite
      ? currentTrack
      : { ...currentTrack, isFavorite: isFav };
  }, [currentTrack, savedOnlineFavs]);

  return (
    <div className="app-shell">
      <div
        ref={bloomRef}
        className="cursor-bloom"
        aria-hidden="true"
        style={{
          position: 'fixed',
          left: 0,
          top: 0,
          width: 140,
          height: 140,
          marginLeft: -70,
          marginTop: -70,
          zIndex: 40,
          pointerEvents: 'none',
        }}
      />

      {syncedCurrentTrack?.coverUrl && (
        <div
          className="ambient-cover-glow"
          style={{ backgroundImage: `url(${syncedCurrentTrack.coverUrl})` }}
          aria-hidden="true"
        />
      )}

      <Sidebar
        activeTab={activeTab}
        activePlaylistId={activePlaylistId}
        playlists={playlists}
        onSelectTab={(tab) => {
          setSearchQuery('');
          setActiveTab(tab);
          if (tab !== 'playlist') {
            setActivePlaylistId(null);
          }
        }}
        onSelectPlaylist={(playlistId) => {
          setSearchQuery('');
          setActivePlaylistId(playlistId);
          setActiveTab('playlist');
        }}
        onCreatePlaylist={handleCreatePlaylist}
        onScanFolder={handlePickAndScanFolder}
        onOpenThemes={() => setIsThemeModalOpen(true)}
      />

      <main className="main-workspace">
        <TopSearchBar externalValue={searchQuery} onSearchCommit={setSearchQuery} />

        <div key={viewKey} className="view-transition">
          {isSearching ? (
            <div>
              <div className="section-header-row" style={{ marginTop: 4 }}>
                <h2 className="section-heading shimmer-text">
                  Результаты: «{searchQuery.trim()}»
                  {isSearchingApi && (
                    <span
                      className="track-artist"
                      style={{ marginLeft: 12, fontWeight: 500 }}
                    >
                      обновляем...
                    </span>
                  )}
                </h2>
              </div>

              {visibleTracks.length > 0 ? (
                <div
                  style={{
                    opacity: isSearchingApi ? 0.65 : 1,
                    transition: 'opacity 0.2s ease',
                  }}
                >
                  <TrackList
                    tracks={visibleTracks}
                    currentTrackId={syncedCurrentTrack?.id ?? null}
                    isPlaying={playbackStatus.isPlaying}
                    onSelectTrack={(track) => handleSelectTrack(track, displayedTracks)}
                    onToggleFavorite={handleToggleFavorite}
                  />
                  {displayedTracks.length > renderLimit && (
                    <div style={{ display: 'flex', justifyContent: 'center', marginTop: 20 }}>
                      <button
                        type="button"
                        className="wave-settings-btn"
                        onClick={() => setRenderLimit((l) => l + 40)}
                      >
                        Показать ещё ({displayedTracks.length - renderLimit})
                      </button>
                    </div>
                  )}
                </div>
              ) : isSearchingApi ? (
                <div style={{ marginTop: 20 }} className="empty-box">
                  <Search size={32} className="pulse-icon" />
                  <div className="track-name" style={{ fontSize: 16 }}>
                    Ищем треки в сети...
                  </div>
                </div>
              ) : (
                <div style={{ marginTop: 20 }} className="empty-box">
                  <Search size={32} />
                  <div className="track-name" style={{ fontSize: 16 }}>
                    Ничего не найдено
                  </div>
                  <p className="track-artist" style={{ maxWidth: 380 }}>
                    Попробуй другой запрос или проверь локальную медиатеку
                  </p>
                </div>
              )}
            </div>
          ) : activeTab === 'home' ? (
            <>
              <section className="wave-hero">
                <svg className="wave-hero-bg-lines" viewBox="0 0 340 240" fill="none">
                  <path
                    d="M-20 190 C 80 110, 170 250, 360 120"
                    stroke="rgba(255,255,255,0.09)"
                    strokeWidth="1.5"
                  />
                  <path
                    d="M-20 140 C 110 60, 210 210, 360 70"
                    stroke="rgba(255,255,255,0.05)"
                    strokeWidth="1.5"
                  />
                </svg>

                <div className="wave-hero-content">
                  <h1 className="wave-hero-title shimmer-text">Моя волна</h1>
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
                    <h2 className="section-heading shimmer-text">Недавно добавлено</h2>
                  </div>
                  <div className="recent-grid">
                    {displayedTracks.slice(0, 6).map((track, idx) => {
                      const isCurrent = syncedCurrentTrack?.id === track.id;
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
                              loading="lazy"
                              decoding="async"
                            />
                          ) : (
                            <div className="recent-thumb">
                              <Music size={18} />
                            </div>
                          )}
                          <div className="recent-card-text">
                            <span className="recent-card-title shimmer-text">
                              {track.title}
                            </span>
                            <span className="recent-card-artist">{track.artist}</span>
                          </div>
                        </button>
                      );
                    })}
                  </div>

                  <div className="section-header-row">
                    <h2 className="section-heading shimmer-text">
                      {onlineTracks.length > 0
                        ? `Поток «Моей волны» (${displayedTracks.length})`
                        : `Коллекция треков (${tracks.length})`}
                    </h2>
                  </div>
                  <TrackList
                    tracks={visibleTracks}
                    currentTrackId={syncedCurrentTrack?.id ?? null}
                    isPlaying={playbackStatus.isPlaying}
                    onSelectTrack={(track) => handleSelectTrack(track, displayedTracks)}
                    onToggleFavorite={handleToggleFavorite}
                  />
                  {displayedTracks.length > renderLimit && (
                    <div style={{ display: 'flex', justifyContent: 'center', marginTop: 20 }}>
                      <button
                        type="button"
                        className="wave-settings-btn"
                        onClick={() => setRenderLimit((l) => l + 40)}
                      >
                        Показать ещё ({displayedTracks.length - renderLimit})
                      </button>
                    </div>
                  )}
                </>
              )}
            </>
          ) : activeTab === 'favorites' ? (
            <div>
              <div className="collection-banner">
                <div className="collection-big-cover">
                  <Heart size={42} />
                </div>
                <div>
                  <div className="collection-banner-label">Плейлист</div>
                  <h1 className="collection-banner-title shimmer-text">Мне нравится</h1>
                  <p className="collection-banner-meta">
                    Треков: {displayedTracks.length}
                  </p>
                </div>
              </div>

              {visibleTracks.length > 0 ? (
                <TrackList
                  tracks={visibleTracks}
                  currentTrackId={syncedCurrentTrack?.id ?? null}
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
          ) : activeTab === 'playlist' && activePlaylist ? (
            <div>
              <div className="collection-banner">
                <div className="collection-big-cover">
                  <Music size={42} />
                </div>
                <div>
                  <div className="collection-banner-label">Плейлист</div>
                  <h1 className="collection-banner-title shimmer-text">
                    {activePlaylist.name}
                  </h1>
                  <p className="collection-banner-meta">
                    Треков: {displayedTracks.length}
                  </p>
                </div>
              </div>

              {visibleTracks.length > 0 ? (
                <TrackList
                  tracks={visibleTracks}
                  currentTrackId={syncedCurrentTrack?.id ?? null}
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
          ) : null}
        </div>
      </main>

      {isQueueOpen && (
        <aside className="queue-drawer">
          <div className="queue-header">
            <span className="section-heading shimmer-text" style={{ fontSize: 17 }}>
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

          {syncedCurrentTrack && (
            <div className="queue-now-card">
              {syncedCurrentTrack.coverUrl ? (
                <img
                  src={syncedCurrentTrack.coverUrl}
                  alt={syncedCurrentTrack.title}
                  className="queue-big-art"
                />
              ) : (
                <div className="queue-big-art">
                  <Music size={36} />
                </div>
              )}
              <div className="track-name shimmer-text" style={{ fontSize: 16 }}>
                {syncedCurrentTrack.title}
              </div>
              <div className="track-artist">{syncedCurrentTrack.artist}</div>
            </div>
          )}

          <div className="modal-group-label" style={{ marginBottom: 10 }}>
            Далее в очереди ({activeQueue.length})
          </div>
          <div className="queue-scroll">
            {activeQueue.slice(0, 50).map((track) => {
              const isCurrent = syncedCurrentTrack?.id === track.id;
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
                      loading="lazy"
                      decoding="async"
                    />
                  ) : (
                    <div className="track-mini-cover">
                      <Music size={14} />
                    </div>
                  )}
                  <div className="recent-card-text">
                    <span className="track-name shimmer-text" style={{ fontSize: 13 }}>
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
        currentTrack={syncedCurrentTrack}
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
        onToggleFavorite={handleToggleFavorite}
        onOpenNowPlaying={() => syncedCurrentTrack && setIsNowPlayingOpen(true)}
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

      <ThemeModal
        isOpen={isThemeModalOpen}
        currentThemeId={currentThemeId}
        onSelectTheme={(theme: ThemePreset) => setCurrentThemeId(theme.id)}
        onClose={() => setIsThemeModalOpen(false)}
      />

      <NowPlayingOverlay
        isOpen={isNowPlayingOpen}
        track={syncedCurrentTrack}
        isPlaying={playbackStatus.isPlaying}
        positionSec={playbackStatus.positionSec}
        onClose={() => setIsNowPlayingOpen(false)}
        onTogglePlay={handleTogglePlay}
        onPrev={handlePrevTrack}
        onNext={handleNextTrack}
        onSeek={handleSeek}
        onToggleFavorite={handleToggleFavorite}
      />

      <CommandPalette
        isOpen={isCmdOpen}
        tracks={allAvailableTracks}
        onClose={() => setIsCmdOpen(false)}
        onSelectTrack={(track) => handleSelectTrack(track, allAvailableTracks)}
        onStartWave={() => handleStartWave()}
        onNavigate={(tab) => {
          setSearchQuery('');
          setActiveTab(tab);
        }}
      />
    </div>
  );
};

export default App;