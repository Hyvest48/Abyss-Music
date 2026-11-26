import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronDown,
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Heart,
  Music,
  MicVocal,
  Sliders,
} from 'lucide-react';
import { TrackItem, getCoverGradient } from '../shared/models';
import { formatDuration } from './track_list';
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
  positionSec: number;
  audioLevel?: number;
  onClose: () => void;
  onTogglePlay: () => void;
  onPrev: () => void;
  onNext: () => void;
  onSeek: (sec: number) => void;
  onToggleFavorite: (trackId: string) => void;
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
  positionSec,
  audioLevel = 0,
  onClose,
  onTogglePlay,
  onPrev,
  onNext,
  onSeek,
  onToggleFavorite,
  onOpenEq,
}) => {
  const [syncedLyrics, setSyncedLyrics] = useState<LyricLine[]>([]);
  const [plainLyrics, setPlainLyrics] = useState<string | null>(null);
  const [isInstrumental, setIsInstrumental] = useState(false);
  const [isLoadingLyrics, setIsLoadingLyrics] = useState(false);
  const activeLineRef = useRef<HTMLButtonElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const audioLevelRef = useRef(audioLevel);
  audioLevelRef.current = audioLevel;

  useEffect(() => {
    if (!track) return;
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
      if (isOpen) setIsLoadingLyrics(true);
      setSyncedLyrics([]);
      setPlainLyrics(null);
      setIsInstrumental(false);
      try {
        const data = await tauriApi.getTrackLyrics(track);
        lyricsCache.set(track.id, data);
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
    activeLineRef.current?.scrollIntoView({
      behavior: 'smooth',
      block: 'center',
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

  return (
    <div className="now-playing-overlay">
      {track.coverUrl && (
        <div
          className="now-playing-bg"
          style={{ backgroundImage: `url(${track.coverUrl})` }}
        />
      )}

      <div className="now-playing-top">
        <button className="icon-ghost-btn" onClick={onClose} title="Свернуть (Esc)">
          <ChevronDown size={22} />
        </button>
        <span className="now-playing-badge">Сейчас играет</span>
        <button className="icon-ghost-btn" onClick={onOpenEq} title="Эквалайзер">
          <Sliders size={19} />
        </button>
      </div>

      <div className="now-playing-grid">
        <div className="now-playing-left">
          <div className={`now-playing-cover-wrap ${isPlaying ? 'is-playing' : ''}`}>
            {track.coverUrl ? (
              <img src={track.coverUrl} alt={track.title} className="now-playing-cover" />
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
            <div>
              <h2 className="now-playing-title">{track.title}</h2>
              <p className="now-playing-artist">{track.artist}</p>
            </div>
            <button
              className="icon-ghost-btn"
              onClick={() => onToggleFavorite(track.id)}
              title="Мне нравится (L)"
            >
              <Heart
                size={20}
                fill={track.isFavorite ? 'var(--accent-warm)' : 'none'}
                color={track.isFavorite ? 'var(--accent-warm)' : 'currentColor'}
              />
            </button>
          </div>

          <div className="now-playing-controls">
            <button className="icon-ghost-btn" onClick={onPrev}>
              <SkipBack size={22} />
            </button>
            <button className="wave-play-btn" onClick={onTogglePlay}>
              {isPlaying ? (
                <Pause size={24} fill="currentColor" />
              ) : (
                <Play size={24} fill="currentColor" style={{ marginLeft: 2 }} />
              )}
            </button>
            <button className="icon-ghost-btn" onClick={onNext}>
              <SkipForward size={22} />
            </button>
          </div>

          <div className="tabular-time" style={{ textAlign: 'center', marginTop: 10 }}>
            {formatDuration(Math.floor(positionSec))} / {formatDuration(duration)}
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
            <div className="lyrics-scroll">
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
    </div>
  );
};