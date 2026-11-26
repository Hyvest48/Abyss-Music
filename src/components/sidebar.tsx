import React, { useState } from 'react';
import { Home, Heart, Palette, Plus, FolderPlus, Music, LogIn, LogOut, UserCheck, Pencil, Trash2 } from 'lucide-react';
import { PlaylistItem, getCoverGradient } from '../shared/models';
import { YandexAuthStatus } from '../services/tauri_api';

export type NavTab = 'home' | 'search' | 'favorites' | 'playlist';

interface SidebarProps {
  activeTab: NavTab;
  activePlaylistId: string | null;
  playlists: PlaylistItem[];
  yandexAuth: YandexAuthStatus;
  onSelectTab: (tab: NavTab) => void;
  onSelectPlaylist: (playlistId: string) => void;
  onCreatePlaylist: () => void;
  onRenamePlaylist: (playlistId: string, newName: string) => void;
  onDeletePlaylist: (playlistId: string) => void;
  onScanFolder: () => void;
  onOpenThemes: () => void;
  onYandexLogin: () => void;
  onYandexLogout: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  activeTab,
  activePlaylistId,
  playlists,
  yandexAuth,
  onSelectTab,
  onSelectPlaylist,
  onCreatePlaylist,
  onRenamePlaylist,
  onDeletePlaylist,
  onScanFolder,
  onOpenThemes,
  onYandexLogin,
  onYandexLogout,
}) => {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');

  const formatAccountName = (name: string | null) => {
    if (!name) return 'Яндекс Плюс';
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) {
      return `${parts[0]} ${parts[1][0].toUpperCase()}.`;
    }
    return name;
  };

  const commitRename = (id: string) => {
    const trimmed = editingName.trim();
    if (trimmed) {
      onRenamePlaylist(id, trimmed);
    }
    setEditingId(null);
  };
  return (
    <aside className="sidebar">
      <div className="brand-block" onClick={() => onSelectTab('home')} style={{ cursor: 'pointer' }}>
        <div className="brand-title">ABYSS</div>
        <div className="brand-subtitle">MUSIC</div>
      </div>

      <nav className="nav-list">
        <button
          type="button"
          className={`nav-pill ${activeTab === 'home' ? 'active' : ''}`}
          onClick={() => onSelectTab('home')}
        >
          <span className="nav-pill-icon">
            <Home size={16} />
          </span>
          <span>Главная</span>
        </button>

        <button
          type="button"
          className={`nav-pill ${activeTab === 'favorites' ? 'active' : ''}`}
          onClick={() => onSelectTab('favorites')}
        >
          <span className="nav-pill-icon">
            <Heart size={16} />
          </span>
          <span>Мне нравится</span>
        </button>

        <button type="button" className="nav-pill" onClick={onOpenThemes}>
          <span className="nav-pill-icon">
            <Palette size={16} />
          </span>
          <span>Темы</span>
        </button>

        {yandexAuth.isAuthorized ? (
          <div
            className="nav-pill"
            style={{ justifyContent: 'space-between', cursor: 'default', gap: 8 }}
            title={yandexAuth.accountName || 'Аккаунт Яндекс Музыки подключён'}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, flex: 1 }}>
              <span
                className="nav-pill-icon"
                style={{ color: 'var(--accent-warm)', position: 'static', flexShrink: 0 }}
              >
                <UserCheck size={16} />
              </span>
              <span
                style={{
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  minWidth: 0,
                }}
              >
                {formatAccountName(yandexAuth.accountName)}
              </span>
            </div>
            <button
              type="button"
              className="icon-ghost-btn"
              style={{ flexShrink: 0 }}
              onClick={onYandexLogout}
              title="Выйти из Яндекс ID"
            >
              <LogOut size={14} />
            </button>
          </div>
        ) : (
          <button
            type="button"
            className="nav-pill"
            onClick={onYandexLogin}
            title="Подключить Яндекс Музыку"
          >
            <span className="nav-pill-icon" style={{ color: '#fc3f1d' }}>
              <LogIn size={16} />
            </span>
            <span>Войти в Яндекс</span>
          </button>
        )}
      </nav>

      <div className="collection-section">
        <div className="collection-header">
          <span className="collection-title">Коллекция</span>
          <div className="collection-actions">
            <button
              type="button"
              className="icon-ghost-btn"
              onClick={onScanFolder}
              title="Добавить папку с музыкой"
            >
              <FolderPlus size={16} />
            </button>
            <button
              type="button"
              className="icon-ghost-btn"
              onClick={onCreatePlaylist}
              title="Создать плейлист"
            >
              <Plus size={17} />
            </button>
          </div>
        </div>

        <div className="playlist-scroll">
          {playlists.map((pl) => {
            const isActive = activeTab === 'playlist' && activePlaylistId === pl.id;
            const isEditing = editingId === pl.id;
            return (
              <div
                key={pl.id}
                className={`playlist-row ${isActive ? 'active' : ''}`}
                onClick={() => !isEditing && onSelectPlaylist(pl.id)}
                role="button"
                tabIndex={0}
              >
                <div
                  className="playlist-cover-stub"
                  style={{ background: getCoverGradient(pl.id) }}
                >
                  <Music size={16} />
                </div>
                {isEditing ? (
                  <input
                    className="playlist-rename-input"
                    value={editingName}
                    autoFocus
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => setEditingName(e.target.value)}
                    onBlur={() => commitRename(pl.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commitRename(pl.id);
                      if (e.key === 'Escape') setEditingId(null);
                    }}
                  />
                ) : (
                  <>
                    <span
                      className="recent-card-title shimmer-text"
                      onDoubleClick={(e) => {
                        e.stopPropagation();
                        setEditingId(pl.id);
                        setEditingName(pl.name);
                      }}
                    >
                      {pl.name}
                    </span>
                    <div className="playlist-row-actions">
                      <button
                        type="button"
                        className="icon-ghost-btn"
                        title="Переименовать"
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditingId(pl.id);
                          setEditingName(pl.name);
                        }}
                      >
                        <Pencil size={13} />
                      </button>
                      <button
                        type="button"
                        className="icon-ghost-btn"
                        title="Удалить плейлист"
                        onClick={(e) => {
                          e.stopPropagation();
                          onDeletePlaylist(pl.id);
                        }}
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </aside>
  );
};