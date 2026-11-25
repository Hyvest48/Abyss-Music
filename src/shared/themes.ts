export interface ThemePreset {
  id: string;
  name: string;
  accent: string;
  accent2: string;
  glow: string;
  bgBase: string;
  sidebarTop: string;
}

export const THEME_PRESETS: ThemePreset[] = [
  { id: 'obsidian', name: 'Obsidian', accent: '#ffffff', accent2: '#8e8e9e', glow: 'rgba(255, 255, 255, 0.14)', bgBase: '#09090b', sidebarTop: '#131316' },
  { id: 'abyss-violet', name: 'Abyss Violet', accent: '#a855f7', accent2: '#6366f1', glow: 'rgba(168, 85, 247, 0.22)', bgBase: '#0a0810', sidebarTop: '#151120' },
  { id: 'crimson', name: 'Crimson Night', accent: '#f43f5e', accent2: '#fb7185', glow: 'rgba(244, 63, 94, 0.22)', bgBase: '#0d080a', sidebarTop: '#1a1014' },
  { id: 'cyber-cyan', name: 'Cyber Cyan', accent: '#22d3ee', accent2: '#3b82f6', glow: 'rgba(34, 211, 238, 0.20)', bgBase: '#070b0e', sidebarTop: '#0f171d' },
  { id: 'emerald', name: 'Emerald Pulse', accent: '#10b981', accent2: '#6ee7b7', glow: 'rgba(16, 185, 129, 0.20)', bgBase: '#070c0a', sidebarTop: '#0f1a15' },
  { id: 'sakura', name: 'Sakura Dark', accent: '#f472b6', accent2: '#c084fc', glow: 'rgba(244, 114, 182, 0.22)', bgBase: '#0d090c', sidebarTop: '#1a1218' },
  { id: 'solar-gold', name: 'Solar Gold', accent: '#f59e0b', accent2: '#fde68a', glow: 'rgba(245, 158, 11, 0.20)', bgBase: '#0c0a07', sidebarTop: '#1a160f' },
  { id: 'arctic', name: 'Arctic Ice', accent: '#bae6fd', accent2: '#60a5fa', glow: 'rgba(186, 230, 253, 0.18)', bgBase: '#080b0f', sidebarTop: '#111720' },
  { id: 'sunset', name: 'Sunset Vapor', accent: '#fb923c', accent2: '#ec4899', glow: 'rgba(251, 146, 60, 0.22)', bgBase: '#0e090a', sidebarTop: '#1c1215' },
  { id: 'toxic-lime', name: 'Toxic Lime', accent: '#a3e635', accent2: '#4ade80', glow: 'rgba(163, 230, 53, 0.20)', bgBase: '#090c07', sidebarTop: '#141a0f' },
  { id: 'indigo', name: 'Royal Indigo', accent: '#818cf8', accent2: '#38bdf8', glow: 'rgba(129, 140, 248, 0.22)', bgBase: '#080910', sidebarTop: '#111424' },
  { id: 'blood-orange', name: 'Blood Orange', accent: '#ef4444', accent2: '#f97316', glow: 'rgba(239, 68, 68, 0.22)', bgBase: '#0e0807', sidebarTop: '#1c110f' },
  { id: 'oceanic', name: 'Oceanic', accent: '#14b8a6', accent2: '#0ea5e9', glow: 'rgba(20, 184, 166, 0.20)', bgBase: '#070b0d', sidebarTop: '#0e171b' },
  { id: 'lavender', name: 'Lavender Haze', accent: '#d8b4fe', accent2: '#f0abfc', glow: 'rgba(216, 180, 254, 0.20)', bgBase: '#0b090e', sidebarTop: '#17121e' },
  { id: 'copper', name: 'Copper Noir', accent: '#d97757', accent2: '#f4c2a1', glow: 'rgba(217, 119, 87, 0.20)', bgBase: '#0c0908', sidebarTop: '#191311' },
  { id: 'matcha', name: 'Matcha Dark', accent: '#86efac', accent2: '#bef264', glow: 'rgba(134, 239, 172, 0.18)', bgBase: '#080c09', sidebarTop: '#111913' },
  { id: 'neon-berry', name: 'Neon Berry', accent: '#e879f9', accent2: '#8b5cf6', glow: 'rgba(232, 121, 249, 0.22)', bgBase: '#0c080f', sidebarTop: '#191020' },
  { id: 'steel', name: 'Steel Blue', accent: '#94a3b8', accent2: '#e2e8f0', glow: 'rgba(148, 163, 184, 0.18)', bgBase: '#080a0d', sidebarTop: '#12161c' },
  { id: 'champagne', name: 'Champagne', accent: '#e7d4b5', accent2: '#ffffff', glow: 'rgba(231, 212, 181, 0.18)', bgBase: '#0b0a09', sidebarTop: '#171513' },
  { id: 'matrix', name: 'Matrix', accent: '#22c55e', accent2: '#86efac', glow: 'rgba(34, 197, 94, 0.22)', bgBase: '#050b07', sidebarTop: '#0b170f' },
];