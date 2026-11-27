import React, { useEffect, useRef, useState } from 'react';
import { emit, listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import {
  Heart,
  Music,
  Pause,
  Pin,
  PinOff,
  Play,
  SkipBack,
  SkipForward,
  X,
} from 'lucide-react';
import { TrackItem, getCoverGradient, resolveCoverSrc } from '../shared/models';
import { formatDuration } from './track_list';
import '../styles/widget.css';

export interface WidgetStatePayload {
  track: TrackItem | null;
  isPlaying: boolean;
  positionSec: number;
  isFavorite: boolean;
  accentColor?: string;
  accentSecondary?: string;
}

export const DesktopWidget: React.FC = () => {
  const [state, setState] = useState<WidgetStatePayload>({
    track: null,
    isPlaying: false,
    positionSec: 0,
    isFavorite: false,
    accentColor: '#9b7dff',
    accentSecondary: '#4cc9f0',
  });
  const [isPinned, setIsPinned] = useState(true);
  const [isClosing, setIsClosing] = useState(false);
  const [isDraggingSeek, setIsDraggingSeek] = useState(false);
  const [dragSeekSec, setDragSeekSec] = useState<number | null>(null);
  const trackBarRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    document.documentElement.classList.add('widget-mode');
    let unlisten: (() => void) | null = null;
    let disposed = false;

    const init = async () => {
      try {
        const fn = await listen<WidgetStatePayload>('widget-state-update', (event) => {
          setState(event.payload);
        });
        if (disposed) {
          fn();
          return;
        }
        unlisten = fn;
        await invoke('request_widget_state');
      } catch (err) {
        console.error('Ошибка инициализации виджета:', err);
      }
    };

    void init();

    return () => {
      disposed = true;
      document.documentElement.classList.remove('widget-mode');
      if (unlisten) unlisten();
    };
  }, []);

  const handleClose = () => {
    if (isClosing) return;
    setIsClosing(true);
    setTimeout(() => {
      void invoke('close_desktop_widget');
    }, 220);
  };

  const handleTogglePin = async () => {
    const next = !isPinned;
    setIsPinned(next);
    try {
      await invoke('set_widget_pinned', { pinned: next });
    } catch (err) {
      console.error('Ошибка закрепления виджета:', err);
    }
  };

  const calcSeekSec = (clientX: number) => {
    const el = trackBarRef.current;
    const duration = state.track?.durationSeconds ?? 0;
    if (!el || duration <= 0) return 0;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0) return 0;
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    return ratio * duration;
  };

  const handleSeekPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const duration = state.track?.durationSeconds ?? 0;
    if (duration <= 0) return;
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    const nextSec = calcSeekSec(e.clientX);
    setIsDraggingSeek(true);
    setDragSeekSec(nextSec);
  };

  const handleSeekPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDraggingSeek) return;
    e.stopPropagation();
    setDragSeekSec(calcSeekSec(e.clientX));
  };

  const handleSeekPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDraggingSeek) return;
    e.stopPropagation();
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    const finalSec = Math.floor(calcSeekSec(e.clientX));
    setIsDraggingSeek(false);
    setDragSeekSec(null);
    setState((prev) => ({ ...prev, positionSec: finalSec }));
    void emit('media-seek', finalSec);
  };

  const handleCardPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest('button, [role="slider"], .lg-resize-handle')) {
      return;
    }
    void getCurrentWindow().startDragging();
  };

  const handleResizePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    void getCurrentWindow().startResizeDragging('SouthEast');
  };

  const track = state.track;
  const resolvedCover = resolveCoverSrc(track?.coverUrl);
  const duration = track?.durationSeconds ?? 0;
  const displayedPositionSec =
    isDraggingSeek && dragSeekSec !== null ? dragSeekSec : state.positionSec;
  const progressPct =
    duration > 0 ? Math.min(100, Math.max(0, (displayedPositionSec / duration) * 100)) : 0;

  return (
    <div className="lg-widget-stage">
      <div
        className={`lg-widget-card ${isClosing ? 'is-closing' : ''}`}
        onPointerDown={handleCardPointerDown}
      >
        <div
          className="lg-ambient-orb"
          style={{ background: state.accentColor || '#9b7dff' }}
        />
        <div
          className="lg-ambient-orb-secondary"
          style={{ background: state.accentSecondary || '#4cc9f0' }}
        />

        <div className="lg-top-row" data-tauri-drag-region>
          <div
            className={`lg-cover-wrap ${state.isPlaying ? 'is-playing' : ''}`}
            data-tauri-drag-region
          >
            {resolvedCover ? (
              <img
                src={resolvedCover}
                alt={track?.title || 'Обложка'}
                className="lg-cover-img"
                draggable={false}
              />
            ) : (
              <div
                className="lg-cover-placeholder"
                style={{
                  background: track
                    ? getCoverGradient(track.id)
                    : 'linear-gradient(135deg, #6d5dfc, #4cc9f0)',
                }}
              >
                <Music size={22} />
              </div>
            )}
            {state.isPlaying && (
              <div className="lg-eq-badge">
                <span className="lg-eq-bar" />
                <span className="lg-eq-bar" />
                <span className="lg-eq-bar" />
              </div>
            )}
          </div>

          <div className="lg-meta" data-tauri-drag-region>
            <div className="lg-title" data-tauri-drag-region>
              {track ? track.title : 'Abyss Music'}
            </div>
            <div className="lg-artist" data-tauri-drag-region>
              {track ? track.artist : 'Выберите трек в плеере'}
            </div>
          </div>

          <div className="lg-window-actions">
            <button
              type="button"
              className={`lg-pill-btn ${isPinned ? 'is-pinned' : ''}`}
              onClick={handleTogglePin}
              title={isPinned ? 'Открепить поверх окон' : 'Закрепить поверх окон'}
            >
              {isPinned ? <Pin size={12} /> : <PinOff size={12} />}
            </button>
            <button
              type="button"
              className="lg-pill-btn"
              onClick={handleClose}
              title="Скрыть виджет"
            >
              <X size={13} />
            </button>
          </div>
        </div>

        <div className="lg-progress-wrap">
          <span className="lg-time">{formatDuration(Math.floor(displayedPositionSec))}</span>
          <div
            ref={trackBarRef}
            role="slider"
            aria-valuemin={0}
            aria-valuemax={duration}
            aria-valuenow={Math.floor(displayedPositionSec)}
            className={`lg-progress-track ${isDraggingSeek ? 'is-dragging' : ''} ${duration <= 0 ? 'is-disabled' : ''}`}
            onPointerDown={handleSeekPointerDown}
            onPointerMove={handleSeekPointerMove}
            onPointerUp={handleSeekPointerUp}
            onPointerCancel={handleSeekPointerUp}
            title="Перемотать"
          >
            <div
              className="lg-progress-fill"
              style={{
                width: `${progressPct}%`,
                transition: isDraggingSeek ? 'none' : undefined,
              }}
            >
              <span className="lg-progress-thumb" />
            </div>
          </div>
          <span className="lg-time lg-time-right">{formatDuration(duration)}</span>
        </div>

        <div className="lg-controls-row" data-tauri-drag-region>
          <button
            type="button"
            className={`lg-glass-btn ${state.isFavorite ? 'is-liked' : ''}`}
            onClick={() => track && void emit('widget-toggle-favorite', track.id)}
            disabled={!track}
            title="Нравится"
          >
            <Heart
              size={15}
              fill={state.isFavorite ? '#ff4d79' : 'none'}
            />
          </button>

          <div className="lg-transport-group">
            <button
              type="button"
              className="lg-glass-btn"
              onClick={() => void emit('media-control', 'previous')}
              title="Предыдущий трек"
            >
              <SkipBack size={15} />
            </button>

            <button
              type="button"
              className="lg-play-btn"
              onClick={() => void emit('media-control', 'toggle')}
              title={state.isPlaying ? 'Пауза' : 'Играть'}
            >
              {state.isPlaying ? (
                <Pause size={17} fill="#12141c" />
              ) : (
                <Play size={17} fill="#12141c" style={{ marginLeft: 2 }} />
              )}
            </button>

            <button
              type="button"
              className="lg-glass-btn"
              onClick={() => void emit('media-control', 'next')}
              title="Следующий трек"
            >
              <SkipForward size={15} />
            </button>
          </div>

          <span className="lg-brand-chip" data-tauri-drag-region>
            Abyss
          </span>
        </div>

        <div
          className="lg-resize-handle"
          onPointerDown={handleResizePointerDown}
          title="Изменить размер"
        />
      </div>
    </div>
  );
};
