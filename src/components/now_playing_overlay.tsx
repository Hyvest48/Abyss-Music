import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronDown,
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Shuffle,
  Repeat,
  ListMusic,
  Heart,
  Music,
  MicVocal,
  Sliders,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { TrackItem, getCoverGradient, resolveCoverSrc } from '../shared/models';
import { formatDuration } from './track_list';
import { SmoothSlider } from './smooth_slider';
import { ArtistLinks } from './artist_links';
import { tauriApi, TrackLyrics } from '../services/tauri_api';

const lyricsCache = new Map<string, TrackLyrics>();

interface LyricLine {
  timeSec: number;
  text: string;
}

interface NowPlayingOverlayProps {
  isOpen: boolean;
  track: TrackItem | null;
  isPlaying: boolean;
  isShuffle?: boolean;
  isRepeat?: boolean;
  isMobileUI?: boolean;
  positionSec: number;
  volume: number;
  isMuted: boolean;
  audioLevel?: number;
  onClose: () => void;
  onTogglePlay: () => void;
  onToggleShuffle?: () => void;
  onToggleRepeat?: () => void;
  onOpenQueue?: () => void;
  onPrev: () => void;
  onNext: () => void;
  onSeek: (sec: number) => void;
  onVolumeChange: (vol: number) => void;
  onToggleMute: () => void;
  onToggleFavorite: (trackId: string) => void;
  onSelectArtist?: (artist: string) => void;
  onOpenEq: () => void;
}

function parseLrc(lrc: string): LyricLine[] {
  const lines: LyricLine[] = [];
  const regex = /\[(\d{2}):(\d{2})(?:\.(\d{2,3}))?\](.*)/;
  for (const raw of lrc.split('\n')) {
    const match = raw.match(regex);
    if (!match) continue;
    const min = Number(match[1]);
    const sec = Number(match[2]);
    const ms = match[3] ? Number(match[3].padEnd(3, '0')) / 1000 : 0;
    const text = match[4].trim();
    if (text) {
      lines.push({ timeSec: min * 60 + sec + ms, text });
    }
  }
  return lines;
}

export const NowPlayingOverlay: React.FC<NowPlayingOverlayProps> = ({
  isOpen,
  track,
  isPlaying,
  isShuffle = false,
  isRepeat = false,
  isMobileUI = false,
  positionSec,
  volume,
  isMuted,
  audioLevel = 0,
  onClose,
  onTogglePlay,
  onToggleShuffle,
  onToggleRepeat,
  onOpenQueue,
  onPrev,
  onNext,
  onSeek,
  onVolumeChange,
  onToggleMute,
  onToggleFavorite,
  onSelectArtist,
  onOpenEq,
}) => {
  const [syncedLyrics, setSyncedLyrics] = useState<LyricLine[]>([]);
  const [plainLyrics, setPlainLyrics] = useState<string | null>(null);
  const [isInstrumental, setIsInstrumental] = useState(false);
  const [isLoadingLyrics, setIsLoadingLyrics] = useState(false);
  const [previewSec, setPreviewSec] = useState<number | null>(null);
  const [mobileViewMode, setMobileViewMode] = useState<'player' | 'lyrics'>('player');
  const lyricsScrollRef = useRef<HTMLDivElement>(null);
  const activeLineRef = useRef<HTMLButtonElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const audioLevelRef = useRef(audioLevel);
  audioLevelRef.current = audioLevel;

  useEffect(() => {
    if (!isOpen || !track) return;
    let cancelled = false;

    const applyLyrics = (data: TrackLyrics) => {
      if (data.syncedLyrics) {
        setSyncedLyrics(parseLrc(data.syncedLyrics));
      } else if (data.plainLyrics) {
        setPlainLyrics(data.plainLyrics);
      } else if (data.instrumental) {
        setIsInstrumental(true);
      }
    };

    const cached = lyricsCache.get(track.id);
    if (cached) {
      setSyncedLyrics([]);
      setPlainLyrics(null);
      setIsInstrumental(false);
      setIsLoadingLyrics(false);
      applyLyrics(cached);
      return;
    }

    const loadLyrics = async () => {
      setIsLoadingLyrics(true);
      setSyncedLyrics([]);
      setPlainLyrics(null);
      setIsInstrumental(false);
      try {
        const data = await tauriApi.getTrackLyrics(track);
        if (data.syncedLyrics || data.plainLyrics || data.instrumental) {
          lyricsCache.set(track.id, data);
          if (lyricsCache.size > 50) {
            const firstKey = lyricsCache.keys().next().value;
            if (firstKey !== undefined) lyricsCache.delete(firstKey);
          }
        }
        if (cancelled) return;
        applyLyrics(data);
      } catch {
      } finally {
        if (!cancelled) setIsLoadingLyrics(false);
      }
    };

    void loadLyrics();
    return () => {
      cancelled = true;
    };
  }, [isOpen, track?.id]);

  const activeIndex = useMemo(() => {
    if (syncedLyrics.length === 0) return -1;
    let idx = -1;
    for (let i = 0; i < syncedLyrics.length; i++) {
      if (positionSec >= syncedLyrics[i].timeSec - 0.25) {
        idx = i;
      } else {
        break;
      }
    }
    return idx;
  }, [syncedLyrics, positionSec]);

  useEffect(() => {
    const container = lyricsScrollRef.current;
    const lineEl = activeLineRef.current;
    if (!container || !lineEl) return;
    // Прокручиваем только внутренний контейнер текста, чтобы не сдвигать верхнюю шапку оверлея
    const targetTop =
      lineEl.offsetTop - container.clientHeight / 2 + lineEl.clientHeight / 2;
    container.scrollTo({
      top: Math.max(0, targetTop),
      behavior: 'smooth',
    });
  }, [activeIndex]);

  useEffect(() => {
    if (!isOpen) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let rafId = 0;
    let lastTime = performance.now();
    const bars = 28;
    const heights = new Array(bars).fill(4);

    const render = (time: number) => {
      const dt = Math.min(0.05, Math.max(0.001, (time - lastTime) / 1000));
      lastTime = time;
      const lerp = 1 - Math.exp(-14 * dt);

      const w = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0, 0, w, h);

      const accent =
        getComputedStyle(document.documentElement)
          .getPropertyValue('--accent-warm')
          .trim() || '#d4b88c';

      const barW = Math.max(3, w / bars - 4);
      const center = bars / 2;
      const amp = isPlaying ? Math.min(1.8, Math.max(0.25, audioLevelRef.current * 4.2)) : 0;
      for (let i = 0; i < bars; i++) {
        const dist = 1 - Math.abs(i - center) / center;
        const envelope = 0.4 + 0.6 * dist;
        const wave = isPlaying
          ? (Math.sin(time * 0.008 + i * 0.7) * 0.5 + 0.5) *
              (Math.cos(time * 0.005 - i * 0.45) * 0.5 + 0.5) *
              (h - 6) *
              envelope *
              amp +
            5
          : 5;
        heights[i] += (wave - heights[i]) * lerp;

        const x = i * (barW + 4);
        const barH = Math.max(4, heights[i]);
        const y = h - barH;

        ctx.fillStyle = accent;
        ctx.globalAlpha = isPlaying ? 0.9 : 0.32;
        ctx.beginPath();
        ctx.roundRect(x, y, barW, barH, 999);
        ctx.fill();
      }
      rafId = requestAnimationFrame(render);
    };

    rafId = requestAnimationFrame(render);
    return () => cancelAnimationFrame(rafId);
  }, [isOpen, isPlaying]);

  if (!isOpen || !track) return null;

  const duration = track.durationSeconds ?? 0;
  const resolvedCover = resolveCoverSrc(track.coverUrl);

  return (
    <div
      className={`now-playing-overlay ${isMobileUI ? 'np-mobile-ui' : ''} ${
        mobileViewMode === 'lyrics' ? 'np-show-lyrics' : 'np-show-player'
      }`}
    >
      {resolvedCover && (
        <div
          className="now-playing-bg"
          style={{ backgroundImage: `url("${resolvedCover}")` }}
        />
      )}

      <div className="now-playing-top">
        <button className="icon-ghost-btn np-top-btn" onClick={onClose} title="Свернуть (Esc)">
          <ChevronDown size={22} />
        </button>

        {isMobileUI ? (
          <div className="np-mobile-tabs" role="tablist">
            <button
              type="button"
              className={`np-mobile-tab ${mobileViewMode === 'player' ? 'active' : ''}`}
              onClick={() => setMobileViewMode('player')}
            >
              Плеер
            </button>
            <button
              type="button"
              className={`np-mobile-tab ${mobileViewMode === 'lyrics' ? 'active' : ''}`}
              onClick={() => setMobileViewMode('lyrics')}
            >
              Текст
            </button>
          </div>
        ) : (
          <span className="now-playing-badge">Сейчас играет</span>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {isMobileUI && onOpenQueue && (
            <button
              className="icon-ghost-btn np-top-btn"
              onClick={() => {
                onClose();
                onOpenQueue();
              }}
              title="Очередь"
            >
              <ListMusic size={19} />
            </button>
          )}
          <button className="icon-ghost-btn np-top-btn" onClick={onOpenEq} title="Эквалайзер">
            <Sliders size={19} />
          </button>
        </div>
      </div>

      <div className="now-playing-grid">
        <div className="now-playing-left">
          <div className={`now-playing-cover-wrap ${isPlaying ? 'is-playing' : ''}`}>
            {resolvedCover ? (
              <img src={resolvedCover} alt={track.title} className="now-playing-cover" />
            ) : (
              <div
                className="now-playing-cover"
                style={{ background: getCoverGradient(track.id) }}
              >
                <Music size={72} />
              </div>
            )}
          </div>

          <canvas ref={canvasRef} width={320} height={42} className="np-visualizer" />

          <div className="now-playing-meta">
            <div style={{ minWidth: 0, flex: 1 }}>
              <h2 className="now-playing-title">{track.title}</h2>
              <p className="now-playing-artist">
                <ArtistLinks
                  artist={track.artist}
                  onSelectArtist={onSelectArtist}
                  onAfterClick={onClose}
                />
              </p>
            </div>
            <button
              className="icon-ghost-btn"
              onClick={() => onToggleFavorite(track.id)}
              title="Мне нравится (L)"
            >
              <Heart
                size={22}
                fill={track.isFavorite ? 'var(--accent-warm)' : 'none'}
                color={track.isFavorite ? 'var(--accent-warm)' : 'currentColor'}
              />
            </button>
          </div>

          <div className="now-playing-controls">
            {onToggleShuffle && (
              <button
                type="button"
                className={`icon-ghost-btn np-secondary-ctl ${isShuffle ? 'is-active' : ''}`}
                onClick={onToggleShuffle}
                title="Перемешать"
              >
                <Shuffle size={19} />
              </button>
            )}
            <button type="button" className="icon-ghost-btn np-skip-btn" onClick={onPrev}>
              <SkipBack size={24} />
            </button>
            <button type="button" className="wave-play-btn np-play-btn" onClick={onTogglePlay}>
              {isPlaying ? (
                <Pause size={26} fill="currentColor" />
              ) : (
                <Play size={26} fill="currentColor" style={{ marginLeft: 2 }} />
              )}
            </button>
            <button type="button" className="icon-ghost-btn np-skip-btn" onClick={onNext}>
              <SkipForward size={24} />
            </button>
            {onToggleRepeat && (
              <button
                type="button"
                className={`icon-ghost-btn np-secondary-ctl ${isRepeat ? 'is-active' : ''}`}
                onClick={onToggleRepeat}
                title="Повтор"
              >
                <Repeat size={19} />
              </button>
            )}
          </div>

          <div className="np-progress-wrap">
            <span className="tabular-time" style={{ fontSize: 12, minWidth: 34 }}>
              {formatDuration(Math.floor(previewSec ?? positionSec))}
            </span>
            <SmoothSlider
              value={positionSec}
              max={duration}
              commitOnRelease={true}
              onDragPreview={setPreviewSec}
              onChange={(val) => onSeek(Math.floor(val))}
              disabled={!track || duration <= 0}
            />
            <span className="tabular-time" style={{ fontSize: 12, minWidth: 34, textAlign: 'right' }}>
              {formatDuration(duration)}
            </span>
          </div>

          <div className="np-volume-wrap">
            <button
              type="button"
              className="icon-ghost-btn"
              style={{ width: 28, height: 28, flexShrink: 0 }}
              onClick={onToggleMute}
              title={isMuted ? 'Включить звук' : 'Выключить звук'}
            >
              {isMuted || volume <= 0.01 ? <VolumeX size={16} /> : <Volume2 size={16} />}
            </button>
            <SmoothSlider
              value={isMuted ? 0 : volume}
              max={1}
              onChange={(val) => onVolumeChange(Number(val.toFixed(2)))}
            />
          </div>
        </div>

        <div className="now-playing-lyrics">
          {isLoadingLyrics && (
            <div className="lyrics-placeholder">
              <MicVocal size={32} className="pulse-icon" />
              <span>Ищем текст песни...</span>
            </div>
          )}

          {!isLoadingLyrics && syncedLyrics.length > 0 && (
            <div ref={lyricsScrollRef} className="lyrics-scroll" style={{ position: 'relative' }}>
              {syncedLyrics.map((line, i) => {
                const isActive = i === activeIndex;
                const isPast = i < activeIndex;
                return (
                  <button
                    key={`${line.timeSec}-${i}`}
                    ref={isActive ? activeLineRef : null}
                    type="button"
                    className={`lyric-line ${isActive ? 'is-active' : ''} ${isPast ? 'is-past' : ''}`}
                    onClick={() => onSeek(Math.floor(line.timeSec))}
                  >
                    {line.text}
                  </button>
                );
              })}
            </div>
          )}

          {!isLoadingLyrics && syncedLyrics.length === 0 && plainLyrics && (
            <div className="lyrics-scroll">
              <p className="lyrics-plain">{plainLyrics}</p>
            </div>
          )}

          {!isLoadingLyrics && syncedLyrics.length === 0 && !plainLyrics && (
            <div className="lyrics-placeholder">
              <MicVocal size={32} style={{ opacity: 0.4 }} />
              <span>
                {isInstrumental
                  ? 'Инструментальная композиция без слов'
                  : 'Текст для этого трека пока недоступен'}
              </span>
            </div>
          )}
        </div>
      </div>

      {isMobileUI && mobileViewMode === 'lyrics' && (
        <div className="np-lyrics-mini-bar">
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className="track-name recent-card-title">{track.title}</div>
            <div className="track-artist recent-card-title">{track.artist}</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button type="button" className="icon-ghost-btn" onClick={onPrev}>
              <SkipBack size={20} />
            </button>
            <button type="button" className="player-play-circle" onClick={onTogglePlay}>
              {isPlaying ? (
                <Pause size={17} fill="#141416" />
              ) : (
                <Play size={17} fill="#141416" style={{ marginLeft: 2 }} />
              )}
            </button>
            <button type="button" className="icon-ghost-btn" onClick={onNext}>
              <SkipForward size={20} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
};