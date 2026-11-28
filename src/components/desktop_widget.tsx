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
  const [isAltPressed, setIsAltPressed] = useState(false);
  const [isDraggingSeek, setIsDraggingSeek] = useState(false);
  const [dragSeekSec, setDragSeekSec] = useState<number | null>(null);
  const trackBarRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    active: boolean;
    pointerId: number;
    startMouseX: number;
    startMouseY: number;
    startWinX: number;
    startWinY: number;
    targetX: number;
    targetY: number;
    curX: number;
    curY: number;
    lastSentX: number;
    lastSentY: number;
    inFlight: boolean;
    rafId: number;
  }>({
    active: false,
    pointerId: -1,
    startMouseX: 0,
    startMouseY: 0,
    startWinX: 0,
    startWinY: 0,
    targetX: 0,
    targetY: 0,
    curX: 0,
    curY: 0,
    lastSentX: 0,
    lastSentY: 0,
    inFlight: false,
    rafId: 0,
  });

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Alt') setIsAltPressed(true);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Alt') setIsAltPressed(false);
    };
    const onBlur = () => setIsAltPressed(false);

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      if (dragRef.current.rafId) {
        cancelAnimationFrame(dragRef.current.rafId);
      }
    };
  }, []);

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

  const handleCardPointerDown = async (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || !e.altKey) return;
    const target = e.target as HTMLElement;
    if (target.closest('button, [role="slider"], .lg-resize-handle')) {
      return;
    }
    e.preventDefault();
    const cardEl = e.currentTarget;
    cardEl.setPointerCapture(e.pointerId);

    const dpr = window.devicePixelRatio || 1;
    const startMouseX = e.screenX * dpr;
    const startMouseY = e.screenY * dpr;

    try {
      const [winX, winY] = await invoke<[number, number]>('get_desktop_widget_pos');
      const d = dragRef.current;
      d.active = true;
      d.pointerId = e.pointerId;
      d.startMouseX = startMouseX;
      d.startMouseY = startMouseY;
      d.startWinX = winX;
      d.startWinY = winY;
      d.targetX = winX;
      d.targetY = winY;
      d.curX = winX;
      d.curY = winY;
      d.lastSentX = winX;
      d.lastSentY = winY;

      if (!d.rafId) {
        let lastTime = performance.now();
        const step = (now: number) => {
          const dt = Math.min(0.05, Math.max(0.001, (now - lastTime) / 1000));
          lastTime = now;

          const lerp = 1 - Math.exp(-26 * dt);
          const prevCurX = d.curX;
          const prevCurY = d.curY;
          d.curX += (d.targetX - d.curX) * lerp;
          d.curY += (d.targetY - d.curY) * lerp;

          const vx = d.curX - prevCurX;
          const vy = d.curY - prevCurY;
          const speed = Math.hypot(vx, vy);

          if (cardRef.current) {
            if (speed > 0.35) {
              const blur = Math.min(1.4, speed * 0.04).toFixed(2);
              cardRef.current.style.filter = `blur(${blur}px)`;
            } else if (cardRef.current.style.filter) {
              cardRef.current.style.filter = '';
            }
          }

          const rx = Math.round(d.curX);
          const ry = Math.round(d.curY);
          if ((rx !== d.lastSentX || ry !== d.lastSentY) && !d.inFlight) {
            d.inFlight = true;
            d.lastSentX = rx;
            d.lastSentY = ry;
            void invoke('move_desktop_widget', { x: rx, y: ry }).finally(() => {
              d.inFlight = false;
            });
          }

          const dist = Math.hypot(d.targetX - d.curX, d.targetY - d.curY);
          if (d.active || dist > 0.4) {
            d.rafId = requestAnimationFrame(step);
          } else {
            if (cardRef.current) cardRef.current.style.filter = '';
            d.rafId = 0;
          }
        };
        d.rafId = requestAnimationFrame(step);
      }
    } catch {
      void getCurrentWindow().startDragging();
    }
  };

  const handleCardPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d.active) return;
    const dpr = window.devicePixelRatio || 1;
    d.targetX = d.startWinX + (e.screenX * dpr - d.startMouseX);
    d.targetY = d.startWinY + (e.screenY * dpr - d.startMouseY);
  };

  const handleCardPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d.active) return;
    d.active = false;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
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
        ref={cardRef}
        className={`lg-widget-card ${isClosing ? 'is-closing' : ''}`}
        onPointerDown={handleCardPointerDown}
        onPointerMove={handleCardPointerMove}
        onPointerUp={handleCardPointerUp}
        onPointerCancel={handleCardPointerUp}
      >
        <div
          className="lg-ambient-orb"
          style={{ background: state.accentColor || '#9b7dff' }}
        />
        <div
          className="lg-ambient-orb-secondary"
          style={{ background: state.accentSecondary || '#4cc9f0' }}
        />

        <div className="lg-top-row">
          <div className={`lg-cover-wrap ${state.isPlaying ? 'is-playing' : ''}`}>
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
          </div>

          <div className="lg-meta">
            <div className="lg-title">
              {track ? track.title : 'Abyss Music'}
            </div>
            <div className="lg-artist">
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

        <div className="lg-controls-row">
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

          <div className="lg-right-group">
            {track && (
              <div
                className={`lg-eq-badge ${state.isPlaying ? '' : 'is-paused'}`}
                title={state.isPlaying ? 'Воспроизведение' : 'Пауза'}
              >
                <span className="lg-eq-bar" />
                <span className="lg-eq-bar" />
                <span className="lg-eq-bar" />
              </div>
            )}
            <span className="lg-brand-chip">
              Abyss
            </span>
          </div>
        </div>

        <div className="lg-alt-hint">Зажми ALT для переноса</div>

        {isAltPressed && (
          <div
            className="lg-resize-handle"
            onPointerDown={handleResizePointerDown}
            title="Изменить размер"
          />
        )}
      </div>
    </div>
  );
};
