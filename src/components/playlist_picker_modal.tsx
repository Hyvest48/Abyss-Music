import React, { useState } from 'react';
import { Check, ListPlus, Music, Plus, X } from 'lucide-react';
import { PlaylistItem, TrackItem, getCoverGradient, resolveCoverSrc } from '../shared/models';

interface PlaylistPickerModalProps {
  track: TrackItem | null;
  playlists: PlaylistItem[];
  onClose: () => void;
  onAddTrack: (playlistId: string, track: TrackItem) => Promise<void> | void;
  onCreateAndAdd: (name: string, track: TrackItem) => Promise<void> | void;
}

export const PlaylistPickerModal: React.FC<PlaylistPickerModalProps> = ({
  track,
  playlists,
  onClose,
  onAddTrack,
  onCreateAndAdd,
}) => {
  const [newName, setNewName] = useState('');
  const [isBusy, setIsBusy] = useState(false);

  if (!track) return null;

  const coverSrc = resolveCoverSrc(track.coverUrl);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newName.trim();
    if (!trimmed || isBusy) return;
    setIsBusy(true);
    try {
      await onCreateAndAdd(trimmed, track);
      setNewName('');
      onClose();
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="wave-modal-card"
        style={{ maxWidth: 440, width: '100%' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="queue-header" style={{ marginBottom: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <ListPlus size={18} style={{ color: 'var(--accent-warm)' }} />
            <span className="section-heading shimmer-text" style={{ fontSize: 18 }}>
              Добавить в плейлист
            </span>
          </div>
          <button type="button" className="icon-ghost-btn" onClick={onClose} title="Закрыть">
            <X size={18} />
          </button>
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: '10px 12px',
            borderRadius: 14,
            background: 'rgba(255,255,255,0.04)',
            border: '1px solid rgba(255,255,255,0.07)',
            marginBottom: 16,
          }}
        >
          {coverSrc ? (
            <img
              src={coverSrc}
              alt={track.title}
              className="track-mini-cover"
              style={{ objectFit: 'cover' }}
            />
          ) : (
            <div
              className="track-mini-cover"
              style={{ background: getCoverGradient(track.id) }}
            >
              <Music size={15} />
            </div>
          )}
          <div style={{ minWidth: 0, flex: 1 }}>
            <div
              className="track-name"
              style={{
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {track.title}
            </div>
            <div
              className="track-artist"
              style={{
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {track.artist}
            </div>
          </div>
        </div>

        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
            maxHeight: 230,
            overflowY: 'auto',
            marginBottom: 14,
          }}
        >
          {playlists.length === 0 ? (
            <div className="track-artist" style={{ textAlign: 'center', padding: '16px 0' }}>
              Пока нет ни одного плейлиста — создай ниже
            </div>
          ) : (
            playlists.map((pl) => {
              const alreadyAdded = pl.trackIds.includes(track.id);
              return (
                <button
                  key={pl.id}
                  type="button"
                  className={`playlist-row ${alreadyAdded ? 'active' : ''}`}
                  style={{ width: '100%', justifyContent: 'space-between' }}
                  disabled={isBusy}
                  onClick={async () => {
                    if (alreadyAdded) {
                      onClose();
                      return;
                    }
                    setIsBusy(true);
                    try {
                      await onAddTrack(pl.id, track);
                      onClose();
                    } finally {
                      setIsBusy(false);
                    }
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                    <div
                      className="playlist-cover-stub"
                      style={{ background: getCoverGradient(pl.id) }}
                    >
                      <Music size={14} />
                    </div>
                    <div style={{ textAlign: 'left', minWidth: 0 }}>
                      <div className="track-name" style={{ fontSize: 13.5 }}>
                        {pl.name}
                      </div>
                      <div className="track-artist" style={{ fontSize: 11.5 }}>
                        Треков: {pl.trackIds.length}
                      </div>
                    </div>
                  </div>
                  {alreadyAdded ? (
                    <Check size={16} style={{ color: 'var(--accent-warm)', flexShrink: 0 }} />
                  ) : (
                    <Plus size={16} style={{ opacity: 0.65, flexShrink: 0 }} />
                  )}
                </button>
              );
            })
          )}
        </div>

        <form onSubmit={handleCreate} style={{ display: 'flex', gap: 8 }}>
          <input
            type="text"
            className="playlist-rename-input"
            style={{
              flex: 1,
              padding: '9px 12px',
              borderRadius: 12,
              background: 'rgba(255,255,255,0.06)',
              border: '1px solid rgba(255,255,255,0.1)',
            }}
            placeholder="Новый плейлист..."
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
          />
          <button
            type="submit"
            className="btn-primary-pill"
            style={{ padding: '8px 16px', fontSize: 13 }}
            disabled={!newName.trim() || isBusy}
          >
            Создать
          </button>
        </form>
      </div>
    </div>
  );
};
