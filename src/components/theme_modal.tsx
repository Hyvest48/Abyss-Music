import React from 'react';
import { X, Check, Moon } from 'lucide-react';
import { THEME_PRESETS, ThemePreset } from '../shared/themes';

interface ThemeModalProps {
  isOpen: boolean;
  currentThemeId: string;
  isNightMode: boolean;
  onToggleNightMode: () => void;
  onSelectTheme: (theme: ThemePreset) => void;
  onClose: () => void;
}

export const ThemeModal: React.FC<ThemeModalProps> = ({
  isOpen,
  currentThemeId,
  isNightMode,
  onToggleNightMode,
  onSelectTheme,
  onClose,
}) => {
  if (!isOpen) return null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card theme-modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h2 className="modal-title shimmer-text">Темы оформления</h2>
            <p className="track-artist" style={{ marginTop: 4 }}>
              20 пресетов — мгновенное переключение
            </p>
          </div>
          <button className="icon-ghost-btn" onClick={onClose} title="Закрыть">
            <X size={18} />
          </button>
        </div>

        <button
          type="button"
          className={`night-mode-toggle ${isNightMode ? 'active' : ''}`}
          onClick={onToggleNightMode}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Moon size={16} style={{ color: isNightMode ? '#fbbf24' : 'currentColor' }} />
            <div style={{ textAlign: 'left' }}>
              <div style={{ fontSize: 13.5, fontWeight: 700, color: '#fff' }}>
                Night Mode (True Tone)
              </div>
              <div style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.55)' }}>
                Тёплые жёлтые оттенки для комфорта глаз вечером
              </div>
            </div>
          </div>
          <span className={`night-mode-pill ${isNightMode ? 'on' : ''}`}>
            {isNightMode ? 'ВКЛ' : 'ВЫКЛ'}
          </span>
        </button>

        <div className="theme-grid">
          {THEME_PRESETS.map((theme) => {
            const isSelected = theme.id === currentThemeId;
            return (
              <button
                key={theme.id}
                type="button"
                className={`theme-card ${isSelected ? 'selected' : ''}`}
                onClick={() => onSelectTheme(theme)}
              >
                <span
                  className="theme-swatch"
                  style={{
                    background: `linear-gradient(135deg, ${theme.accent} 0%, ${theme.accent2} 100%)`,
                    boxShadow: `0 0 14px ${theme.glow}`,
                  }}
                >
                  {isSelected && <Check size={13} color="#09090b" strokeWidth={3} />}
                </span>
                <span className="theme-card-name">{theme.name}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};