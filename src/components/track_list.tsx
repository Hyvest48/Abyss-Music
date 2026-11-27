import React, { useEffect, useState } from 'react';
import { Heart, Music, Clock, Play, ListPlus, Trash2 } from 'lucide-react';
import { TrackItem, getCoverGradient, resolveCoverSrc } from '../shared/models';

interface TrackListProps {
  tracks: TrackItem[];
  currentTrackId: string | null;
  isPlaying: boolean;
  onSelectTrack: (track: TrackItem) => void;
  onToggleFavorite: (trackId: string, track?: TrackItem) => void;
  onAddToPlaylist?: (track: TrackItem) => void;
  onRemoveFromPlaylist?: (track: TrackItem) => void;
  onSelectArtist?: (artistName: string) => void;
  onSelectAlbum?: (albumName: string) => void;
}

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

const TrackMiniCover: React.FC<{ track: TrackItem }> = ({ track }) => {
  const [hasError, setHasError] = useState(false);
  const src = resolveCoverSrc(track.coverUrl);

  useEffect(() => {
    setHasError(false);
  }, [src]);

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

export const TrackList: React.FC<TrackListProps> = React.memo(({
  tracks,
  currentTrackId,
  isPlaying,
  onSelectTrack,
  onToggleFavorite,
  onAddToPlaylist,
  onRemoveFromPlaylist,
  onSelectArtist,
  onSelectAlbum,
}) => {
  const renderArtists = (rawArtist: string) => {
    if (!onSelectArtist) {
      return <div className="track-artist">{rawArtist}</div>;
    }

    const parts = rawArtist
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    return (
      <div className="track-artist" onClick={(e) => e.stopPropagation()}>
        {parts.map((name, index) => (
          <React.Fragment key={`${name}-${index}`}>
            {index > 0 && ', '}
            <span
              onClick={() => onSelectArtist(name)}
              style={{ cursor: 'pointer' }}
              onMouseEnter={(e) => {
                e.currentTarget.style.textDecoration = 'underline';
                e.currentTarget.style.color = '#ffffff';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.textDecoration = 'none';
                e.currentTarget.style.color = '';
              }}
              title={`Открыть карточку: ${name}`}
            >
              {name}
            </span>
          </React.Fragment>
        ))}
      </div>
    );
  };

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
          <th style={{ width: onAddToPlaylist || onRemoveFromPlaylist ? 92 : 48 }} />
        </tr>
      </thead>
      <tbody>
        {tracks.map((track, idx) => {
          const isCurrent = track.id === currentTrackId;
          const canOpenAlbum =
            Boolean(onSelectAlbum) &&
            track.album &&
            track.album !== 'Яндекс Музыка' &&
            track.album !== 'Локальная медиатека';

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
                    {renderArtists(track.artist)}
                  </div>
                </div>
              </td>

              <td
                style={{ color: 'rgba(255, 255, 255, 0.56)' }}
                onClick={(e) => {
                  if (canOpenAlbum && onSelectAlbum) {
                    e.stopPropagation();
                    onSelectAlbum(track.album);
                  }
                }}
              >
                {canOpenAlbum ? (
                  <span
                    style={{ cursor: 'pointer' }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.textDecoration = 'underline';
                      e.currentTarget.style.color = '#ffffff';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.textDecoration = 'none';
                      e.currentTarget.style.color = '';
                    }}
                  >
                    {track.album}
                  </span>
                ) : (
                  track.album
                )}
              </td>

              <td className="tabular-time">{formatDuration(track.durationSeconds)}</td>

              <td onClick={(e) => e.stopPropagation()}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6 }}>
                  {onAddToPlaylist && (
                    <button
                      type="button"
                      className="icon-ghost-btn"
                      onClick={() => onAddToPlaylist(track)}
                      title="Добавить в плейлист"
                    >
                      <ListPlus size={16} />
                    </button>
                  )}
                  {onRemoveFromPlaylist && (
                    <button
                      type="button"
                      className="icon-ghost-btn"
                      onClick={() => onRemoveFromPlaylist(track)}
                      title="Убрать из плейлиста"
                    >
                      <Trash2 size={15} />
                    </button>
                  )}
                  <button
                    type="button"
                    className="icon-ghost-btn"
                    onClick={() => onToggleFavorite(track.id, track)}
                    title={track.isFavorite ? 'Убрать из избранного' : 'В избранное'}
                  >
                    <Heart
                      size={16}
                      fill={track.isFavorite ? '#ffffff' : 'none'}
                      color="#ffffff"
                    />
                  </button>
                </div>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
});