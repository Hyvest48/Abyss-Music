import React, { useEffect, useState } from 'react';

interface SplashScreenProps {
  isReady: boolean;
  statusText: string;
}

const PARTICLES = [
  { left: '18%', delay: '0s', duration: '4.2s', size: 3 },
  { left: '28%', delay: '0.7s', duration: '3.6s', size: 2 },
  { left: '38%', delay: '1.3s', duration: '4.8s', size: 4 },
  { left: '48%', delay: '0.3s', duration: '3.9s', size: 2.5 },
  { left: '56%', delay: '1.1s', duration: '4.5s', size: 3 },
  { left: '66%', delay: '0.5s', duration: '3.4s', size: 2 },
  { left: '75%', delay: '1.6s', duration: '4.1s', size: 3.5 },
  { left: '83%', delay: '0.9s', duration: '3.8s', size: 2 },
];

export const SplashScreen: React.FC<SplashScreenProps> = ({ isReady, statusText }) => {
  const [minTimePassed, setMinTimePassed] = useState(false);
  const [isExiting, setIsExiting] = useState(false);
  const [isMounted, setIsMounted] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => setMinTimePassed(true), 1200);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (isReady && minTimePassed && !isExiting) {
      setIsExiting(true);
      const unmountTimer = setTimeout(() => setIsMounted(false), 480);
      return () => clearTimeout(unmountTimer);
    }
  }, [isReady, minTimePassed, isExiting]);

  if (!isMounted) return null;

  return (
    <div
      className={`splash-overlay ${isExiting ? 'is-exiting' : ''}`}
      onClick={() => {
        if (isReady) setIsExiting(true);
      }}
    >
      <div className="splash-ambient-glow" aria-hidden="true" />

      <div className="splash-particles" aria-hidden="true">
        {PARTICLES.map((p, idx) => (
          <span
            key={idx}
            className="splash-particle"
            style={{
              left: p.left,
              width: p.size,
              height: p.size,
              animationDelay: p.delay,
              animationDuration: p.duration,
            }}
          />
        ))}
      </div>

      <div className="splash-core">
        <div className="splash-logo-float" aria-hidden="true">
          <svg width="76" height="76" viewBox="0 0 80 80" fill="none">
            <defs>
              <linearGradient id="abyssAgyGrad" x1="16" y1="10" x2="64" y2="70" gradientUnits="userSpaceOnUse">
                <stop offset="0%" stopColor="#ffffff" />
                <stop offset="55%" stopColor="var(--accent-warm)" />
                <stop offset="100%" stopColor="var(--accent-secondary)" />
              </linearGradient>
            </defs>
            <path
              d="M40 12C40 12 22 47 16 62C15 64.5 17 66.5 19.5 65.5C27 62 32.5 52 40 52C47.5 52 53 62 60.5 65.5C63 66.5 65 64.5 64 62C58 47 40 12 40 12Z"
              stroke="url(#abyssAgyGrad)"
              strokeWidth="4.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <circle cx="40" cy="39" r="3.5" fill="#ffffff" />
          </svg>
        </div>

        <div className="splash-title">ABYSS MUSIC</div>
        <div className="splash-status">{statusText}</div>
      </div>
    </div>
  );
};
