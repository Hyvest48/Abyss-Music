import React, { useRef } from 'react';
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
  const progressRef = useRef<HTMLDivElement>(null);
  const volumeRef = useRef<HTMLDivElement>(null);

  const duration = currentTrack?.durationSeconds ?? 0;
  const progressPercent = duration > 0 ? Math.min(100, (positionSec / duration) * 100) : 0;
  const effectiveVolume = isMuted ? 0 : volume;

  const handleProgressClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!progressRef.current || duration <= 0) return;
    const rect = progressRef.current.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    onSeek(Math.floor(ratio * duration));
  };

  const handleVolumeClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!volumeRef.current) return;
    const rect = volumeRef.current.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    onVolumeChange(Number(ratio.toFixed(2)));
  };

  return (
    <footer className="player-dock">
      <div className="player-track-info">
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
            {formatDuration(positionSec)}
          </span>
          <div
            ref={progressRef}
            className="slider-track"
            onClick={handleProgressClick}
          >
            <div className="slider-fill" style={{ width: `${progressPercent}%` }}>
              <span className="slider-thumb" />
            </div>
          </div>
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

        <div
          ref={volumeRef}
          className="slider-track"
          style={{ maxWidth: 100 }}
          onClick={handleVolumeClick}
        >
          <div className="slider-fill" style={{ width: `${effectiveVolume * 100}%` }}>
            <span className="slider-thumb" />
          </div>
        </div>
      </div>
    </footer>
  );
};