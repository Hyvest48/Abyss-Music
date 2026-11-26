import React, { useState } from 'react';
import { convertFileSrc } from '@tauri-apps/api/core';
import { Heart, Music, Clock, Play } from 'lucide-react';
import { TrackItem, getCoverGradient } from '../shared/models';

interface TrackListProps {
  tracks: TrackItem[];
  currentTrackId: string | null;
  isPlaying: boolean;
  onSelectTrack: (track: TrackItem) => void;
  onToggleFavorite: (trackId: string) => void;
  onSelectArtist?: (artist: string) => void;
  onSelectAlbum?: (album: string) => void;
}

export function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function resolveCoverSrc(coverUrl?: string): string | null {
  if (!coverUrl) return null;
  if (
    coverUrl.startsWith('http://') ||
    coverUrl.startsWith('https://') ||
    coverUrl.startsWith('data:') ||
    coverUrl.startsWith('asset:')
  ) {
    return coverUrl;
  }
  return convertFileSrc(coverUrl);
}

const TrackMiniCover: React.FC<{ track: TrackItem }> = ({ track }) => {
  const [hasError, setHasError] = useState(false);
  const src = resolveCoverSrc(track.coverUrl);

  if (src && !hasError) {
    return (
      <img
        src={src}
        alt={track.title}
        className="track-mini-cover"
        style={{ objectFit: 'cover' }}
        loading="lazy"
        decoding="async"
        onError={() => setHasError(true)}
      />
    );
  }

  return (
    <div
      className="track-mini-cover"
      style={{ background: getCoverGradient(track.id) }}
    >
      <Music size={15} />
    </div>
  );
};

export const TrackList: React.FC<TrackListProps> = ({
  tracks,
  currentTrackId,
  isPlaying,
  onSelectTrack,
  onToggleFavorite,
  onSelectArtist,
  onSelectAlbum,
}) => {
  return (
    <table className="track-table">
      <thead>
        <tr>
          <th style={{ width: 46, textAlign: 'center' }}>#</th>
          <th>Название</th>
          <th>Альбом</th>
          <th style={{ width: 72 }}>
            <Clock size={14} />
          </th>
          <th style={{ width: 48 }} />
        </tr>
      </thead>
      <tbody>
        {tracks.map((track, idx) => {
          const isCurrent = track.id === currentTrackId;
          return (
            <tr
              key={track.id}
              className={`track-row ${isCurrent ? 'active' : ''}`}
              onClick={() => onSelectTrack(track)}
            >
              <td className="tabular-time">
                <div className="track-index-wrap">
                  {isCurrent && isPlaying ? (
                    <div className="eq-bars">
                      <span />
                      <span />
                      <span />
                    </div>
                  ) : (
                    <>
                      <span className="track-num">{idx + 1}</span>
                      <span className="track-hover-play">
                        <Play size={14} fill="#ffffff" />
                      </span>
                    </>
                  )}
                </div>
              </td>

              <td>
                <div className="track-title-cell">
                  <TrackMiniCover track={track} />
                  <div>
                    <div className="track-name">{track.title}</div>
                    <div
                      className={`track-artist ${onSelectArtist ? 'clickable-meta' : ''}`}
                      onClick={(e) => {
                        if (!onSelectArtist) return;
                        e.stopPropagation();
                        onSelectArtist(track.artist);
                      }}
                    >
                      {track.artist}
                    </div>
                  </div>
                </div>
              </td>

              <td
                style={{ color: 'rgba(255, 255, 255, 0.56)' }}
                className={onSelectAlbum ? 'clickable-meta' : ''}
                onClick={(e) => {
                  if (!onSelectAlbum) return;
                  e.stopPropagation();
                  onSelectAlbum(track.album);
                }}
              >
                {track.album}
              </td>

              <td className="tabular-time">{formatDuration(track.durationSeconds)}</td>

              <td onClick={(e) => e.stopPropagation()}>
                <button
                  type="button"
                  className="icon-ghost-btn"
                  onClick={() => onToggleFavorite(track.id)}
                >
                  <Heart
                    size={16}
                    fill={track.isFavorite ? '#ffffff' : 'none'}
                    color="#ffffff"
                  />
                </button>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
};