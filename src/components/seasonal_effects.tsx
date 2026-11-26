import React, { useEffect, useRef } from 'react';

interface SeasonalEffectsProps {
  themeId: string;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  scale: number;
  alpha: number;
  angle: number;
  spin: number;
  swayOffset: number;
  spriteIdx: number;
}

const SEASONAL_THEMES = new Set(['winter', 'autumn', 'spring', 'summer']);

function createSprite(themeId: string, color: string): HTMLCanvasElement {
  const size = 40;
  const off = document.createElement('canvas');
  off.width = size;
  off.height = size;
  const ctx = off.getContext('2d');
  if (!ctx) return off;

  const c = size / 2;
  ctx.translate(c, c);
  ctx.fillStyle = color;
  ctx.strokeStyle = color;

  if (themeId === 'winter') {
    const r = 13;
    ctx.lineWidth = 1.6;
    ctx.lineCap = 'round';
    for (let i = 0; i < 6; i++) {
      ctx.save();
      ctx.rotate((Math.PI / 3) * i);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(0, -r);
      ctx.moveTo(0, -r * 0.52);
      ctx.lineTo(-r * 0.28, -r * 0.76);
      ctx.moveTo(0, -r * 0.52);
      ctx.lineTo(r * 0.28, -r * 0.76);
      ctx.stroke();
      ctx.restore();
    }
  } else if (themeId === 'autumn') {
    const s = 12;
    ctx.beginPath();
    ctx.moveTo(0, -s);
    ctx.quadraticCurveTo(s * 0.9, -s * 0.3, s * 0.45, s * 0.6);
    ctx.lineTo(0, s * 0.95);
    ctx.lineTo(-s * 0.45, s * 0.6);
    ctx.quadraticCurveTo(-s * 0.9, -s * 0.3, 0, -s);
    ctx.fill();
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(0, s * 0.8);
    ctx.lineTo(0, s * 1.25);
    ctx.stroke();
  } else if (themeId === 'spring') {
    // 5-лепестковый цветок сакуры с серединкой
    for (let i = 0; i < 5; i++) {
      ctx.save();
      ctx.rotate(((Math.PI * 2) / 5) * i);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.bezierCurveTo(5, -6, 6, -13, 0, -14);
      ctx.bezierCurveTo(-6, -13, -5, -6, 0, 0);
      ctx.fill();
      ctx.restore();
    }
    ctx.fillStyle = '#fef08a';
    ctx.beginPath();
    ctx.arc(0, 0, 2.6, 0, Math.PI * 2);
    ctx.fill();
  } else {
    const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, 16);
    grad.addColorStop(0, color);
    grad.addColorStop(1, 'transparent');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(0, 0, 16, 0, Math.PI * 2);
    ctx.fill();
  }

  return off;
}

export const SeasonalEffects: React.FC<SeasonalEffectsProps> = ({ themeId }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!SEASONAL_THEMES.has(themeId)) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animId = 0;
    let width = (canvas.width = window.innerWidth);
    let height = (canvas.height = window.innerHeight);

    const onResize = () => {
      width = canvas.width = window.innerWidth;
      height = canvas.height = window.innerHeight;
    };
    window.addEventListener('resize', onResize);

    const palette =
      themeId === 'autumn'
        ? ['#f97316', '#f59e0b', '#ea580c', '#d97706']
        : themeId === 'spring'
          ? ['#fbcfe8', '#f9a8d4', '#f472b6']
          : themeId === 'summer'
            ? ['#fde047', '#fef08a', '#fbbf24']
            : ['#ffffff', '#e0f2fe'];

    const sprites = palette.map((color) => createSprite(themeId, color));
    const count =
      themeId === 'winter' ? 32 : themeId === 'autumn' ? 18 : themeId === 'spring' ? 20 : 20;

    const createParticle = (randomY = false): Particle => ({
      x: Math.random() * width,
      y: randomY ? Math.random() * height : -24,
      vx: themeId === 'summer' ? (Math.random() - 0.5) * 0.4 : (Math.random() - 0.5) * 0.3,
      vy:
        themeId === 'winter'
          ? 0.65 + Math.random() * 0.85
          : themeId === 'summer'
            ? -0.3 - Math.random() * 0.35
            : 0.75 + Math.random() * 0.85,
      scale: 0.45 + Math.random() * 0.45,
      alpha:
        themeId === 'winter'
          ? 0.35 + Math.random() * 0.42
          : themeId === 'summer'
            ? 0.24 + Math.random() * 0.35
            : 0.5 + Math.random() * 0.32,
      angle: Math.random() * Math.PI * 2,
      spin: (Math.random() - 0.5) * 0.025,
      swayOffset: Math.random() * Math.PI * 2,
      spriteIdx: Math.floor(Math.random() * sprites.length),
    });

    const particles: Particle[] = Array.from({ length: count }, () => createParticle(true));
    let tick = 0;
    let lastTime = performance.now();

    const render = (now: number) => {
      animId = requestAnimationFrame(render);
      const dt = Math.min(0.05, (now - lastTime) / 1000);
      lastTime = now;
      const step = dt * 60;

      tick += dt * 1.6;
      ctx.clearRect(0, 0, width, height);

      for (const p of particles) {
        p.x += (p.vx + Math.sin(tick + p.swayOffset) * (themeId === 'winter' ? 0.3 : 0.55)) * step;
        p.y += p.vy * step;
        p.angle += p.spin * step;

        if (themeId === 'summer') {
          if (p.y < -24) {
            p.y = height + 24;
            p.x = Math.random() * width;
          }
        } else if (p.y > height + 24) {
          p.y = -24;
          p.x = Math.random() * width;
        }
        if (p.x > width + 24) p.x = -24;
        if (p.x < -24) p.x = width + 24;

        const sprite = sprites[p.spriteIdx];
        const drawSize = sprite.width * p.scale;

        ctx.save();
        ctx.globalAlpha = p.alpha;
        ctx.translate(p.x, p.y);
        ctx.rotate(p.angle);
        ctx.drawImage(sprite, -drawSize / 2, -drawSize / 2, drawSize, drawSize);
        ctx.restore();
      }
    };

    animId = requestAnimationFrame(render);
    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener('resize', onResize);
    };
  }, [themeId]);

  if (!SEASONAL_THEMES.has(themeId)) return null;

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'fixed',
        inset: 0,
        pointerEvents: 'none',
        zIndex: 5,
      }}
    />
  );
};
