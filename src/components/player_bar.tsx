import React, { useRef, useState } from 'react';
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Shuffle,
  Repeat,
  Heart,
  Volume2,
  VolumeX,
  ListMusic,
  Music,
} from 'lucide-react';
import { TrackItem, getCoverGradient } from '../shared/models';
import { formatDuration } from './track_list';

interface SmoothSliderProps {
  value: number;
  max: number;
  onChange: (value: number) => void;
  commitOnRelease?: boolean;
  onDragPreview?: (value: number | null) => void;
  disabled?: boolean;
  className?: string;
}

const SmoothSlider: React.FC<SmoothSliderProps> = ({
  value,
  max,
  onChange,
  commitOnRelease = false,
  onDragPreview,
  disabled = false,
  className = '',
}) => {
  const trackRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragValue, setDragValue] = useState<number | null>(null);

  const calcValueFromClientX = (clientX: number) => {
    const el = trackRef.current;
    if (!el || max <= 0) return 0;
    const rect = el.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    return ratio * max;
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (disabled || max <= 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);

    const next = calcValueFromClientX(e.clientX);
    setIsDragging(true);
    setDragValue(next);
    onDragPreview?.(next);

    if (!commitOnRelease) {
      onChange(next);
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDragging) return;
    const next = calcValueFromClientX(e.clientX);
    setDragValue(next);
    onDragPreview?.(next);

    if (!commitOnRelease) {
      onChange(next);
    }
  };

  const finishDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDragging) return;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }

    const finalValue = calcValueFromClientX(e.clientX);
    setIsDragging(false);
    setDragValue(null);
    onDragPreview?.(null);

    if (commitOnRelease) {
      onChange(finalValue);
    }
  };

  const displayedValue = isDragging && dragValue !== null ? dragValue : value;
  const percent = max > 0 ? Math.min(100, Math.max(0, (displayedValue / max) * 100)) : 0;

  return (
    <div
      ref={trackRef}
      role="slider"
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={Math.round(displayedValue)}
      className={`slider-track ${isDragging ? 'is-dragging' : ''} ${disabled ? 'is-disabled' : ''} ${className}`}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={finishDrag}
      onPointerCancel={finishDrag}
    >
      <div className="slider-fill" style={{ width: `${percent}%` }}>
        <span className="slider-thumb" />
      </div>
    </div>
  );
};

interface PlayerBarProps {
  currentTrack: TrackItem | null;
  isPlaying: boolean;
  isShuffle: boolean;
  isRepeat: boolean;
  isQueueOpen: boolean;
  isMuted: boolean;
  positionSec: number;
  volume: number;
  onTogglePlay: () => void;
  onToggleShuffle: () => void;
  onToggleRepeat: () => void;
  onToggleQueue: () => void;
  onToggleMute: () => void;
  onPrev: () => void;
  onNext: () => void;
  onSeek: (sec: number) => void;
  onVolumeChange: (val: number) => void;
  onToggleFavorite: (trackId: string) => void;
}

export const PlayerBar: React.FC<PlayerBarProps> = ({
  currentTrack,
  isPlaying,
  isShuffle,
  isRepeat,
  isQueueOpen,
  isMuted,
  positionSec,
  volume,
  onTogglePlay,
  onToggleShuffle,
  onToggleRepeat,
  onToggleQueue,
  onToggleMute,
  onPrev,
  onNext,
  onSeek,
  onVolumeChange,
  onToggleFavorite,
}) => {
  const [previewSec, setPreviewSec] = useState<number | null>(null);

  const duration = currentTrack?.durationSeconds ?? 0;
  const displayedTime = previewSec ?? positionSec;
  const effectiveVolume = isMuted ? 0 : volume;

  return (
    <footer className="player-dock">
      <div className="player-track-info">
        {currentTrack?.coverUrl ? (
          <img
            src={currentTrack.coverUrl}
            alt={currentTrack.title}
            className="track-mini-cover"
          />
        ) : (
          <div
            className="track-mini-cover"
            style={{
              background: currentTrack
                ? getCoverGradient(currentTrack.id)
                : 'rgba(255,255,255,0.12)',
            }}
          >
            <Music size={17} />
          </div>
        )}

        {currentTrack ? (
          <>
            <div style={{ minWidth: 0 }}>
              <div className="track-name recent-card-title">{currentTrack.title}</div>
              <div className="track-artist recent-card-title">{currentTrack.artist}</div>
            </div>
            <button
              type="button"
              className="icon-ghost-btn"
              onClick={() => onToggleFavorite(currentTrack.id)}
              title={currentTrack.isFavorite ? 'Убрать из избранного' : 'В избранное'}
            >
              <Heart
                size={16}
                fill={currentTrack.isFavorite ? '#ffffff' : 'none'}
                color="#ffffff"
              />
            </button>
          </>
        ) : (
          <div className="track-artist">Трек не выбран</div>
        )}
      </div>

      <div className="player-center">
        <div className="player-buttons">
          <button
            type="button"
            className={`icon-ghost-btn ${isShuffle ? 'is-active' : ''}`}
            onClick={onToggleShuffle}
            title="Перемешать"
          >
            <Shuffle size={15} />
          </button>

          <button type="button" className="icon-ghost-btn" onClick={onPrev} title="Назад">
            <SkipBack size={18} />
          </button>

          <button
            type="button"
            className="player-play-circle"
            onClick={onTogglePlay}
            title={isPlaying ? 'Пауза' : 'Играть'}
          >
            {isPlaying ? (
              <Pause size={16} fill="#141416" />
            ) : (
              <Play size={16} fill="#141416" style={{ marginLeft: 2 }} />
            )}
          </button>

          <button type="button" className="icon-ghost-btn" onClick={onNext} title="Вперёд">
            <SkipForward size={18} />
          </button>

          <button
            type="button"
            className={`icon-ghost-btn ${isRepeat ? 'is-active' : ''}`}
            onClick={onToggleRepeat}
            title="Повтор"
          >
            <Repeat size={15} />
          </button>
        </div>

        <div className="progress-row">
          <span className="tabular-time" style={{ fontSize: 11 }}>
            {formatDuration(Math.floor(displayedTime))}
          </span>
          <SmoothSlider
            value={positionSec}
            max={duration}
            commitOnRelease={true}
            onDragPreview={setPreviewSec}
            onChange={(val) => onSeek(Math.floor(val))}
            disabled={!currentTrack || duration <= 0}
          />
          <span className="tabular-time" style={{ fontSize: 11 }}>
            {formatDuration(duration)}
          </span>
        </div>
      </div>

      <div className="player-right">
        <button
          type="button"
          className={`icon-ghost-btn ${isQueueOpen ? 'is-active' : ''}`}
          onClick={onToggleQueue}
          title="Очередь воспроизведения"
        >
          <ListMusic size={17} />
        </button>

        <button
          type="button"
          className="icon-ghost-btn"
          onClick={onToggleMute}
          title={effectiveVolume === 0 ? 'Включить звук' : 'Выключить звук'}
        >
          {effectiveVolume === 0 ? <VolumeX size={17} /> : <Volume2 size={17} />}
        </button>

        <SmoothSlider
          value={effectiveVolume}
          max={1}
          onChange={(val) => onVolumeChange(Number(val.toFixed(2)))}
          className="volume-slider"
        />
      </div>
    </footer>
  );
};