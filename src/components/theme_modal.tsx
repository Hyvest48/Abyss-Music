import React from 'react';
import { X, Check } from 'lucide-react';
import { THEME_PRESETS, ThemePreset } from '../shared/themes';

interface ThemeModalProps {
  isOpen: boolean;
  currentThemeId: string;
  onSelectTheme: (theme: ThemePreset) => void;
  onClose: () => void;
}

export const ThemeModal: React.FC<ThemeModalProps> = ({
  isOpen,
  currentThemeId,
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