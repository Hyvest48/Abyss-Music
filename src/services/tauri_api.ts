import { invoke } from '@tauri-apps/api/core';
import { emit, listen } from '@tauri-apps/api/event';
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

export interface SearchArtistItem {
  id: string;
  name: string;
  coverUrl?: string;
  tracksCount: number;
}

export interface YandexSearchResult {
  artists: SearchArtistItem[];
  tracks: TrackItem[];
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

  searchYandexAll: async (query: string): Promise<YandexSearchResult> => {
    if (!query.trim()) return { artists: [], tracks: [] };
    return invoke<YandexSearchResult>('search_yandex_all', { query });
  },

  resolveYandexTracks: async (trackIds: string[]): Promise<TrackItem[]> => {
    if (trackIds.length === 0) return [];
    return invoke<TrackItem[]>('resolve_yandex_tracks', { trackIds });
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
      trackId: track.id,
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

  updateMediaMetadata: (track: TrackItem): Promise<void> =>
    invoke('update_media_metadata', {
      title: track.title,
      artist: track.artist,
      album: track.album,
      coverUrl: track.coverUrl ?? null,
      durationSeconds: track.durationSeconds,
    }),

  updateMediaPlayback: (isPlaying: boolean, positionSec: number): Promise<void> =>
    invoke('update_media_playback', { isPlaying, positionSec }),

  onMediaControl: (callback: (action: string) => void) =>
    listen<string>('media-control', (event) => callback(event.payload)),

  onMediaSeek: (callback: (positionSec: number) => void) =>
    listen<number>('media-seek', (event) => callback(event.payload)),

  toggleDesktopWidget: (): Promise<boolean> =>
    invoke<boolean>('toggle_desktop_widget'),

  isDesktopWidgetOpen: (): Promise<boolean> =>
    invoke<boolean>('is_desktop_widget_open'),

  emitWidgetState: (payload: {
    track: TrackItem | null;
    isPlaying: boolean;
    positionSec: number;
    isFavorite: boolean;
    accentColor?: string;
    accentSecondary?: string;
  }): Promise<void> => emit('widget-state-update', payload),

  onWidgetRequestState: (callback: () => void) =>
    listen('widget-request-state', () => callback()),

  onWidgetVisibilityChanged: (callback: (open: boolean) => void) =>
    listen<boolean>('widget-visibility-changed', (event) => callback(event.payload)),

  onWidgetToggleFavorite: (callback: (trackId: string) => void) =>
    listen<string>('widget-toggle-favorite', (event) => callback(event.payload)),

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

  renamePlaylist: (id: string, name: string): Promise<void> =>
    invoke('rename_playlist', { id, name }),

  deletePlaylist: (id: string): Promise<void> =>
    invoke('delete_playlist', { id }),
};