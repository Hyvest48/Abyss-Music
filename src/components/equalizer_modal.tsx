import React, { useEffect, useState } from 'react';
import { Sliders, RotateCcw, X } from 'lucide-react';
import { tauriApi } from '../services/tauri_api';

interface EqualizerModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const BANDS = [
  { label: '60 Гц', sub: 'Саб-бас' },
  { label: '230 Гц', sub: 'Бас' },
  { label: '910 Гц', sub: 'Середина' },
  { label: '3.6 кГц', sub: 'Вокал' },
  { label: '14 кГц', sub: 'Верха' },
];

const PRESETS: { name: string; gains: number[] }[] = [
  { name: 'По умолчанию', gains: [0, 0, 0, 0, 0] },
  { name: 'Bass Boost', gains: [7, 4.5, -1, 1, 2.5] },
  { name: 'Электроника', gains: [5.5, 2, -1.5, 3, 5] },
  { name: 'Хип-хоп / Фонк', gains: [6.5, 3.5, -2, 1.5, 3] },
  { name: 'Рок', gains: [4, 1.5, -1, 3.5, 4.5] },
  { name: 'Чистый вокал', gains: [-2, 0.5, 4, 4.5, 1.5] },
];

export const EqualizerModal: React.FC<EqualizerModalProps> = ({ isOpen, onClose }) => {
  const [gains, setGains] = useState<number[]>([0, 0, 0, 0, 0]);
  const eqTimerRef = React.useRef<number | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    tauriApi
      .getEqGains()
      .then((loaded) => {
        if (!cancelled && Array.isArray(loaded) && loaded.length === 5) {
          setGains(loaded);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  useEffect(() => {
    return () => {
      if (eqTimerRef.current !== null) {
        window.clearTimeout(eqTimerRef.current);
      }
    };
  }, []);

  if (!isOpen) return null;

  const applyGains = (next: number[], immediate = false) => {
    setGains(next);
    if (eqTimerRef.current !== null) {
      window.clearTimeout(eqTimerRef.current);
      eqTimerRef.current = null;
    }
    if (immediate) {
      void tauriApi.setEqGains(next).catch((err) => {
        console.error('Ошибка обновления эквалайзера:', err);
      });
    } else {
      eqTimerRef.current = window.setTimeout(() => {
        eqTimerRef.current = null;
        void tauriApi.setEqGains(next).catch((err) => {
          console.error('Ошибка обновления эквалайзера:', err);
        });
      }, 45);
    }
  };

  const handleBandChange = (idx: number, val: number) => {
    const next = [...gains];
    next[idx] = val;
    applyGains(next);
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="wave-modal-card"
        style={{ maxWidth: 520, width: '100%' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="queue-header" style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Sliders size={18} style={{ color: 'var(--accent-warm)' }} />
            <span className="section-heading shimmer-text" style={{ fontSize: 18 }}>
              Эквалайзер
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button
              type="button"
              className="icon-ghost-btn"
              onClick={() => applyGains([0, 0, 0, 0, 0])}
              title="Сбросить в ноль"
            >
              <RotateCcw size={16} />
            </button>
            <button type="button" className="icon-ghost-btn" onClick={onClose} title="Закрыть">
              <X size={18} />
            </button>
          </div>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 22 }}>
          {PRESETS.map((p) => {
            const isActive = p.gains.every((v, i) => Math.abs(v - gains[i]) < 0.1);
            return (
              <button
                key={p.name}
                type="button"
                className={`wave-active-tag`}
                style={{
                  cursor: 'pointer',
                  border: isActive
                    ? '1px solid var(--accent-warm)'
                    : '1px solid rgba(255,255,255,0.08)',
                  background: isActive ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.04)',
                }}
                onClick={() => applyGains(p.gains)}
              >
                {p.name}
              </button>
            );
          })}
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(5, minmax(0, 1fr))',
            gap: 10,
            width: '100%',
            boxSizing: 'border-box',
            padding: '16px 12px',
            borderRadius: 16,
            background: 'rgba(255,255,255,0.03)',
            border: '1px solid rgba(255,255,255,0.06)',
          }}
        >
          {BANDS.map((band, idx) => {
            const val = gains[idx] ?? 0;
            return (
              <div
                key={band.label}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 10,
                }}
              >
                <span
                  className="tabular-time"
                  style={{ fontSize: 12, color: 'var(--accent-warm)', fontWeight: 600 }}
                >
                  {val > 0 ? `+${val.toFixed(1)}` : val.toFixed(1)} дБ
                </span>

                <div
                  style={{
                    height: 140,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <input
                    type="range"
                    min={-12}
                    max={12}
                    step={0.5}
                    value={val}
                    onChange={(e) => handleBandChange(idx, parseFloat(e.target.value))}
                    style={{
                      width: 130,
                      transform: 'rotate(-90deg)',
                      accentColor: 'var(--accent-warm)',
                      cursor: 'pointer',
                    }}
                  />
                </div>

                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 12, fontWeight: 600 }}>{band.label}</div>
                  <div className="track-artist" style={{ fontSize: 10 }}>
                    {band.sub}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};