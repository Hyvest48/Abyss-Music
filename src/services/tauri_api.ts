import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { open } from '@tauri-apps/plugin-dialog';
import { PlaybackStatus, PlaylistItem, TrackItem, WaveSettings } from '../shared/models';

export interface YandexAuthStatus {
  isAuthorized: boolean;
  accountName: string | null;
}

export interface TrackLyrics {
  syncedLyrics: string | null;
  plainLyrics: string | null;
  instrumental: boolean;
}

export async function pickMusicFolder(): Promise<string | null> {
  const selected = await open({
    directory: true,
    multiple: false,
    title: 'Выберите папку с музыкой',
  });
  return typeof selected === 'string' ? selected : null;
}

export const tauriApi = {
  getTracks: (): Promise<TrackItem[]> => invoke<TrackItem[]>('get_tracks'),

  pickAndScanFolder: async (): Promise<TrackItem[] | null> => {
    const folderPath = await pickMusicFolder();
    if (!folderPath) return null;
    return invoke<TrackItem[]>('scan_folder', { folderPath });
  },

  getYandexStatus: (): Promise<YandexAuthStatus> =>
    invoke<YandexAuthStatus>('get_yandex_status'),

  openYandexAuth: (): Promise<void> => invoke<void>('open_yandex_auth'),

  logoutYandex: (): Promise<void> => invoke<void>('logout_yandex'),

  onYandexAuthSuccess: (callback: (status: YandexAuthStatus) => void) =>
    listen<YandexAuthStatus>('yandex-auth-success', (event) => callback(event.payload)),

  searchYandexTracks: async (query: string): Promise<TrackItem[]> => {
    if (!query.trim()) return [];
    return invoke<TrackItem[]>('search_yandex_tracks', { query });
  },

  getYandexWave: (
    settings: WaveSettings,
    queueTrackId: string | null = null
  ): Promise<TrackItem[]> =>
    invoke<TrackItem[]>('get_yandex_wave', {
      mood: settings.mood,
      activity: settings.activity,
      character: settings.character,
      genre: settings.genre,
      queueTrackId,
    }),

  sendWaveFeedback: (
    genre: string | null,
    eventType: 'trackStarted' | 'trackFinished' | 'skip',
    trackId: string,
    totalPlayedSeconds?: number
  ): Promise<void> =>
    invoke<void>('send_wave_feedback', {
      genre,
      eventType,
      trackId,
      totalPlayedSeconds: totalPlayedSeconds ?? null,
    }),

  getTrackLyrics: (track: TrackItem): Promise<TrackLyrics> =>
    invoke<TrackLyrics>('get_track_lyrics', {
      title: track.title,
      artist: track.artist,
      album: track.album,
      durationSeconds: track.durationSeconds,
    }),

  getEqGains: (): Promise<number[]> => invoke<number[]>('get_eq_gains'),

  setEqGains: (gains: number[]): Promise<void> =>
    invoke<void>('set_eq_gains', { gains }),

  playTrack: (trackId: string, audioUrl: string): Promise<void> =>
    invoke('play_track', { trackId, audioUrl }),

  pauseTrack: (): Promise<void> => invoke('pause_track'),

  resumeTrack: (): Promise<void> => invoke('resume_track'),

  seekTrack: (seconds: number): Promise<void> => invoke('seek_track', { seconds }),

  setVolume: (volume: number): Promise<void> => invoke('set_volume', { volume }),

  toggleMute: (): Promise<boolean> => invoke<boolean>('toggle_mute'),

  getPlaybackStatus: (): Promise<PlaybackStatus> =>
    invoke<PlaybackStatus>('get_playback_status'),

  toggleFavorite: (trackId: string): Promise<boolean> =>
    invoke<boolean>('toggle_favorite', { trackId }),

  getPlaylists: (): Promise<PlaylistItem[]> =>
    invoke<PlaylistItem[]>('get_playlists'),

  createPlaylist: (id: string, name: string): Promise<PlaylistItem> =>
    invoke<PlaylistItem>('create_playlist', { id, name }),

  addTrackToPlaylist: (playlistId: string, trackId: string): Promise<void> =>
    invoke('add_track_to_playlist', { playlistId, trackId }),
};