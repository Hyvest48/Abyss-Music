import React from 'react';
import { Home, Heart, Palette, Plus, FolderPlus, Music, LogIn, LogOut, UserCheck } from 'lucide-react';
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
  onScanFolder,
  onOpenThemes,
  onYandexLogin,
  onYandexLogout,
}) => {
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
            style={{ justifyContent: 'space-between', cursor: 'default' }}
            title="Аккаунт Яндекс Музыки подключён"
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
              <span className="nav-pill-icon" style={{ color: 'var(--accent-warm)' }}>
                <UserCheck size={16} />
              </span>
              <span
                style={{
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {yandexAuth.accountName || 'Яндекс Плюс'}
              </span>
            </div>
            <button
              type="button"
              className="icon-ghost-btn"
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
            return (
              <button
                key={pl.id}
                type="button"
                className={`playlist-row ${isActive ? 'active' : ''}`}
                onClick={() => onSelectPlaylist(pl.id)}
              >
                <div
                  className="playlist-cover-stub"
                  style={{ background: getCoverGradient(pl.id) }}
                >
                  <Music size={16} />
                </div>
                <span className="recent-card-title shimmer-text">{pl.name}</span>
              </button>
            );
          })}
        </div>
      </div>
    </aside>
  );
};