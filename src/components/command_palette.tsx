import React, { useEffect, useMemo, useState } from 'react';
import { Search, Music, Play, SlidersHorizontal, Heart, Home } from 'lucide-react';
import { TrackItem } from '../shared/models';

interface CommandPaletteProps {
  isOpen: boolean;
  tracks: TrackItem[];
  onClose: () => void;
  onSelectTrack: (track: TrackItem) => void;
  onStartWave: () => void;
  onNavigate: (tab: 'home' | 'search' | 'favorites') => void;
}

export const CommandPalette: React.FC<CommandPaletteProps> = ({
  isOpen,
  tracks,
  onClose,
  onSelectTrack,
  onStartWave,
  onNavigate,
}) => {
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (isOpen) setQuery('');
  }, [isOpen]);

  const filteredTracks = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return tracks.slice(0, 6);
    return tracks
      .filter(
        (t) =>
          t.title.toLowerCase().includes(q) || t.artist.toLowerCase().includes(q)
      )
      .slice(0, 8);
  }, [query, tracks]);

  if (!isOpen) return null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="cmd-card" onClick={(e) => e.stopPropagation()}>
        <div className="cmd-input-row">
          <Search size={18} className="cmd-icon" />
          <input
            type="text"
            className="cmd-input"
            placeholder="Быстрый переход к треку или действию..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
          />
          <kbd className="cmd-kbd">ESC</kbd>
        </div>

        <div className="cmd-list">
          <div className="cmd-group-label">Быстрые действия</div>
          <button
            className="cmd-item"
            onClick={() => {
              onStartWave();
              onClose();
            }}
          >
            <SlidersHorizontal size={16} />
            <span>Запустить «Мою волну»</span>
          </button>
          <button
            className="cmd-item"
            onClick={() => {
              onNavigate('home');
              onClose();
            }}
          >
            <Home size={16} />
            <span>Главная</span>
          </button>
          <button
            className="cmd-item"
            onClick={() => {
              onNavigate('favorites');
              onClose();
            }}
          >
            <Heart size={16} />
            <span>Мне нравится</span>
          </button>

          {filteredTracks.length > 0 && (
            <>
              <div className="cmd-group-label" style={{ marginTop: 12 }}>
                Треки
              </div>
              {filteredTracks.map((track) => (
                <button
                  key={track.id}
                  className="cmd-item"
                  onClick={() => {
                    onSelectTrack(track);
                    onClose();
                  }}
                >
                  {track.coverUrl ? (
                    <img src={track.coverUrl} alt="" className="cmd-thumb" />
                  ) : (
                    <div className="cmd-thumb">
                      <Music size={14} />
                    </div>
                  )}
                  <div className="recent-card-text" style={{ flex: 1 }}>
                    <span className="track-name" style={{ fontSize: 13.5 }}>
                      {track.title}
                    </span>
                    <span className="track-artist">{track.artist}</span>
                  </div>
                  <Play size={14} style={{ opacity: 0.5 }} />
                </button>
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  );
};