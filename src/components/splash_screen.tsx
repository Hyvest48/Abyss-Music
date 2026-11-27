import React, { useEffect, useState } from 'react';
import appIconUrl from '../assets/app_icon.png';

interface SplashScreenProps {
  isReady: boolean;
  statusText: string;
}

const EQ_BARS = [0, 1, 2, 3, 4];

export const SplashScreen: React.FC<SplashScreenProps> = ({ isReady, statusText }) => {
  const [minTimePassed, setMinTimePassed] = useState(false);
  const [isExiting, setIsExiting] = useState(false);
  const [isMounted, setIsMounted] = useState(true);

  useEffect(() => {
    const timer = window.setTimeout(() => setMinTimePassed(true), 2600);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (isReady && minTimePassed && !isExiting) {
      setIsExiting(true);
    }
  }, [isReady, minTimePassed, isExiting]);

  useEffect(() => {
    if (!isExiting) return;
    const unmountTimer = window.setTimeout(() => setIsMounted(false), 520);
    return () => window.clearTimeout(unmountTimer);
  }, [isExiting]);

  if (!isMounted) return null;

  return (
    <div
      className={`splash-overlay ${isExiting ? 'is-exiting' : ''}`}
      onClick={() => {
        if (isReady && !isExiting) setIsExiting(true);
      }}
    >
      <div className="splash-aura splash-aura-primary" aria-hidden="true" />
      <div className="splash-aura splash-aura-secondary" aria-hidden="true" />

      <div className="splash-core">
        <div className="splash-medallion-wrap" aria-hidden="true">
          <span className="splash-ripple splash-ripple-1" />
          <span className="splash-ripple splash-ripple-2" />
          <div className="splash-ring-spinner" />
          <div className="splash-glass-medallion">
            <img src={appIconUrl} alt="Abyss Music" className="splash-app-icon" />
          </div>
        </div>

        <div className="splash-title">ABYSS MUSIC</div>

        <div className="splash-eq-row" aria-hidden="true">
          {EQ_BARS.map((i) => (
            <span
              key={i}
              className="splash-eq-bar"
              style={{ animationDelay: `${i * 0.13}s` }}
            />
          ))}
        </div>

        <div className="splash-progress-track" aria-hidden="true">
          <div className={`splash-progress-fill ${isReady ? 'is-complete' : ''}`} />
        </div>

        <div className="splash-status">{statusText}</div>
      </div>
    </div>
  );
};
