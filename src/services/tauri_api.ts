import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { PlaybackStatus, PlaylistItem, TrackItem } from '../shared/models';

export const tauriApi = {
  async getTracks(): Promise<TrackItem[]> {
    return invoke<TrackItem[]>('get_tracks');
  },

  async pickAndScanFolder(): Promise<TrackItem[] | null> {
    const selected = await open({
      directory: true,
      multiple: false,
      title: 'Выберите папку с музыкой',
    });

    if (!selected || typeof selected !== 'string') {
      return null;
    }

    return invoke<TrackItem[]>('scan_folder', { folderPath: selected });
  },

  async playTrack(trackId: string, audioUrl: string): Promise<void> {
    return invoke('play_track', { trackId, audioUrl });
  },

  async pauseTrack(): Promise<void> {
    return invoke('pause_track');
  },

  async resumeTrack(): Promise<void> {
    return invoke('resume_track');
  },

  async seekTrack(seconds: number): Promise<void> {
    return invoke('seek_track', { seconds: Math.floor(seconds) });
  },

  async setVolume(volume: number): Promise<void> {
    return invoke('set_volume', { volume });
  },

  async toggleMute(): Promise<boolean> {
    return invoke<boolean>('toggle_mute');
  },

  async getPlaybackStatus(): Promise<PlaybackStatus> {
    return invoke<PlaybackStatus>('get_playback_status');
  },

  async toggleFavorite(trackId: string): Promise<boolean> {
    return invoke<boolean>('toggle_favorite', { trackId });
  },

  async getPlaylists(): Promise<PlaylistItem[]> {
    return invoke<PlaylistItem[]>('get_playlists');
  },

  async createPlaylist(id: string, name: string): Promise<PlaylistItem> {
    return invoke<PlaylistItem>('create_playlist', { id, name });
  },

  async addTrackToPlaylist(playlistId: string, trackId: string): Promise<void> {
    return invoke('add_track_to_playlist', { playlistId, trackId });
  },
};