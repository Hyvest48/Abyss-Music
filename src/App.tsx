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
  LogIn,
  SkipForward,
  X,
  Disc3,
  History,
  Flame,
  ArrowUp,
  Plus,
  Pencil,
  Trash2,
} from 'lucide-react';
import { getCoverGradient, resolveCoverSrc } from './shared/models';
import { Sidebar, MobileTopBar, MobileBottomNav, NavTab } from './components/sidebar';
import { WaveModal } from './components/wave_modal';
import { TrackList } from './components/track_list';
import { PlayerBar } from './components/player_bar';
import { NowPlayingOverlay } from './components/now_playing_overlay';
import { CommandPalette } from './components/command_palette';
import { ThemeModal } from './components/theme_modal';
import { SeasonalEffects } from './components/seasonal_effects';
import { EqualizerModal } from './components/equalizer_modal';
import { ArtistView } from './components/artist_view';
import { ArtistLinks } from './components/artist_links';
import { SplashScreen } from './components/splash_screen';
import { PlaylistPickerModal } from './components/playlist_picker_modal';
import { THEME_PRESETS, ThemePreset } from './shared/themes';
import {
  PlaybackStatus,
  PlaylistItem,
  TrackItem,
  WaveSettings,
} from './shared/models';
import {
  FrontendSyncPrefs,
  SearchArtistItem,
  SyncImportSummary,
  tauriApi,
  YandexAuthStatus,
  YandexSearchResult,
} from './services/tauri_api';

interface TopSearchBarProps {
  externalValue: string;
  onSearchCommit: (value: string) => void;
  isMobileUI?: boolean;
  focusTrigger?: number;
}

const TopSearchBar: React.FC<TopSearchBarProps> = React.memo(
  ({ externalValue, onSearchCommit, isMobileUI = false, focusTrigger = 0 }) => {
    const [localValue, setLocalValue] = useState(externalValue);
    const lastCommittedRef = useRef(externalValue);
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
      if (focusTrigger > 0) {
        inputRef.current?.focus();
      }
    }, [focusTrigger]);

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
            ref={inputRef}
            type="text"
            className="search-input"
            placeholder={
              isMobileUI
                ? 'Треки, артисты, альбомы...'
                : 'Поиск треков в Яндекс Музыке и локальной медиатеке...'
            }
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
          ) : !isMobileUI ? (
            <kbd className="search-kbd">Ctrl K</kbd>
          ) : null}
        </div>
      </header>
    );
  }
);

const INITIAL_RENDER_LIMIT = 40;

function detectMobileUI(): boolean {
  if (typeof window === 'undefined') return false;
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  return /Android|iPhone|iPad|iPod|Mobile/i.test(ua) || window.innerWidth <= 900;
}

export const App: React.FC = () => {
  const [isMobileUI, setIsMobileUI] = useState<boolean>(() => detectMobileUI());
  const [searchFocusTrigger, setSearchFocusTrigger] = useState(0);
  const [showNewPlaylistForm, setShowNewPlaylistForm] = useState(false);
  const [newPlaylistName, setNewPlaylistName] = useState('');
  const [editingLibId, setEditingLibId] = useState<string | null>(null);
  const [editingLibName, setEditingLibName] = useState('');

  useEffect(() => {
    const onResize = () => setIsMobileUI(detectMobileUI());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const [activeTab, setActiveTab] = useState<NavTab>('home');
  const [activePlaylistId, setActivePlaylistId] = useState<string | null>(null);
  const [tracks, setTracks] = useState<TrackItem[]>([]);
  const [waveBuffer, setWaveBuffer] = useState<TrackItem[]>([]);
  const [isWaveActive, setIsWaveActive] = useState(false);
  const [searchResults, setSearchResults] = useState<TrackItem[]>([]);
  const [searchArtists, setSearchArtists] = useState<SearchArtistItem[]>([]);
  const [playlists, setPlaylists] = useState<PlaylistItem[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoadingStream, setIsLoadingStream] = useState(false);
  const [isSearchingApi, setIsSearchingApi] = useState(false);
  const [isAppReady, setIsAppReady] = useState(false);
  const [splashStatus, setSplashStatus] = useState('Инициализация аудиодвижка...');
  const [renderLimit, setRenderLimit] = useState(INITIAL_RENDER_LIMIT);

  const [yandexAuth, setYandexAuth] = useState<YandexAuthStatus>({
    isAuthorized: false,
    accountName: null,
  });

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
    language: null,
  });
  const [isWaveModalOpen, setIsWaveModalOpen] = useState(false);

  const [isNowPlayingOpen, setIsNowPlayingOpen] = useState(false);
  const [selectedEntity, setSelectedEntity] = useState<{
    type: 'artist' | 'album';
    name: string;
    id?: string;
  } | null>(null);
  const [isEqOpen, setIsEqOpen] = useState(false);
  const [isCmdOpen, setIsCmdOpen] = useState(false);
  const [isWidgetOpen, setIsWidgetOpen] = useState(false);

  const [isThemeModalOpen, setIsThemeModalOpen] = useState(false);
  const [isNightMode, setIsNightMode] = useState<boolean>(() => {
    try {
      return localStorage.getItem('abyss-night-mode') === 'true';
    } catch {
      return false;
    }
  });
  const [currentThemeId, setCurrentThemeId] = useState<string>(() => {
    try {
      return localStorage.getItem('abyss-theme') || 'abyss-violet';
    } catch {
      return 'abyss-violet';
    }
  });

  const [currentTrack, setCurrentTrack] = useState<TrackItem | null>(null);
  const [queue, setQueue] = useState<TrackItem[]>([]);
  const [recentTracks, setRecentTracks] = useState<TrackItem[]>([]);
  const [topTracks, setTopTracks] = useState<TrackItem[]>([]);
  const [activePlaylistTracks, setActivePlaylistTracks] = useState<TrackItem[] | null>(null);
  const [pickerTrack, setPickerTrack] = useState<TrackItem | null>(null);
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
  const hasLoadedAudioRef = useRef(false);
  const restoredSeekSecRef = useRef(0);
  const queueLoadedRef = useRef(false);
  const playSeqRef = useRef(0);
  const transitionTimerRef = useRef<number | null>(null);
  const waveFetchPromiseRef = useRef<Promise<TrackItem[]> | null>(null);
  const waveStartSeqRef = useRef(0);
  const playedWaveIdsRef = useRef<Set<string>>(new Set());
  const bloomRef = useRef<HTMLDivElement>(null);
  const workspaceRef = useRef<HTMLElement>(null);
  const [showScrollTop, setShowScrollTop] = useState(false);
  const searchCacheRef = useRef(new Map<string, YandexSearchResult>());
  const allTracksRef = useRef<TrackItem[]>([]);

  useEffect(() => {
    const theme =
      THEME_PRESETS.find((t) => t.id === currentThemeId) || THEME_PRESETS[0];
    const root = document.documentElement;
    root.style.setProperty('--accent-warm', theme.accent);
    root.style.setProperty('--accent-secondary', theme.accent2);
    root.style.setProperty('--accent-glow', theme.glow);
    root.style.setProperty('--bg-base', theme.bgBase);
    root.style.setProperty('--sidebar-top', theme.sidebarTop);
    try {
      localStorage.setItem('abyss-theme', theme.id);
    } catch {}
  }, [currentThemeId]);

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

  const refreshHistoryStats = useCallback(async () => {
    try {
      const [recent, top] = await Promise.all([
        tauriApi.getRecentTracks(12),
        tauriApi.getTopTracks(12),
      ]);
      setRecentTracks(recent);
      setTopTracks(top);
    } catch {}
  }, []);

  useEffect(() => {
    let unlistenAuth: (() => void) | null = null;
    let disposed = false;

    const initData = async () => {
      try {
        setSplashStatus('Загрузка медиатеки и профиля...');
        const [savedTracks, savedPlaylists, ymStatus, recent, top, savedQueue] =
          await Promise.all([
            tauriApi.getTracks(),
            tauriApi.getPlaylists(),
            tauriApi.getYandexStatus(),
            tauriApi.getRecentTracks(12).catch(() => [] as TrackItem[]),
            tauriApi.getTopTracks(12).catch(() => [] as TrackItem[]),
            tauriApi.loadQueueState().catch(() => null),
          ]);
        if (disposed) return;
        setTracks(savedTracks);
        setPlaylists(savedPlaylists);
        setYandexAuth(ymStatus);
        setRecentTracks(recent);
        setTopTracks(top);

        if (savedQueue) {
          const restoredQueue =
            savedQueue.queueTracks && savedQueue.queueTracks.length > 0
              ? savedQueue.queueTracks
              : savedQueue.trackIds
                  .map((id) => savedTracks.find((t) => t.id === id))
                  .filter((t): t is TrackItem => Boolean(t));
          if (restoredQueue.length > 0) {
            setQueue(restoredQueue);
          }
          const restoredCurrent = savedQueue.currentTrackId
            ? restoredQueue.find((t) => t.id === savedQueue.currentTrackId) ||
              savedTracks.find((t) => t.id === savedQueue.currentTrackId) ||
              null
            : null;
          if (restoredCurrent) {
            hasLoadedAudioRef.current = false;
            restoredSeekSecRef.current = savedQueue.positionSec || 0;
            setCurrentTrack(restoredCurrent);
            setPlaybackStatus((prev) => ({
              ...prev,
              isPlaying: false,
              positionSec: savedQueue.positionSec || 0,
            }));
          }
        }
        queueLoadedRef.current = true;

        setSplashStatus(
          ymStatus.isAuthorized
            ? `Добро пожаловать, ${ymStatus.accountName || 'слушатель'}`
            : 'Готово к запуску'
        );

        const fn = await tauriApi.onYandexAuthSuccess((status) => {
          setYandexAuth(status);
          searchCacheRef.current.clear();
        });
        if (disposed) {
          fn();
          return;
        }
        unlistenAuth = fn;
      } catch (err) {
        console.error('Ошибка инициализации данных:', err);
        setSplashStatus('Готово');
        queueLoadedRef.current = true;
      } finally {
        if (!disposed) setIsAppReady(true);
      }
    };

    void initData();
    return () => {
      disposed = true;
      if (unlistenAuth) unlistenAuth();
    };
  }, []);

  useEffect(() => {
    const trimmed = searchQuery.trim();
    setRenderLimit(INITIAL_RENDER_LIMIT);

    if (!trimmed) {
      setIsSearchingApi(false);
      startTransition(() => {
        setSearchResults([]);
        setSearchArtists([]);
      });
      return;
    }

    if (!yandexAuth.isAuthorized) {
      setIsSearchingApi(false);
      setSearchResults([]);
      setSearchArtists([]);
      return;
    }

    const cacheKey = trimmed.toLowerCase();
    const cached = searchCacheRef.current.get(cacheKey);
    if (cached) {
      setIsSearchingApi(false);
      startTransition(() => {
        setSearchResults(cached.tracks);
        setSearchArtists(cached.artists);
      });
      return;
    }

    let cancelled = false;
    setIsSearchingApi(true);

    const runSearch = async () => {
      try {
        const found = await tauriApi.searchYandexAll(trimmed);
        if (cancelled) return;

        searchCacheRef.current.set(cacheKey, found);
        if (searchCacheRef.current.size > 30) {
          const firstKey = searchCacheRef.current.keys().next().value;
          if (firstKey !== undefined) searchCacheRef.current.delete(firstKey);
        }

        startTransition(() => {
          setSearchResults(found.tracks);
          setSearchArtists(found.artists);
        });
      } catch (err) {
        if (!cancelled) {
          console.error('Ошибка поиска Яндекс Музыки:', err);
        }
      } finally {
        if (!cancelled) {
          setIsSearchingApi(false);
        }
      }
    };

    void runSearch();

    return () => {
      cancelled = true;
    };
  }, [searchQuery, yandexAuth.isAuthorized]);

  const fetchNextWaveBatch = useCallback(
    async (anchorTrackId: string, activeSettings: WaveSettings): Promise<TrackItem[]> => {
      if (waveFetchPromiseRef.current) {
        return waveFetchPromiseRef.current;
      }
      const promise = (async () => {
        try {
          const rawBatch = await tauriApi.getYandexWave(activeSettings, anchorTrackId);
          const fresh = rawBatch.filter((t) => !playedWaveIdsRef.current.has(t.id));
          const usable = fresh.length > 0 ? fresh : rawBatch;

          if (usable.length > 0) {
            setWaveBuffer((prev) => {
              const existingIds = new Set(prev.map((x) => x.id));
              const uniqueNew = usable.filter((x) => !existingIds.has(x.id));
              return [...prev, ...uniqueNew];
            });
          }
          return usable;
        } catch (err) {
          console.error('Ошибка дозагрузки Моей волны:', err);
          return [];
        } finally {
          waveFetchPromiseRef.current = null;
        }
      })();
      waveFetchPromiseRef.current = promise;
      return promise;
    },
    []
  );

  const scheduleTransitionEnd = useCallback((seq: number) => {
    if (transitionTimerRef.current !== null) {
      window.clearTimeout(transitionTimerRef.current);
    }
    transitionTimerRef.current = window.setTimeout(() => {
      if (seq === playSeqRef.current) {
        isTransitioningRef.current = false;
      }
      transitionTimerRef.current = null;
    }, 300);
  }, []);

  const handleSelectTrack = useCallback(
    async (
      track: TrackItem,
      customQueue?: TrackItem[],
      fromWave = false,
      seekToSec = 0
    ) => {
      const seq = ++playSeqRef.current;
      isTransitioningRef.current = true;
      hasLoadedAudioRef.current = true;
      restoredSeekSecRef.current = 0;
      try {
        setIsWaveActive(fromWave);
        if (fromWave) {
          playedWaveIdsRef.current.add(track.id);
          if (playedWaveIdsRef.current.size > 150) {
            const first = playedWaveIdsRef.current.values().next().value;
            if (first) playedWaveIdsRef.current.delete(first);
          }
          void tauriApi.sendWaveFeedback(waveSettings.genre, 'trackStarted', track.id);
        } else if (customQueue) {
          setQueue(customQueue);
        }

        setCurrentTrack(track);
        setPlaybackStatus((prev) => ({
          ...prev,
          isPlaying: true,
          positionSec: seekToSec,
          isFinished: false,
        }));
        void tauriApi.updateMediaMetadata(track);
        await tauriApi.playTrack(track.id, track.audioUrl, track);
        if (seekToSec > 0 && seq === playSeqRef.current) {
          await tauriApi.seekTrack(seekToSec);
        }
        void refreshHistoryStats();
      } catch (err) {
        console.error('Ошибка воспроизведения:', err);
        if (seq === playSeqRef.current) {
          setPlaybackStatus((prev) => ({ ...prev, isPlaying: false }));
        }
      } finally {
        if (seq === playSeqRef.current) {
          scheduleTransitionEnd(seq);
        }
      }
    },
    [waveSettings.genre, scheduleTransitionEnd, refreshHistoryStats]
  );

  const handleNextTrack = useCallback(
    async (naturalFinish = false) => {
      if (isWaveActive) {
        if (currentTrack) {
          void tauriApi.sendWaveFeedback(
            waveSettings.genre,
            naturalFinish ? 'trackFinished' : 'skip',
            currentTrack.id,
            playbackStatus.positionSec
          );
        }

        if (naturalFinish && isRepeat && currentTrack) {
          await handleSelectTrack(currentTrack, undefined, true);
          return;
        }

        const currentIdx = currentTrack
          ? waveBuffer.findIndex((t) => t.id === currentTrack.id)
          : -1;
        const remaining = waveBuffer.slice(currentIdx + 1);

        if (remaining.length <= 1 && currentTrack) {
          const fetched = await fetchNextWaveBatch(currentTrack.id, waveSettings);
          if (remaining.length === 0 && fetched.length > 0) {
            await handleSelectTrack(fetched[0], undefined, true);
            return;
          }
        }

        if (remaining.length > 0) {
          await handleSelectTrack(remaining[0], undefined, true);
        }
        return;
      }

      const activeList = queue.length > 0 ? queue : tracks;
      if (activeList.length === 0) return;

      if (naturalFinish && isRepeat && currentTrack) {
        await handleSelectTrack(currentTrack, activeList, false);
        return;
      }

      const currentIndex = currentTrack
        ? activeList.findIndex((t) => t.id === currentTrack.id)
        : -1;

      if (isShuffle) {
        let randomIndex = Math.floor(Math.random() * activeList.length);
        if (activeList.length > 1 && randomIndex === currentIndex) {
          randomIndex = (randomIndex + 1 + Math.floor(Math.random() * (activeList.length - 1))) % activeList.length;
        }
        await handleSelectTrack(activeList[randomIndex], activeList, false);
        return;
      }

      const nextIndex = currentIndex + 1;

      if (nextIndex < activeList.length) {
        await handleSelectTrack(activeList[nextIndex], activeList, false);
      } else {
        setPlaybackStatus((prev) => ({ ...prev, isPlaying: false }));
      }
    },
    [
      isWaveActive,
      currentTrack,
      waveSettings,
      playbackStatus.positionSec,
      isRepeat,
      waveBuffer,
      fetchNextWaveBatch,
      handleSelectTrack,
      queue,
      tracks,
      isShuffle,
    ]
  );

  const handlePrevTrack = useCallback(async () => {
    if (playbackStatus.positionSec > 3 && currentTrack) {
      const seq = ++playSeqRef.current;
      isTransitioningRef.current = true;
      try {
        await tauriApi.seekTrack(0);
        if (seq === playSeqRef.current) {
          setPlaybackStatus((prev) => ({ ...prev, positionSec: 0 }));
        }
      } catch (err) {
        console.error('Ошибка перемотки в начало:', err);
      } finally {
        if (seq === playSeqRef.current) {
          scheduleTransitionEnd(seq);
        }
      }
      return;
    }

    const activeList = isWaveActive
      ? waveBuffer
      : queue.length > 0
      ? queue
      : tracks;
    if (activeList.length === 0) return;

    const currentIndex = currentTrack
      ? activeList.findIndex((t) => t.id === currentTrack.id)
      : 0;
    const prevIndex = currentIndex > 0 ? currentIndex - 1 : activeList.length - 1;
    await handleSelectTrack(activeList[prevIndex], activeList, isWaveActive);
  }, [
    playbackStatus.positionSec,
    currentTrack,
    isWaveActive,
    waveBuffer,
    queue,
    tracks,
    handleSelectTrack,
    scheduleTransitionEnd,
  ]);

  useEffect(() => {
    if (!currentTrack) return;
    let cancelled = false;
    let timerId: number | null = null;

    const poll = async () => {
      if (cancelled) return;
      if (!isTransitioningRef.current) {
        try {
          const status = await tauriApi.getPlaybackStatus();
          if (cancelled || isTransitioningRef.current) return;
          setPlaybackStatus(status);
          void tauriApi.updateMediaPlayback(status.isPlaying, status.positionSec);
          if (status.isFinished && status.positionSec > 1) {
            isTransitioningRef.current = true;
            await handleNextTrack(true);
          }
        } catch (err) {
          console.error('Ошибка статуса плеера:', err);
        }
      }
      if (!cancelled) {
        timerId = window.setTimeout(poll, 500);
      }
    };

    timerId = window.setTimeout(poll, 500);

    return () => {
      cancelled = true;
      if (timerId !== null) window.clearTimeout(timerId);
    };
  }, [currentTrack, handleNextTrack]);

  const handleStartWave = useCallback(
    async (overrideSettings?: WaveSettings) => {
      if (!yandexAuth.isAuthorized) {
        await tauriApi.openYandexAuth();
        return;
      }

      const seq = ++waveStartSeqRef.current;
      const activeSettings = overrideSettings ?? waveSettings;
      setIsLoadingStream(true);
      try {
        const freshBatch = await tauriApi.getYandexWave(activeSettings, null);
        if (seq !== waveStartSeqRef.current) return;
        if (freshBatch.length > 0) {
          const unseen = freshBatch.filter((t) => !playedWaveIdsRef.current.has(t.id));
          const ordered =
            unseen.length > 0
              ? [...unseen, ...freshBatch.filter((t) => playedWaveIdsRef.current.has(t.id))]
              : freshBatch;

          setWaveBuffer(ordered);
          await handleSelectTrack(ordered[0], undefined, true);
        }
      } catch (err) {
        console.error('Ошибка запуска Моей волны Яндекса:', err);
      } finally {
        if (seq === waveStartSeqRef.current) {
          setIsLoadingStream(false);
        }
      }
    },
    [yandexAuth.isAuthorized, waveSettings, handleSelectTrack]
  );

  useEffect(() => {
    if (!isWaveActive || !currentTrack) return;
    const idx = waveBuffer.findIndex((t) => t.id === currentTrack.id);
    if (idx !== -1 && waveBuffer.length - 1 - idx < 1) {
      void fetchNextWaveBatch(currentTrack.id, waveSettings);
    }
  }, [isWaveActive, currentTrack, waveBuffer, waveSettings, fetchNextWaveBatch]);

  // Фоново подгружаем следующий трек в кэш, чтобы переключение было мгновенным
  useEffect(() => {
    if (!currentTrack || !playbackStatus.isPlaying) return;
    const list = isWaveActive ? waveBuffer : queue.length > 0 ? queue : tracks;
    const idx = list.findIndex((t) => t.id === currentTrack.id);
    if (idx === -1 || idx + 1 >= list.length) return;
    const nextTrack = list[idx + 1];
    if (!nextTrack || nextTrack.sourceType === 'local') return;

    const timer = window.setTimeout(() => {
      void tauriApi.prefetchTrack(nextTrack.audioUrl).catch(() => {});
    }, 1200);
    return () => window.clearTimeout(timer);
  }, [currentTrack?.id, playbackStatus.isPlaying, isWaveActive, waveBuffer, queue, tracks]);

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

  const handleYandexLogin = async () => {
    try {
      await tauriApi.openYandexAuth();
    } catch (err) {
      console.error('Ошибка открытия авторизации Яндекса:', err);
    }
  };

  const handleYandexLogout = async () => {
    try {
      await tauriApi.logoutYandex();
      setYandexAuth({ isAuthorized: false, accountName: null });
      setWaveBuffer([]);
      setIsWaveActive(false);
      setSearchResults([]);
      playedWaveIdsRef.current.clear();
      searchCacheRef.current.clear();
    } catch (err) {
      console.error('Ошибка выхода из Яндекс ID:', err);
    }
  };

  const handleTogglePlay = useCallback(async () => {
    if (!currentTrack) {
      if (tracks.length > 0) {
        await handleSelectTrack(tracks[0], tracks, false);
      } else {
        await handleStartWave();
      }
      return;
    }

    if (!hasLoadedAudioRef.current || playbackStatus.isFinished) {
      const seekSec = !hasLoadedAudioRef.current ? restoredSeekSecRef.current : 0;
      await handleSelectTrack(
        currentTrack,
        queue.length > 0 ? queue : undefined,
        isWaveActive,
        seekSec
      );
      return;
    }

    const seq = ++playSeqRef.current;
    isTransitioningRef.current = true;
    try {
      if (playbackStatus.isPlaying) {
        await tauriApi.pauseTrack();
        if (seq === playSeqRef.current) {
          setPlaybackStatus((prev) => ({ ...prev, isPlaying: false }));
        }
      } else {
        await tauriApi.resumeTrack();
        if (seq === playSeqRef.current) {
          setPlaybackStatus((prev) => ({ ...prev, isPlaying: true }));
        }
      }
    } catch (err) {
      console.error('Ошибка паузы/старта:', err);
    } finally {
      if (seq === playSeqRef.current) {
        scheduleTransitionEnd(seq);
      }
    }
  }, [
    currentTrack,
    tracks,
    queue,
    playbackStatus.isPlaying,
    playbackStatus.isFinished,
    isWaveActive,
    handleSelectTrack,
    handleStartWave,
    scheduleTransitionEnd,
  ]);

  const handleSeek = useCallback(
    async (seconds: number) => {
      if (!Number.isFinite(seconds) || seconds < 0) return;
      const seq = ++playSeqRef.current;
      isTransitioningRef.current = true;
      try {
        await tauriApi.seekTrack(seconds);
        if (seq === playSeqRef.current) {
          setPlaybackStatus((prev) => ({ ...prev, positionSec: seconds }));
        }
      } catch (err) {
        console.error('Ошибка перемотки:', err);
      } finally {
        if (seq === playSeqRef.current) {
          scheduleTransitionEnd(seq);
        }
      }
    },
    [scheduleTransitionEnd]
  );

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

  const handleToggleFavorite = useCallback(
    async (trackId: string, trackData?: TrackItem) => {
      // Ищем полные метаданные сначала в переданном объекте (актуально для карточки артиста), затем в общих списках
      const target =
        trackData ||
        allTracksRef.current.find((t) => t.id === trackId) ||
        (currentTrack?.id === trackId ? currentTrack : undefined);
      const isCurrentlyFav = favoriteIdsRef.current.has(trackId);
      const nextFav = !isCurrentlyFav;

      const updateList = (list: TrackItem[]) =>
        list.map((t) => (t.id === trackId ? { ...t, isFavorite: nextFav } : t));

      setTracks(updateList);
      setWaveBuffer(updateList);
      setSearchResults(updateList);
      setQueue(updateList);
      setRecentTracks(updateList);
      setTopTracks(updateList);
      setActivePlaylistTracks((prev) => (prev ? updateList(prev) : prev));
      setCurrentTrack((prev) =>
        prev && prev.id === trackId ? { ...prev, isFavorite: nextFav } : prev
      );

      searchCacheRef.current.forEach((cachedRes, key) => {
        searchCacheRef.current.set(key, {
          ...cachedRes,
          tracks: updateList(cachedRes.tracks),
        });
      });

      if (!target || target.sourceType !== 'local') {
        setSavedOnlineFavs((prev) => {
          const filtered = prev.filter((t) => t.id !== trackId);
          const updated =
            nextFav && target
              ? [{ ...target, isFavorite: true }, ...filtered]
              : nextFav
              ? [
                  {
                    id: trackId,
                    title: 'Трек',
                    artist: 'Яндекс Музыка',
                    album: 'Яндекс Музыка',
                    durationSeconds: 0,
                    sourceType: 'yandex',
                    audioUrl: trackId.replace(/^ym-/, 'ym://'),
                    isFavorite: true,
                  } as TrackItem,
                  ...filtered,
                ]
              : filtered;
          try {
            localStorage.setItem('abyss-online-favs', JSON.stringify(updated));
          } catch {}
          return updated;
        });
      }

      try {
        await tauriApi.setTrackFavorite(trackId, nextFav);
      } catch {}
    },
    [currentTrack]
  );

  const handleCreatePlaylist = async (customName?: string) => {
    const index = playlists.length + 1;
    const id = `pl-${Date.now()}`;
    const name = (customName ?? '').trim() || `Плейлист #${index}`;
    try {
      const created = await tauriApi.createPlaylist(id, name);
      setPlaylists((prev) => [...prev, created]);
      setActivePlaylistId(created.id);
      setActiveTab('playlist');
    } catch (err) {
      console.error('Ошибка создания плейлиста:', err);
    }
  };

  const handleRenamePlaylist = async (playlistId: string, newName: string) => {
    setPlaylists((prev) =>
      prev.map((pl) => (pl.id === playlistId ? { ...pl, name: newName } : pl))
    );
    try {
      await tauriApi.renamePlaylist(playlistId, newName);
    } catch (err) {
      console.error('Ошибка переименования плейлиста:', err);
    }
  };

  const handleDeletePlaylist = async (playlistId: string) => {
    setPlaylists((prev) => prev.filter((pl) => pl.id !== playlistId));
    if (activeTab === 'playlist' && activePlaylistId === playlistId) {
      setActivePlaylistId(null);
      setActiveTab('home');
    }
    try {
      await tauriApi.deletePlaylist(playlistId);
    } catch (err) {
      console.error('Ошибка удаления плейлиста:', err);
    }
  };

  const handleAddTrackToPlaylist = useCallback(
    async (playlistId: string, track: TrackItem) => {
      setPlaylists((prev) =>
        prev.map((pl) =>
          pl.id === playlistId && !pl.trackIds.includes(track.id)
            ? { ...pl, trackIds: [...pl.trackIds, track.id] }
            : pl
        )
      );
      if (activeTab === 'playlist' && activePlaylistId === playlistId) {
        setActivePlaylistTracks((prev) =>
          prev && !prev.some((t) => t.id === track.id) ? [...prev, track] : prev
        );
      }
      try {
        await tauriApi.addTrackToPlaylist(playlistId, track.id, track);
      } catch (err) {
        console.error('Ошибка добавления трека в плейлист:', err);
      }
    },
    [activeTab, activePlaylistId]
  );

  const handleCreatePlaylistAndAdd = useCallback(
    async (name: string, track: TrackItem) => {
      const id = `pl-${Date.now()}`;
      try {
        const created = await tauriApi.createPlaylist(id, name);
        await tauriApi.addTrackToPlaylist(created.id, track.id, track);
        setPlaylists((prev) => [...prev, { ...created, trackIds: [track.id] }]);
      } catch (err) {
        console.error('Ошибка создания плейлиста с треком:', err);
      }
    },
    []
  );

  const handleRemoveTrackFromPlaylist = useCallback(
    async (playlistId: string, trackId: string) => {
      setPlaylists((prev) =>
        prev.map((pl) =>
          pl.id === playlistId
            ? { ...pl, trackIds: pl.trackIds.filter((id) => id !== trackId) }
            : pl
        )
      );
      if (activeTab === 'playlist' && activePlaylistId === playlistId) {
        setActivePlaylistTracks((prev) =>
          prev ? prev.filter((t) => t.id !== trackId) : prev
        );
      }
      try {
        await tauriApi.removeTrackFromPlaylist(playlistId, trackId);
      } catch (err) {
        console.error('Ошибка удаления трека из плейлиста:', err);
      }
    },
    [activeTab, activePlaylistId]
  );

  useEffect(() => {
    if (activeTab !== 'playlist' || !activePlaylistId) {
      setActivePlaylistTracks(null);
      return;
    }
    let cancelled = false;
    tauriApi
      .getPlaylistTracks(activePlaylistId)
      .then((list) => {
        if (!cancelled) setActivePlaylistTracks(list);
      })
      .catch(() => {
        if (!cancelled) setActivePlaylistTracks(null);
      });
    return () => {
      cancelled = true;
    };
  }, [activeTab, activePlaylistId]);

  const queuePositionRef = useRef(0);
  queuePositionRef.current = playbackStatus.positionSec;

  // Сохраняем очередь и текущий трек в SQLite при переключении трека или очереди
  useEffect(() => {
    if (!queueLoadedRef.current) return;
    const timer = window.setTimeout(() => {
      const activeList = queue.length > 0 ? queue : [];
      void tauriApi
        .saveQueueState({
          trackIds: activeList.map((t) => t.id),
          currentTrackId: currentTrack?.id ?? null,
          positionSec: Math.floor(queuePositionRef.current),
          queueTracks: activeList,
        })
        .catch(() => {});
    }, 500);
    return () => window.clearTimeout(timer);
  }, [queue, currentTrack?.id]);

  // Периодически сохраняем позицию воспроизведения раз в 5 секунд
  useEffect(() => {
    if (!playbackStatus.isPlaying || !currentTrack) return;
    const interval = window.setInterval(() => {
      if (!queueLoadedRef.current) return;
      const activeList = queue.length > 0 ? queue : [];
      void tauriApi
        .saveQueueState({
          trackIds: activeList.map((t) => t.id),
          currentTrackId: currentTrack.id,
          positionSec: Math.floor(queuePositionRef.current),
          queueTracks: activeList,
        })
        .catch(() => {});
    }, 5000);
    return () => window.clearInterval(interval);
  }, [playbackStatus.isPlaying, currentTrack, queue]);

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
        setIsEqOpen(false);
        setPickerTrack(null);
        return;
      }

      if (isTyping) return;

      if (e.code === 'Space') {
        e.preventDefault();
        void handleTogglePlay();
      } else if (e.key === 'ArrowRight' && currentTrack) {
        void handleSeek(
          Math.min(currentTrack.durationSeconds ?? 0, playbackStatus.positionSec + 5)
        );
      } else if (e.key === 'ArrowLeft' && currentTrack) {
        void handleSeek(Math.max(0, playbackStatus.positionSec - 5));
      } else if (e.key.toLowerCase() === 'm') {
        void handleToggleMute();
      } else if (e.key.toLowerCase() === 'l' && currentTrack) {
        void handleToggleFavorite(currentTrack.id);
      } else if (e.key.toLowerCase() === 'f' && currentTrack) {
        setIsNowPlayingOpen((v) => !v);
      } else if (e.key.toLowerCase() === 'e') {
        setIsEqOpen((v) => !v);
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

  const mediaHandlersRef = useRef({
    togglePlay: handleTogglePlay,
    next: handleNextTrack,
    prev: handlePrevTrack,
    seek: handleSeek,
    isPlaying: playbackStatus.isPlaying,
  });

  useEffect(() => {
    mediaHandlersRef.current = {
      togglePlay: handleTogglePlay,
      next: handleNextTrack,
      prev: handlePrevTrack,
      seek: handleSeek,
      isPlaying: playbackStatus.isPlaying,
    };
  }, [handleTogglePlay, handleNextTrack, handlePrevTrack, handleSeek, playbackStatus.isPlaying]);

  useEffect(() => {
    let unlistenControl: (() => void) | null = null;
    let unlistenSeek: (() => void) | null = null;
    let disposed = false;

    const setupMediaListeners = async () => {
      try {
        const fnCtrl = await tauriApi.onMediaControl((action) => {
          const h = mediaHandlersRef.current;
          if (action === 'play') {
            if (!h.isPlaying) void h.togglePlay();
          } else if (action === 'pause' || action === 'stop') {
            if (h.isPlaying) void h.togglePlay();
          } else if (action === 'toggle') {
            void h.togglePlay();
          } else if (action === 'next') {
            void h.next(false);
          } else if (action === 'previous') {
            void h.prev();
          }
        });
        if (disposed) {
          fnCtrl();
          return;
        }
        unlistenControl = fnCtrl;

        const fnSeek = await tauriApi.onMediaSeek((posSec) => {
          void mediaHandlersRef.current.seek(posSec);
        });
        if (disposed) {
          fnSeek();
          return;
        }
        unlistenSeek = fnSeek;
      } catch (err) {
        console.error('Ошибка подписки на медиа-контролы:', err);
      }
    };

    void setupMediaListeners();
    return () => {
      disposed = true;
      if (unlistenControl) unlistenControl();
      if (unlistenSeek) unlistenSeek();
    };
  }, []);

  // Автоматически восстанавливаем метаданные для старых онлайн-треков в избранном, если они сохранились без названия
  useEffect(() => {
    if (!yandexAuth.isAuthorized) return;
    const brokenIds = savedOnlineFavs
      .filter((t) => t.title === 'Трек' && t.artist === 'Яндекс Музыка' && t.durationSeconds === 0)
      .map((t) => t.id);

    if (brokenIds.length === 0) return;

    let cancelled = false;
    tauriApi
      .resolveYandexTracks(brokenIds)
      .then((resolved) => {
        if (cancelled || resolved.length === 0) return;
        const resolvedMap = new Map(resolved.map((t) => [t.id, { ...t, isFavorite: true }]));
        setSavedOnlineFavs((prev) => {
          const updated = prev.map((t) => resolvedMap.get(t.id) ?? t);
          try {
            localStorage.setItem('abyss-online-favs', JSON.stringify(updated));
          } catch {}
          return updated;
        });
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [yandexAuth.isAuthorized]);

  const favoriteIds = useMemo(() => {
    const set = new Set<string>(savedOnlineFavs.map((t) => t.id));
    tracks.forEach((t) => {
      if (t.isFavorite) set.add(t.id);
    });
    return set;
  }, [tracks, savedOnlineFavs]);

  const favoriteIdsRef = useRef(favoriteIds);
  favoriteIdsRef.current = favoriteIds;

  const allAvailableTracks = useMemo(() => {
    const map = new Map<string, TrackItem>();
    const normalize = (t: TrackItem) => ({
      ...t,
      isFavorite: favoriteIds.has(t.id),
    });

    tracks.forEach((t) => map.set(t.id, normalize(t)));
    waveBuffer.forEach((t) => {
      if (!map.has(t.id)) {
        map.set(t.id, normalize(t));
      }
    });
    searchResults.forEach((t) => {
      if (!map.has(t.id)) {
        map.set(t.id, normalize(t));
      }
    });
    savedOnlineFavs.forEach((t) => {
      if (!map.has(t.id)) {
        map.set(t.id, { ...t, isFavorite: true });
      }
    });
    recentTracks.forEach((t) => {
      if (!map.has(t.id)) {
        map.set(t.id, normalize(t));
      }
    });
    topTracks.forEach((t) => {
      if (!map.has(t.id)) {
        map.set(t.id, normalize(t));
      }
    });

    return Array.from(map.values());
  }, [tracks, waveBuffer, searchResults, savedOnlineFavs, recentTracks, topTracks, favoriteIds]);

  useEffect(() => {
    allTracksRef.current = allAvailableTracks;
  }, [allAvailableTracks]);

  const openArtistPage = useCallback((name: string, id?: string) => {
    setSearchQuery('');
    setSelectedEntity({ type: 'artist', name, id });
  }, []);

  const openAlbumPage = useCallback((name: string) => {
    setSearchQuery('');
    setSelectedEntity({ type: 'album', name });
  }, []);

  const albumEntityData = useMemo(() => {
    if (!selectedEntity || selectedEntity.type !== 'album') return null;
    const matchedTracks = allAvailableTracks.filter(
      (t) => t.album.toLowerCase() === selectedEntity.name.toLowerCase()
    );
    const coverTrack = matchedTracks.find((t) => t.coverUrl) || matchedTracks[0];
    return {
      tracks: matchedTracks,
      coverUrl: coverTrack?.coverUrl,
      seedId: coverTrack?.id || selectedEntity.name,
    };
  }, [selectedEntity, allAvailableTracks]);

  const homeArtists = useMemo(() => {
    const map = new Map<string, { name: string; coverUrl?: string; count: number }>();
    allAvailableTracks.forEach((t) => {
      const primary = t.artist.split(',')[0]?.trim();
      if (!primary || primary === 'Неизвестный исполнитель') return;
      const existing = map.get(primary);
      if (existing) {
        existing.count += 1;
        if (!existing.coverUrl && t.coverUrl) existing.coverUrl = t.coverUrl;
      } else {
        map.set(primary, { name: primary, coverUrl: t.coverUrl, count: 1 });
      }
    });
    return Array.from(map.values()).slice(0, 12);
  }, [allAvailableTracks]);

  const homeAlbums = useMemo(() => {
    const map = new Map<string, { name: string; artist: string; coverUrl?: string; count: number }>();
    allAvailableTracks.forEach((t) => {
      if (!t.album || t.album === 'Локальная медиатека' || t.album === 'Яндекс Музыка') return;
      const existing = map.get(t.album);
      if (existing) {
        existing.count += 1;
        if (!existing.coverUrl && t.coverUrl) existing.coverUrl = t.coverUrl;
      } else {
        map.set(t.album, { name: t.album, artist: t.artist, coverUrl: t.coverUrl, count: 1 });
      }
    });
    return Array.from(map.values()).slice(0, 12);
  }, [allAvailableTracks]);

  const isSearching = searchQuery.trim().length > 0;

  const displayedTracks = useMemo(() => {
    const applyFav = (t: TrackItem) => ({
      ...t,
      isFavorite: favoriteIds.has(t.id),
    });

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
      const map = new Map<string, TrackItem>();
      (activePlaylistTracks ?? []).forEach((t) => map.set(t.id, applyFav(t)));
      allAvailableTracks.forEach((t) => {
        if (pl.trackIds.includes(t.id) && !map.has(t.id)) {
          map.set(t.id, applyFav(t));
        }
      });
      return Array.from(map.values());
    }

    return tracks.map(applyFav);
  }, [
    favoriteIds,
    isSearching,
    searchQuery,
    tracks,
    searchResults,
    activeTab,
    activePlaylistId,
    activePlaylistTracks,
    playlists,
    allAvailableTracks,
  ]);

  const visibleTracks = useMemo(
    () => displayedTracks.slice(0, renderLimit),
    [displayedTracks, renderLimit]
  );

  const nextWaveTrack = useMemo(() => {
    if (!isWaveActive || !currentTrack) return null;
    const idx = waveBuffer.findIndex((t) => t.id === currentTrack.id);
    if (idx === -1 || idx + 1 >= waveBuffer.length) return null;
    return waveBuffer[idx + 1];
  }, [isWaveActive, currentTrack, waveBuffer]);

  const activeWaveTags = [
    waveSettings.mood,
    waveSettings.activity,
    waveSettings.character,
    waveSettings.genre,
    waveSettings.language,
  ].filter(Boolean) as string[];

  const activePlaylist = playlists.find((p) => p.id === activePlaylistId) || null;
  const activeQueue = isWaveActive
    ? ([currentTrack, nextWaveTrack].filter(Boolean) as TrackItem[])
    : queue.length > 0
    ? queue
    : displayedTracks;

  const viewKey = selectedEntity
    ? `entity-${selectedEntity.type}-${selectedEntity.name}`
    : isSearching
    ? 'search-view'
    : `${activeTab}-${activePlaylistId ?? 'root'}`;

  const syncedCurrentTrack = useMemo(() => {
    if (!currentTrack) return null;
    const isFav = favoriteIds.has(currentTrack.id);
    return isFav === currentTrack.isFavorite
      ? currentTrack
      : { ...currentTrack, isFavorite: isFav };
  }, [currentTrack, favoriteIds]);

  const activeTheme = useMemo(
    () => THEME_PRESETS.find((t) => t.id === currentThemeId) || THEME_PRESETS[0],
    [currentThemeId]
  );

  const pushWidgetState = useCallback(() => {
    void tauriApi.emitWidgetState({
      track: syncedCurrentTrack,
      isPlaying: playbackStatus.isPlaying,
      positionSec: playbackStatus.positionSec,
      isFavorite: Boolean(syncedCurrentTrack?.isFavorite),
      accentColor: activeTheme.accent,
      accentSecondary: activeTheme.accent2,
    });
  }, [
    syncedCurrentTrack,
    playbackStatus.isPlaying,
    playbackStatus.positionSec,
    activeTheme.accent,
    activeTheme.accent2,
  ]);

  const pushWidgetStateRef = useRef(pushWidgetState);
  useEffect(() => {
    pushWidgetStateRef.current = pushWidgetState;
  }, [pushWidgetState]);

  const toggleFavRef = useRef(handleToggleFavorite);
  useEffect(() => {
    toggleFavRef.current = handleToggleFavorite;
  }, [handleToggleFavorite]);

  useEffect(() => {
    if (isWidgetOpen) {
      pushWidgetState();
    }
  }, [isWidgetOpen, pushWidgetState]);

  useEffect(() => {
    let unlistenReq: (() => void) | null = null;
    let unlistenVis: (() => void) | null = null;
    let unlistenFav: (() => void) | null = null;
    let disposed = false;

    const initWidgetListeners = async () => {
      try {
        const open = await tauriApi.isDesktopWidgetOpen();
        if (disposed) return;
        setIsWidgetOpen(open);

        const fnReq = await tauriApi.onWidgetRequestState(() => {
          pushWidgetStateRef.current();
        });
        if (disposed) {
          fnReq();
          return;
        }
        unlistenReq = fnReq;

        const fnVis = await tauriApi.onWidgetVisibilityChanged((visible) => {
          setIsWidgetOpen(visible);
        });
        if (disposed) {
          fnVis();
          return;
        }
        unlistenVis = fnVis;

        const fnFav = await tauriApi.onWidgetToggleFavorite((trackId) => {
          void toggleFavRef.current(trackId);
        });
        if (disposed) {
          fnFav();
          return;
        }
        unlistenFav = fnFav;
      } catch (err) {
        console.error('Ошибка инициализации слушателей виджета:', err);
      }
    };

    void initWidgetListeners();
    return () => {
      disposed = true;
      if (unlistenReq) unlistenReq();
      if (unlistenVis) unlistenVis();
      if (unlistenFav) unlistenFav();
    };
  }, []);

  const isPlaying = playbackStatus.isPlaying;
  const currentArtist = currentTrack?.artist;

  useEffect(() => {
    if (!isPlaying || !currentArtist) return;
    const timer = setInterval(() => {
      if (isTransitioningRef.current) return;
      void tauriApi.addArtistListeningTime(currentArtist, 5).catch(() => {});
    }, 5000);
    return () => clearInterval(timer);
  }, [isPlaying, currentArtist]);

  const handleToggleWidget = useCallback(async () => {
    try {
      const open = await tauriApi.toggleDesktopWidget();
      setIsWidgetOpen(open);
    } catch (err) {
      console.error('Ошибка переключения виджета:', err);
    }
  }, []);

  const collectFrontendSyncPrefs = useCallback((): FrontendSyncPrefs => {
    let likedArtists: string[] = [];
    try {
      const raw = localStorage.getItem('abyss-liked-artists');
      if (raw) likedArtists = JSON.parse(raw);
    } catch {}
    return {
      themeId: currentThemeId,
      isNightMode,
      waveSettings,
      onlineFavs: savedOnlineFavs,
      likedArtists,
    };
  }, [currentThemeId, isNightMode, waveSettings, savedOnlineFavs]);

  const handleSyncImportComplete = useCallback(
    async (summary: SyncImportSummary) => {
      const prefs = summary.frontendPrefs;
      if (prefs.themeId) {
        setCurrentThemeId(prefs.themeId);
        try {
          localStorage.setItem('abyss-theme', prefs.themeId);
        } catch {}
      }
      if (typeof prefs.isNightMode === 'boolean') {
        setIsNightMode(prefs.isNightMode);
        try {
          localStorage.setItem('abyss-night-mode', String(prefs.isNightMode));
        } catch {}
      }
      if (prefs.waveSettings) {
        setWaveSettings(prefs.waveSettings);
      }
      if (prefs.onlineFavs && prefs.onlineFavs.length > 0) {
        setSavedOnlineFavs((prev) => {
          const seen = new Set(prev.map((t) => t.id));
          const merged = [...prev];
          for (const item of prefs.onlineFavs) {
            if (!seen.has(item.id)) {
              seen.add(item.id);
              merged.push({ ...item, isFavorite: true });
            }
          }
          try {
            localStorage.setItem('abyss-online-favs', JSON.stringify(merged));
          } catch {}
          return merged;
        });
      }
      if (prefs.likedArtists && prefs.likedArtists.length > 0) {
        try {
          const prevRaw = localStorage.getItem('abyss-liked-artists');
          const prevList: string[] = prevRaw ? JSON.parse(prevRaw) : [];
          const merged = Array.from(new Set([...prevList, ...prefs.likedArtists]));
          localStorage.setItem('abyss-liked-artists', JSON.stringify(merged));
        } catch {}
      }

      try {
        const [savedTracks, savedPlaylists, ymStatus, recent, top, savedQueue] =
          await Promise.all([
            tauriApi.getTracks(),
            tauriApi.getPlaylists(),
            tauriApi.getYandexStatus(),
            tauriApi.getRecentTracks(12).catch(() => [] as TrackItem[]),
            tauriApi.getTopTracks(12).catch(() => [] as TrackItem[]),
            tauriApi.loadQueueState().catch(() => null),
          ]);
        setTracks(savedTracks);
        setPlaylists(savedPlaylists);
        setYandexAuth(ymStatus);
        setRecentTracks(recent);
        setTopTracks(top);

        if (savedQueue && !currentTrack) {
          const restoredQueue =
            savedQueue.queueTracks && savedQueue.queueTracks.length > 0
              ? savedQueue.queueTracks
              : [];
          if (restoredQueue.length > 0) {
            setQueue(restoredQueue);
            const restoredCurrent = savedQueue.currentTrackId
              ? restoredQueue.find((t) => t.id === savedQueue.currentTrackId) || null
              : null;
            if (restoredCurrent) {
              hasLoadedAudioRef.current = false;
              restoredSeekSecRef.current = savedQueue.positionSec || 0;
              setCurrentTrack(restoredCurrent);
              setPlaybackStatus((prev) => ({
                ...prev,
                isPlaying: false,
                positionSec: savedQueue.positionSec || 0,
              }));
            }
          }
        }
      } catch (err) {
        console.error('Ошибка обновления состояния после синхронизации:', err);
      }
    },
    [currentTrack]
  );

  const cloudReadyRef = useRef(false);
  const isApplyingCloudRef = useRef(false);
  const cloudImportRef = useRef(handleSyncImportComplete);
  cloudImportRef.current = handleSyncImportComplete;
  const collectPrefsRef = useRef(collectFrontendSyncPrefs);
  collectPrefsRef.current = collectFrontendSyncPrefs;

  // Автоматическая загрузка из облака Supabase при старте и каждые 3 секунды
  useEffect(() => {
    if (!isAppReady || !yandexAuth.isAuthorized) {
      cloudReadyRef.current = false;
      return;
    }
    let cancelled = false;
    let inFlight = false;
    cloudReadyRef.current = false;

    const pullOnce = async (isInitial: boolean) => {
      if (inFlight || cancelled) return;
      if (!isInitial && document.visibilityState === 'hidden') return;
      inFlight = true;
      try {
        const summary = await tauriApi.cloudSyncPull();
        if (cancelled) return;
        if (summary) {
          isApplyingCloudRef.current = true;
          try {
            await cloudImportRef.current(summary);
          } finally {
            window.setTimeout(() => {
              isApplyingCloudRef.current = false;
            }, 300);
          }
        } else if (isInitial || !cloudReadyRef.current) {
          await tauriApi.cloudSyncPush(collectPrefsRef.current());
        }
        if (!cancelled) {
          cloudReadyRef.current = true;
        }
      } catch {
      } finally {
        inFlight = false;
      }
    };

    void pullOnce(true);
    const interval = window.setInterval(() => {
      void pullOnce(false);
    }, 3000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [isAppReady, yandexAuth.isAuthorized]);

  // Фоновое автосохранение изменений в облако Supabase
  useEffect(() => {
    if (
      !isAppReady ||
      !yandexAuth.isAuthorized ||
      !cloudReadyRef.current ||
      isApplyingCloudRef.current
    ) {
      return;
    }
    const timer = window.setTimeout(() => {
      if (!isApplyingCloudRef.current) {
        void tauriApi.cloudSyncPush(collectPrefsRef.current()).catch(() => {});
      }
    }, 1500);
    return () => window.clearTimeout(timer);
  }, [
    isAppReady,
    yandexAuth.isAuthorized,
    playlists,
    savedOnlineFavs,
    recentTracks,
    currentThemeId,
    isNightMode,
    waveSettings,
    currentTrack?.id,
  ]);

  useEffect(() => {
    const flushCloud = () => {
      if (!yandexAuth.isAuthorized || !cloudReadyRef.current || isApplyingCloudRef.current) {
        return;
      }
      void tauriApi.cloudSyncPush(collectPrefsRef.current()).catch(() => {});
    };
    const onVis = () => {
      if (document.visibilityState === 'hidden') flushCloud();
    };
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('pagehide', flushCloud);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('pagehide', flushCloud);
    };
  }, [yandexAuth.isAuthorized]);

  return (
    <div className={`app-shell ${isMobileUI ? 'is-mobile-ui' : ''}`}>
      <SplashScreen isReady={isAppReady} statusText={splashStatus} />
      {!isMobileUI && (
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
      )}

      {syncedCurrentTrack?.coverUrl && (
        <div
          className="ambient-cover-glow"
          style={{ backgroundImage: `url(${syncedCurrentTrack.coverUrl})` }}
          aria-hidden="true"
        />
      )}

      {isMobileUI ? (
        <MobileTopBar
          yandexAuth={yandexAuth}
          onGoHome={() => {
            setSearchQuery('');
            setSelectedEntity(null);
            setActiveTab('home');
            setActivePlaylistId(null);
          }}
          onOpenThemes={() => setIsThemeModalOpen(true)}
          onOpenEq={() => setIsEqOpen(true)}
          onYandexLogin={handleYandexLogin}
          onYandexLogout={handleYandexLogout}
        />
      ) : (
        <Sidebar
          activeTab={activeTab}
          activePlaylistId={activePlaylistId}
          playlists={playlists}
          yandexAuth={yandexAuth}
          onSelectTab={(tab) => {
            setSearchQuery('');
            setSelectedEntity(null);
            setActiveTab(tab);
            if (tab !== 'playlist') {
              setActivePlaylistId(null);
            }
          }}
          onSelectPlaylist={(playlistId) => {
            setSearchQuery('');
            setSelectedEntity(null);
            setActivePlaylistId(playlistId);
            setActiveTab('playlist');
          }}
          onCreatePlaylist={() => void handleCreatePlaylist()}
          onRenamePlaylist={handleRenamePlaylist}
          onDeletePlaylist={handleDeletePlaylist}
          onScanFolder={handlePickAndScanFolder}
          onOpenThemes={() => setIsThemeModalOpen(true)}
          onYandexLogin={handleYandexLogin}
          onYandexLogout={handleYandexLogout}
        />
      )}

      <div className="main-workspace-wrap">
        <main
          ref={workspaceRef}
          className="main-workspace"
          onScroll={(e) => {
            const top = e.currentTarget.scrollTop;
            setShowScrollTop(top > 120);
          }}
        >
          {(!isMobileUI || activeTab === 'search' || activeTab === 'home' || isSearching) && (
            <TopSearchBar
              externalValue={searchQuery}
              isMobileUI={isMobileUI}
              focusTrigger={searchFocusTrigger}
              onSearchCommit={(val) => {
                if (val.trim()) setSelectedEntity(null);
                setSearchQuery(val);
              }}
            />
          )}

          <div key={viewKey} className="view-transition">
          {selectedEntity?.type === 'artist' ? (
            <ArtistView
              artistName={selectedEntity.name}
              artistId={selectedEntity.id}
              localTracks={tracks}
              favoriteIds={favoriteIds}
              currentTrackId={syncedCurrentTrack?.id ?? null}
              isPlaying={playbackStatus.isPlaying}
              onBack={() => setSelectedEntity(null)}
              onSelectTrack={(track, artistQueue) =>
                handleSelectTrack(track, artistQueue, false)
              }
              onToggleFavorite={handleToggleFavorite}
              onAddToPlaylist={setPickerTrack}
              onOpenArtist={openArtistPage}
            />
          ) : selectedEntity?.type === 'album' && albumEntityData ? (
            <div className="entity-view">
              <button
                type="button"
                className="wave-settings-btn"
                style={{ marginBottom: 16 }}
                onClick={() => setSelectedEntity(null)}
              >
                ← Назад
              </button>

              <div className="entity-hero">
                <div
                  className="entity-hero-cover"
                  style={{
                    background: albumEntityData.coverUrl
                      ? `url(${albumEntityData.coverUrl}) center/cover no-repeat`
                      : getCoverGradient(albumEntityData.seedId),
                    borderRadius: 18,
                  }}
                >
                  {!albumEntityData.coverUrl && <Music size={42} />}
                </div>
                <div className="entity-hero-info">
                  <span className="entity-hero-badge">Альбом</span>
                  <h1 className="entity-hero-title">{selectedEntity.name}</h1>
                  <div className="entity-hero-meta">
                    {albumEntityData.tracks.length} треков
                  </div>
                  {albumEntityData.tracks.length > 0 && (
                    <button
                      type="button"
                      className="btn-primary-pill"
                      style={{ marginTop: 14, width: 'fit-content' }}
                      onClick={() =>
                        handleSelectTrack(
                          albumEntityData.tracks[0],
                          albumEntityData.tracks
                        )
                      }
                    >
                      <Play size={16} fill="currentColor" style={{ marginRight: 6 }} />
                      Слушать всё
                    </button>
                  )}
                </div>
              </div>

              <div style={{ marginTop: 26 }}>
                <h2 className="section-heading shimmer-text" style={{ marginBottom: 12 }}>
                  Треки
                </h2>
                <TrackList
                  tracks={albumEntityData.tracks}
                  currentTrackId={syncedCurrentTrack?.id ?? null}
                  isPlaying={playbackStatus.isPlaying}
                  onSelectTrack={(t) => handleSelectTrack(t, albumEntityData.tracks)}
                  onToggleFavorite={handleToggleFavorite}
                  onAddToPlaylist={setPickerTrack}
                  onSelectArtist={openArtistPage}
                  onSelectAlbum={openAlbumPage}
                />
              </div>
            </div>
          ) : isSearching ? (
            <div>
              <div className="section-header-row" style={{ marginTop: 4 }}>
                <h2 className="section-heading shimmer-text">
                  Результаты: «{searchQuery.trim()}»
                  {isSearchingApi && (
                    <span
                      className="track-artist"
                      style={{ marginLeft: 12, fontWeight: 500 }}
                    >
                      ищем в Яндекс Музыке...
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
                  {(() => {
                    const q = searchQuery.trim().toLowerCase();
                    const ymList = searchArtists.slice(0, 8);
                    const fallbackList: { id?: string; name: string; coverUrl?: string; tracksCount: number }[] = [];
                    if (ymList.length === 0) {
                      const artistMap = new Map<string, { name: string; coverUrl?: string; count: number }>();
                      displayedTracks.forEach((t) => {
                        t.artist
                          .split(',')
                          .map((s) => s.trim())
                          .filter(Boolean)
                          .forEach((name) => {
                            if (!name.toLowerCase().includes(q)) return;
                            const ex = artistMap.get(name);
                            if (ex) {
                              ex.count += 1;
                              if (!ex.coverUrl && t.coverUrl) ex.coverUrl = t.coverUrl;
                            } else {
                              artistMap.set(name, { name, coverUrl: t.coverUrl, count: 1 });
                            }
                          });
                      });
                      artistMap.forEach((v) =>
                        fallbackList.push({ name: v.name, coverUrl: v.coverUrl, tracksCount: v.count })
                      );
                    }
                    const matchedArtists = ymList.length > 0 ? ymList : fallbackList.slice(0, 8);
                    if (matchedArtists.length === 0) return null;
                    return (
                      <div style={{ marginBottom: 22 }}>
                        <div className="section-header-row">
                          <h3 className="section-heading shimmer-text" style={{ fontSize: 16 }}>
                            Исполнители
                          </h3>
                        </div>
                        <div className="entity-cards-row">
                          {matchedArtists.map((art) => (
                            <button
                              key={art.id || art.name}
                              type="button"
                              className="entity-card"
                              onClick={() => openArtistPage(art.name, art.id)}
                            >
                              <div
                                className="entity-card-cover round"
                                style={{
                                  background: art.coverUrl
                                    ? `url(${art.coverUrl}) center/cover no-repeat`
                                    : getCoverGradient(art.name),
                                }}
                              >
                                {!art.coverUrl && <Music size={26} />}
                              </div>
                              <div className="entity-card-title">{art.name}</div>
                              <div className="entity-card-sub">
                                {art.tracksCount > 0 ? `${art.tracksCount} треков` : 'Исполнитель'}
                              </div>
                            </button>
                          ))}
                        </div>
                      </div>
                    );
                  })()}
                  <TrackList
                    tracks={visibleTracks}
                    currentTrackId={syncedCurrentTrack?.id ?? null}
                    isPlaying={playbackStatus.isPlaying}
                    onSelectTrack={(track) =>
                      handleSelectTrack(track, displayedTracks, false)
                    }
                    onToggleFavorite={handleToggleFavorite}
                    onAddToPlaylist={setPickerTrack}
                    onSelectArtist={openArtistPage}
                    onSelectAlbum={openAlbumPage}
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
                    Ищем треки в Яндекс Музыке...
                  </div>
                </div>
              ) : (
                <div style={{ marginTop: 20 }} className="empty-box">
                  <Search size={32} />
                  <div className="track-name" style={{ fontSize: 16 }}>
                    Ничего не найдено
                  </div>
                  <p className="track-artist" style={{ maxWidth: 400 }}>
                    {yandexAuth.isAuthorized
                      ? 'Попробуй другой запрос или проверь локальную медиатеку'
                      : 'Войди через Яндекс ID в меню слева, чтобы искать по каталогу Яндекс Музыки'}
                  </p>
                  {!yandexAuth.isAuthorized && (
                    <button className="btn-primary-pill" onClick={handleYandexLogin}>
                      Войти через Яндекс ID
                    </button>
                  )}
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
                    {yandexAuth.isAuthorized
                      ? 'Бесконечный поток Яндекс Музыки — подбирает треки по одному без повторов'
                      : 'Подключи Яндекс ID, чтобы запустить персональный поток Яндекс Музыки'}
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
                    onClick={() => {
                      // Если волна уже играет — ставим на паузу или продолжаем, а не запускаем заново
                      if (isWaveActive && syncedCurrentTrack) {
                        void handleTogglePlay();
                      } else {
                        void handleStartWave();
                      }
                    }}
                    disabled={isLoadingStream}
                    title={
                      isWaveActive && syncedCurrentTrack
                        ? playbackStatus.isPlaying
                          ? 'Пауза'
                          : 'Продолжить волну'
                        : yandexAuth.isAuthorized
                        ? 'Запустить новую волну'
                        : 'Войти через Яндекс ID'
                    }
                  >
                    {playbackStatus.isPlaying && isWaveActive ? (
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
                    Запускаем «Мою волну» Яндекс Музыки...
                  </div>
                </div>
              )}

              {!isLoadingStream && isWaveActive && syncedCurrentTrack && (
                <>
                  <div className="section-header-row">
                    <h2 className="section-heading shimmer-text">Сейчас в потоке волны</h2>
                  </div>
                  <div
                    className="recent-grid"
                    style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}
                  >
                    <div className="recent-card is-playing" style={{ cursor: 'default' }}>
                      {resolveCoverSrc(syncedCurrentTrack.coverUrl) ? (
                        <img
                          src={resolveCoverSrc(syncedCurrentTrack.coverUrl)!}
                          alt={syncedCurrentTrack.title}
                          className="recent-thumb"
                        />
                      ) : (
                        <div className="recent-thumb">
                          <Music size={18} />
                        </div>
                      )}
                      <div className="recent-card-text">
                        <span
                          className="track-artist"
                          style={{
                            fontSize: 11,
                            textTransform: 'uppercase',
                            letterSpacing: 0.6,
                          }}
                        >
                          Играет сейчас
                        </span>
                        <span className="recent-card-title shimmer-text">
                          {syncedCurrentTrack.title}
                        </span>
                        <span className="recent-card-artist">
                          <ArtistLinks
                            artist={syncedCurrentTrack.artist}
                            onSelectArtist={openArtistPage}
                          />
                        </span>
                      </div>
                    </div>

                    {nextWaveTrack && (
                      <button
                        type="button"
                        className="recent-card"
                        onClick={() => handleNextTrack(false)}
                        title="Переключить на следующий трек волны"
                      >
                        {resolveCoverSrc(nextWaveTrack.coverUrl) ? (
                          <img
                            src={resolveCoverSrc(nextWaveTrack.coverUrl)!}
                            alt={nextWaveTrack.title}
                            className="recent-thumb"
                          />
                        ) : (
                          <div className="recent-thumb">
                            <Music size={18} />
                          </div>
                        )}
                        <div className="recent-card-text">
                          <span
                            className="track-artist"
                            style={{
                              fontSize: 11,
                              textTransform: 'uppercase',
                              letterSpacing: 0.6,
                            }}
                          >
                            Далее в волне
                          </span>
                          <span className="recent-card-title shimmer-text">
                            {nextWaveTrack.title}
                          </span>
                          <span className="recent-card-artist">{nextWaveTrack.artist}</span>
                        </div>
                        <SkipForward size={16} style={{ opacity: 0.6, flexShrink: 0 }} />
                      </button>
                    )}
                  </div>
                </>
              )}

              {!isLoadingStream &&
                tracks.length === 0 &&
                !isWaveActive &&
                !yandexAuth.isAuthorized &&
                recentTracks.length === 0 && (
                <div style={{ marginTop: 28 }} className="empty-box">
                  <FolderPlus size={36} />
                  <div className="track-name" style={{ fontSize: 16 }}>
                    Медиатека пока пуста
                  </div>
                  <p className="track-artist" style={{ maxWidth: 420 }}>
                    Запусти «Мою волну» сверху или выбери папку с локальными треками на компьютере.
                  </p>
                  <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', justifyContent: 'center' }}>
                    {!yandexAuth.isAuthorized && (
                      <button className="btn-primary-pill" onClick={handleYandexLogin}>
                        <LogIn size={16} style={{ marginRight: 6 }} />
                        Войти через Яндекс ID
                      </button>
                    )}
                    <button className="wave-settings-btn" onClick={handlePickAndScanFolder}>
                      Выбрать папку с музыкой
                    </button>
                  </div>
                </div>
              )}

              {recentTracks.length > 0 && (
                <div style={{ marginTop: 28 }}>
                  <div className="section-header-row">
                    <h2
                      className="section-heading shimmer-text"
                      style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}
                    >
                      <History size={19} style={{ color: 'var(--accent-warm)' }} />
                      Недавно слушали
                    </h2>
                  </div>
                  <div className="recent-grid">
                    {recentTracks.slice(0, 8).map((tr) => {
                      const isCur = syncedCurrentTrack?.id === tr.id;
                      const src = resolveCoverSrc(tr.coverUrl);
                      return (
                        <button
                          key={`recent-${tr.id}`}
                          type="button"
                          className={`recent-card ${isCur ? 'is-playing' : ''}`}
                          onClick={() => handleSelectTrack(tr, recentTracks, false)}
                        >
                          {src ? (
                            <img src={src} alt={tr.title} className="recent-thumb" loading="lazy" />
                          ) : (
                            <div
                              className="recent-thumb"
                              style={{ background: getCoverGradient(tr.id) }}
                            >
                              <Music size={17} />
                            </div>
                          )}
                          <div className="recent-card-text">
                            <span className="recent-card-title shimmer-text">{tr.title}</span>
                            <span className="recent-card-artist">{tr.artist}</span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {topTracks.length > 0 && (
                <div style={{ marginTop: 28 }}>
                  <div className="section-header-row">
                    <h2
                      className="section-heading shimmer-text"
                      style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}
                    >
                      <Flame size={19} style={{ color: 'var(--accent-warm)' }} />
                      Топ треков
                    </h2>
                  </div>
                  <TrackList
                    tracks={topTracks.slice(0, 10).map((t) => ({
                      ...t,
                      isFavorite: favoriteIds.has(t.id),
                    }))}
                    currentTrackId={syncedCurrentTrack?.id ?? null}
                    isPlaying={playbackStatus.isPlaying}
                    onSelectTrack={(track) => handleSelectTrack(track, topTracks, false)}
                    onToggleFavorite={handleToggleFavorite}
                    onAddToPlaylist={setPickerTrack}
                    onSelectArtist={openArtistPage}
                    onSelectAlbum={openAlbumPage}
                  />
                </div>
              )}

              {homeArtists.length > 0 && (
                <div style={{ marginTop: 28 }}>
                  <div className="section-header-row">
                    <h2 className="section-heading shimmer-text">Исполнители</h2>
                  </div>
                  <div className="entity-cards-row">
                    {homeArtists.map((art) => (
                      <button
                        key={art.name}
                        type="button"
                        className="entity-card"
                        onClick={() => openArtistPage(art.name)}
                      >
                        <div
                          className="entity-card-cover round"
                          style={{
                            background: art.coverUrl
                              ? `url(${art.coverUrl}) center/cover no-repeat`
                              : getCoverGradient(art.name),
                          }}
                        >
                          {!art.coverUrl && <Music size={26} />}
                        </div>
                        <div className="entity-card-title">{art.name}</div>
                        <div className="entity-card-sub">{art.count} треков</div>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {homeAlbums.length > 0 && (
                <div style={{ marginTop: 28 }}>
                  <div className="section-header-row">
                    <h2 className="section-heading shimmer-text">Альбомы</h2>
                  </div>
                  <div className="entity-cards-row">
                    {homeAlbums.map((alb) => (
                      <button
                        key={alb.name}
                        type="button"
                        className="entity-card"
                        onClick={() => openAlbumPage(alb.name)}
                      >
                        <div
                          className="entity-card-cover"
                          style={{
                            background: alb.coverUrl
                              ? `url(${alb.coverUrl}) center/cover no-repeat`
                              : getCoverGradient(alb.name),
                          }}
                        >
                          {!alb.coverUrl && <Disc3 size={26} />}
                        </div>
                        <div className="entity-card-title">{alb.name}</div>
                        <div className="entity-card-sub">{alb.artist}</div>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {tracks.length > 0 && (
                <>
                  <div className="section-header-row">
                    <h2 className="section-heading shimmer-text">
                      Локальная коллекция ({tracks.length})
                    </h2>
                  </div>
                  <TrackList
                    tracks={visibleTracks}
                    currentTrackId={syncedCurrentTrack?.id ?? null}
                    isPlaying={playbackStatus.isPlaying}
                    onSelectTrack={(track) =>
                      handleSelectTrack(track, displayedTracks, false)
                    }
                    onToggleFavorite={handleToggleFavorite}
                    onAddToPlaylist={setPickerTrack}
                    onSelectArtist={openArtistPage}
                    onSelectAlbum={openAlbumPage}
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
                <>
                  <TrackList
                    tracks={visibleTracks}
                    currentTrackId={syncedCurrentTrack?.id ?? null}
                    isPlaying={playbackStatus.isPlaying}
                    onSelectTrack={(track) =>
                      handleSelectTrack(track, displayedTracks, false)
                    }
                    onToggleFavorite={handleToggleFavorite}
                    onAddToPlaylist={setPickerTrack}
                    onSelectArtist={openArtistPage}
                    onSelectAlbum={openAlbumPage}
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
          ) : activeTab === 'search' ? (
            <div>
              <div className="empty-box" style={{ marginTop: 14 }}>
                <Search size={34} style={{ color: 'var(--accent-warm)' }} />
                <div className="track-name" style={{ fontSize: 17 }}>
                  Найди любимый трек или артиста
                </div>
                <p className="track-artist" style={{ maxWidth: 360 }}>
                  Введи название трека, имя исполнителя или альбома в строку поиска выше
                </p>
              </div>
              {recentTracks.length > 0 && (
                <div style={{ marginTop: 24 }}>
                  <div className="section-header-row">
                    <h2 className="section-heading shimmer-text">Недавно слушали</h2>
                  </div>
                  <div className="recent-grid">
                    {recentTracks.slice(0, 6).map((tr) => {
                      const src = resolveCoverSrc(tr.coverUrl);
                      return (
                        <button
                          key={`search-recent-${tr.id}`}
                          type="button"
                          className={`recent-card ${syncedCurrentTrack?.id === tr.id ? 'is-playing' : ''}`}
                          onClick={() => handleSelectTrack(tr, recentTracks, false)}
                        >
                          {src ? (
                            <img src={src} alt={tr.title} className="recent-thumb" loading="lazy" />
                          ) : (
                            <div
                              className="recent-thumb"
                              style={{ background: getCoverGradient(tr.id) }}
                            >
                              <Music size={17} />
                            </div>
                          )}
                          <div className="recent-card-text">
                            <span className="recent-card-title shimmer-text">{tr.title}</span>
                            <span className="recent-card-artist">{tr.artist}</span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          ) : activeTab === 'library' ? (
            <div className="mobile-library-view">
              <div className="mobile-library-header">
                <h1 className="section-heading shimmer-text" style={{ fontSize: 24 }}>
                  Коллекция
                </h1>
                <div className="mobile-library-actions">
                  <button
                    type="button"
                    className="chip-btn"
                    onClick={handlePickAndScanFolder}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
                  >
                    <FolderPlus size={15} />
                    <span>Папка</span>
                  </button>
                  <button
                    type="button"
                    className="btn-primary-pill"
                    style={{
                      padding: '9px 16px',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 6,
                    }}
                    onClick={() => {
                      setShowNewPlaylistForm((v) => !v);
                      setNewPlaylistName('');
                    }}
                  >
                    <Plus size={16} />
                    <span>Плейлист</span>
                  </button>
                </div>
              </div>

              {showNewPlaylistForm && (
                <form
                  className="mobile-new-pl-form"
                  onSubmit={async (e) => {
                    e.preventDefault();
                    await handleCreatePlaylist(newPlaylistName);
                    setNewPlaylistName('');
                    setShowNewPlaylistForm(false);
                  }}
                >
                  <input
                    type="text"
                    className="mobile-new-pl-input"
                    placeholder="Название нового плейлиста..."
                    value={newPlaylistName}
                    autoFocus
                    onChange={(e) => setNewPlaylistName(e.target.value)}
                  />
                  <button type="submit" className="btn-primary-pill" style={{ padding: '9px 16px' }}>
                    Создать
                  </button>
                </form>
              )}

              <div className="mobile-playlist-grid">
                <button
                  type="button"
                  className="mobile-playlist-card is-favorites-card"
                  onClick={() => {
                    setSelectedEntity(null);
                    setActivePlaylistId(null);
                    setActiveTab('favorites');
                  }}
                >
                  <div className="mobile-playlist-cover is-fav">
                    <Heart size={24} fill="#ffffff" color="#ffffff" />
                  </div>
                  <div className="mobile-playlist-info">
                    <div className="track-name">Мне нравится</div>
                    <div className="track-artist">Избранные треки • {favoriteIds.size}</div>
                  </div>
                </button>

                {playlists.map((pl) => {
                  const isEditing = editingLibId === pl.id;
                  return (
                    <div
                      key={pl.id}
                      className="mobile-playlist-card"
                      onClick={() => {
                        if (isEditing) return;
                        setSelectedEntity(null);
                        setActivePlaylistId(pl.id);
                        setActiveTab('playlist');
                      }}
                      role="button"
                      tabIndex={0}
                    >
                      <div
                        className="mobile-playlist-cover"
                        style={{ background: getCoverGradient(pl.id) }}
                      >
                        <Music size={22} />
                      </div>
                      <div className="mobile-playlist-info">
                        {isEditing ? (
                          <input
                            className="playlist-rename-input"
                            style={{ width: '100%', fontSize: 14, padding: '6px 8px' }}
                            value={editingLibName}
                            autoFocus
                            onClick={(e) => e.stopPropagation()}
                            onChange={(e) => setEditingLibName(e.target.value)}
                            onBlur={() => {
                              const t = editingLibName.trim();
                              if (t) void handleRenamePlaylist(pl.id, t);
                              setEditingLibId(null);
                            }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                const t = editingLibName.trim();
                                if (t) void handleRenamePlaylist(pl.id, t);
                                setEditingLibId(null);
                              }
                              if (e.key === 'Escape') setEditingLibId(null);
                            }}
                          />
                        ) : (
                          <>
                            <div className="track-name recent-card-title">{pl.name}</div>
                            <div className="track-artist">Треков: {pl.trackIds.length}</div>
                          </>
                        )}
                      </div>
                      {!isEditing && (
                        <div
                          className="mobile-playlist-card-actions"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <button
                            type="button"
                            className="icon-ghost-btn"
                            title="Переименовать"
                            onClick={() => {
                              setEditingLibId(pl.id);
                              setEditingLibName(pl.name);
                            }}
                          >
                            <Pencil size={15} />
                          </button>
                          <button
                            type="button"
                            className="icon-ghost-btn"
                            title="Удалить"
                            onClick={() => handleDeletePlaylist(pl.id)}
                          >
                            <Trash2 size={15} />
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {tracks.length > 0 && (
                <div style={{ marginTop: 24 }}>
                  <div className="section-header-row" style={{ marginTop: 0 }}>
                    <h2 className="section-heading shimmer-text">
                      Локальные треки ({tracks.length})
                    </h2>
                  </div>
                  <TrackList
                    tracks={tracks.slice(0, 40)}
                    currentTrackId={syncedCurrentTrack?.id ?? null}
                    isPlaying={playbackStatus.isPlaying}
                    onSelectTrack={(track) => handleSelectTrack(track, tracks, false)}
                    onToggleFavorite={handleToggleFavorite}
                    onAddToPlaylist={setPickerTrack}
                    onSelectArtist={openArtistPage}
                    onSelectAlbum={openAlbumPage}
                  />
                </div>
              )}
            </div>
          ) : activeTab === 'playlist' && activePlaylist ? (
            <div>
              {isMobileUI && (
                <button
                  type="button"
                  className="wave-settings-btn"
                  style={{ marginBottom: 14, height: 38, padding: '0 14px', fontSize: 13 }}
                  onClick={() => {
                    setActivePlaylistId(null);
                    setActiveTab('library');
                  }}
                >
                  ← Коллекция
                </button>
              )}
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
                <>
                  <TrackList
                    tracks={visibleTracks}
                    currentTrackId={syncedCurrentTrack?.id ?? null}
                    isPlaying={playbackStatus.isPlaying}
                    onSelectTrack={(track) =>
                      handleSelectTrack(track, displayedTracks, false)
                    }
                    onToggleFavorite={handleToggleFavorite}
                    onAddToPlaylist={setPickerTrack}
                    onRemoveFromPlaylist={(track) =>
                      handleRemoveTrackFromPlaylist(activePlaylist.id, track.id)
                    }
                    onSelectArtist={openArtistPage}
                    onSelectAlbum={openAlbumPage}
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

        <button
          type="button"
          className={`scroll-top-btn ${showScrollTop ? 'is-visible' : ''}`}
          onClick={() => workspaceRef.current?.scrollTo({ top: 0, behavior: 'smooth' })}
          title="Наверх"
          aria-label="Вернуться наверх"
        >
          <ArrowUp size={18} />
        </button>
      </div>

      {isQueueOpen && (
        <>
          {isMobileUI && (
            <div
              className="queue-mobile-backdrop"
              onClick={() => setIsQueueOpen(false)}
            />
          )}
          <aside className="queue-drawer">
            <div className="queue-header">
              <span className="section-heading shimmer-text" style={{ fontSize: 17 }}>
                {isWaveActive ? 'Поток волны' : 'Очередь'}
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
                {resolveCoverSrc(syncedCurrentTrack.coverUrl) ? (
                  <img
                    src={resolveCoverSrc(syncedCurrentTrack.coverUrl)!}
                    alt={syncedCurrentTrack.title}
                    className="queue-big-art"
                  />
                ) : (
                  <div className="queue-big-art">
                    <Music size={36} />
                  </div>
                )}
                <div style={{ minWidth: 0 }}>
                  <div className="track-name shimmer-text recent-card-title" style={{ fontSize: 16 }}>
                    {syncedCurrentTrack.title}
                  </div>
                  <div className="track-artist recent-card-title">
                    <ArtistLinks
                      artist={syncedCurrentTrack.artist}
                      onSelectArtist={openArtistPage}
                    />
                  </div>
                </div>
              </div>
            )}

            <div className="modal-group-label" style={{ marginBottom: 10 }}>
              {isWaveActive ? 'Следующий трек' : `Далее в очереди (${activeQueue.length})`}
            </div>
            <div className="queue-scroll">
              {(isWaveActive ? (nextWaveTrack ? [nextWaveTrack] : []) : activeQueue.slice(0, 50)).map(
                (track) => {
                  const isCurrent = syncedCurrentTrack?.id === track.id;
                  return (
                    <button
                      key={track.id}
                      type="button"
                      className={`playlist-row ${isCurrent ? 'active' : ''}`}
                      onClick={() =>
                        isWaveActive
                          ? handleNextTrack(false)
                          : handleSelectTrack(track, activeQueue, false)
                      }
                    >
                      {resolveCoverSrc(track.coverUrl) ? (
                        <img
                          src={resolveCoverSrc(track.coverUrl)!}
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
                }
              )}
            </div>
          </aside>
        </>
      )}

      <PlayerBar
        currentTrack={syncedCurrentTrack}
        isPlaying={playbackStatus.isPlaying}
        isShuffle={isShuffle}
        isRepeat={isRepeat}
        isQueueOpen={isQueueOpen}
        isEqOpen={isEqOpen}
        isLyricsOpen={isNowPlayingOpen}
        isWidgetOpen={isWidgetOpen}
        isMobileUI={isMobileUI}
        isMuted={playbackStatus.isMuted}
        positionSec={playbackStatus.positionSec}
        volume={playbackStatus.volume}
        onTogglePlay={handleTogglePlay}
        onToggleShuffle={() => setIsShuffle((s) => !s)}
        onToggleRepeat={() => setIsRepeat((r) => !r)}
        onToggleQueue={() => setIsQueueOpen((q) => !q)}
        onToggleEq={() => setIsEqOpen((eq) => !eq)}
        onToggleWidget={isMobileUI ? undefined : handleToggleWidget}
        onToggleMute={handleToggleMute}
        onPrev={handlePrevTrack}
        onNext={() => handleNextTrack(false)}
        onSeek={handleSeek}
        onVolumeChange={handleVolumeChange}
        onToggleFavorite={(id) => handleToggleFavorite(id, syncedCurrentTrack ?? undefined)}
        onSelectArtist={openArtistPage}
        onOpenNowPlaying={() => syncedCurrentTrack && setIsNowPlayingOpen(true)}
      />

      {isMobileUI && (
        <MobileBottomNav
          activeTab={activeTab}
          isSearching={isSearching}
          onSelectTab={(tab) => {
            setSelectedEntity(null);
            if (tab === 'search') {
              setActivePlaylistId(null);
              setActiveTab('search');
              setSearchFocusTrigger((n) => n + 1);
            } else {
              setSearchQuery('');
              setActiveTab(tab);
              if (tab !== 'playlist') {
                setActivePlaylistId(null);
              }
            }
          }}
        />
      )}

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

      <EqualizerModal isOpen={isEqOpen} onClose={() => setIsEqOpen(false)} />

      <ThemeModal
        isOpen={isThemeModalOpen}
        currentThemeId={currentThemeId}
        isNightMode={isNightMode}
        onToggleNightMode={() => {
          setIsNightMode((prev) => {
            const next = !prev;
            try {
              localStorage.setItem('abyss-night-mode', String(next));
            } catch {}
            return next;
          });
        }}
        onSelectTheme={(theme: ThemePreset) => setCurrentThemeId(theme.id)}
        onClose={() => setIsThemeModalOpen(false)}
      />

      <SeasonalEffects themeId={currentThemeId} />
      {isNightMode && <div className="night-mode-overlay" />}

      <NowPlayingOverlay
        isOpen={isNowPlayingOpen}
        track={syncedCurrentTrack}
        isPlaying={playbackStatus.isPlaying}
        isShuffle={isShuffle}
        isRepeat={isRepeat}
        isMobileUI={isMobileUI}
        positionSec={playbackStatus.positionSec}
        volume={playbackStatus.volume}
        isMuted={playbackStatus.isMuted}
        audioLevel={playbackStatus.audioLevel ?? 0}
        onClose={() => setIsNowPlayingOpen(false)}
        onTogglePlay={handleTogglePlay}
        onToggleShuffle={() => setIsShuffle((s) => !s)}
        onToggleRepeat={() => setIsRepeat((r) => !r)}
        onOpenQueue={() => setIsQueueOpen(true)}
        onPrev={handlePrevTrack}
        onNext={() => handleNextTrack(false)}
        onSeek={handleSeek}
        onVolumeChange={handleVolumeChange}
        onToggleMute={handleToggleMute}
        onToggleFavorite={(id) => handleToggleFavorite(id, syncedCurrentTrack ?? undefined)}
        onSelectArtist={openArtistPage}
        onOpenEq={() => setIsEqOpen(true)}
      />

      <CommandPalette
        isOpen={isCmdOpen}
        tracks={allAvailableTracks}
        onClose={() => setIsCmdOpen(false)}
        onSelectTrack={(track) =>
          handleSelectTrack(track, allAvailableTracks, false)
        }
        onStartWave={() => handleStartWave()}
        onNavigate={(tab) => {
          setSearchQuery('');
          setSelectedEntity(null);
          setActiveTab(tab);
        }}
      />

      <PlaylistPickerModal
        track={pickerTrack}
        playlists={playlists}
        onClose={() => setPickerTrack(null)}
        onAddTrack={handleAddTrackToPlaylist}
        onCreateAndAdd={handleCreatePlaylistAndAdd}
      />
    </div>
  );
};

export default App;