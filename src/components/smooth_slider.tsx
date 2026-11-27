import React, { useRef, useState } from 'react';

interface SmoothSliderProps {
  value: number;
  max: number;
  onChange: (value: number) => void;
  /** true — отправлять значение только при отпускании (идеально для перемотки трека) */
  commitOnRelease?: boolean;
  /** колбэк на время перетаскивания, чтобы обновлять цифры времени в реальном времени */
  onDragPreview?: (value: number | null) => void;
  disabled?: boolean;
  className?: string;
}

export const SmoothSlider: React.FC<SmoothSliderProps> = ({
  value,
  max,
  onChange,
  commitOnRelease = false,
  onDragPreview,
  disabled = false,
  className = '',
}) => {
  const trackRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragValue, setDragValue] = useState<number | null>(null);

  const calcValueFromClientX = (clientX: number) => {
    const el = trackRef.current;
    if (!el || max <= 0) return 0;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0) return 0;
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    return ratio * max;
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (disabled || max <= 0) return;
    e.preventDefault();
    // Захватываем курсор: ползунок продолжит двигаться, даже если увести мышь вниз/вверх
    e.currentTarget.setPointerCapture(e.pointerId);

    const next = calcValueFromClientX(e.clientX);
    setIsDragging(true);
    setDragValue(next);
    onDragPreview?.(next);

    if (!commitOnRelease) {
      onChange(next);
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDragging) return;
    const next = calcValueFromClientX(e.clientX);
    setDragValue(next);
    onDragPreview?.(next);

    if (!commitOnRelease) {
      onChange(next);
    }
  };

  const finishDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDragging) return;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }

    const finalValue = calcValueFromClientX(e.clientX);
    setIsDragging(false);
    setDragValue(null);
    onDragPreview?.(null);

    if (commitOnRelease) {
      onChange(finalValue);
    }
  };

  const displayedValue = isDragging && dragValue !== null ? dragValue : value;
  const percent = max > 0 ? Math.min(100, Math.max(0, (displayedValue / max) * 100)) : 0;

  return (
    <div
      ref={trackRef}
      role="slider"
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={Math.round(displayedValue)}
      className={`slider-track ${isDragging ? 'is-dragging' : ''} ${disabled ? 'is-disabled' : ''} ${className}`}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={finishDrag}
      onPointerCancel={finishDrag}
    >
      <div className="slider-fill" style={{ width: `${percent}%` }}>
        <div className="slider-thumb" />
      </div>
    </div>
  );
};