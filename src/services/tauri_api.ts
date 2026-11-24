import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { PlaybackStatus, PlaylistItem, TrackItem, WaveSettings } from '../shared/models';

export async function pickMusicFolder(): Promise<string | null> {
  const selected = await open({
    directory: true,
    multiple: false,
    title: 'Выберите папку с музыкой',
  });
  return typeof selected === 'string' ? selected : null;
}

export const tauriApi = {
  pickFolder: pickMusicFolder,
  pickMusicFolder,
  selectFolder: pickMusicFolder,

  pickAndScanFolder: async (): Promise<TrackItem[] | null> => {
    const folderPath = await pickMusicFolder();
    if (!folderPath) return null;
    return invoke<TrackItem[]>('scan_folder', { folderPath });
  },

  getTracks: (): Promise<TrackItem[]> => invoke<TrackItem[]>('get_tracks'),

  scanFolder: (folderPath: string): Promise<TrackItem[]> =>
    invoke<TrackItem[]>('scan_folder', { folderPath }),

  playTrack: (trackId: string, audioUrl: string): Promise<void> =>
    invoke('play_track', { trackId, audioUrl }),

  pauseTrack: (): Promise<void> => invoke('pause_track'),

  resumeTrack: (): Promise<void> => invoke('resume_track'),

  seekTrack: (seconds: number): Promise<void> =>
    invoke('seek_track', { seconds: Math.floor(seconds) }),

  setVolume: (volume: number): Promise<void> => invoke('set_volume', { volume }),

  toggleMute: (): Promise<boolean> => invoke<boolean>('toggle_mute'),

  getPlaybackStatus: (): Promise<PlaybackStatus> =>
    invoke<PlaybackStatus>('get_playback_status'),

  toggleFavorite: (trackId: string): Promise<boolean> =>
    invoke<boolean>('toggle_favorite', { trackId }),

  getPlaylists: (): Promise<PlaylistItem[]> => invoke<PlaylistItem[]>('get_playlists'),

  createPlaylist: (id: string, name: string): Promise<PlaylistItem> =>
    invoke<PlaylistItem>('create_playlist', { id, name }),

  addTrackToPlaylist: (playlistId: string, trackId: string): Promise<void> =>
    invoke('add_track_to_playlist', { playlistId, trackId }),

  setCustomApiUrl: (url: string): Promise<void> =>
    invoke('set_custom_api_url', { url }),

  searchOnlineTracks: async (query: string): Promise<TrackItem[]> => {
    if (!query.trim()) return [];
    return invoke<TrackItem[]>('search_online_tracks', { query });
  },

  getWaveTracks: (settings: WaveSettings): Promise<TrackItem[]> =>
    invoke<TrackItem[]>('get_wave_tracks', {
      mood: settings.mood,
      activity: settings.activity,
      character: settings.character,
      genre: settings.genre,
    }),
};