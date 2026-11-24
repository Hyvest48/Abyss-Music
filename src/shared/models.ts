export interface TrackItem {
  id: string;
  title: string;
  artist: string;
  album: string;
  durationSeconds: number;
  sourceType: 'local' | 'online';
  audioUrl: string;
  coverUrl?: string;
  isFavorite: boolean;
}

export interface PlaylistItem {
  id: string;
  name: string;
  coverUrl?: string;
  trackIds: string[];
}

export interface PlaybackStatus {
  isPlaying: boolean;
  positionSec: number;
  volume: number;
  isMuted: boolean;
  isFinished: boolean;
}

export interface WaveSettings {
  mood: string | null;
  activity: string | null;
  character: string | null;
  genre: string | null;
}

const COVER_GRADIENTS = [
  'linear-gradient(135deg, #3a3532 0%, #1c1b1a 100%)',
  'linear-gradient(135deg, #4a3f35 0%, #211e1c 100%)',
  'linear-gradient(135deg, #2d3846 0%, #181c22 100%)',
  'linear-gradient(135deg, #4b2e32 0%, #1f1719 100%)',
  'linear-gradient(135deg, #313b38 0%, #181d1b 100%)',
  'linear-gradient(135deg, #3c3747 0%, #1b1920 100%)',
];

export function getCoverGradient(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  }
  return COVER_GRADIENTS[Math.abs(hash) % COVER_GRADIENTS.length];
}

export const WAVE_CATEGORIES = {
  mood: ['Спокойное', 'Бодрое', 'Грустное', 'Весёлое', 'Мрачное', 'Романтичное'],
  activity: ['Для фокуса', 'В дорогу', 'Тренировка', 'Вечерний чилл', 'Ночью', 'Для кода'],
  character: ['Любимое', 'Незнакомое', 'Популярное', 'Новинки'],
  genre: ['Рок', 'Инди', 'Электроника', 'Хип-хоп', 'Лоу-фай', 'Акустика'],
} as const;