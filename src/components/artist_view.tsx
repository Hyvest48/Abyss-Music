import React, { useEffect, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import {
  ArrowLeft,
  Play,
  Pause,
  Disc,
  Music,
  Search,
  Heart,
  Users,
  ChevronRight,
  Radio,
  Sparkles,
} from 'lucide-react';
import { TrackItem, getCoverGradient } from '../shared/models';
import { TrackList, formatDuration } from './track_list';
import { ArtistLinks } from './artist_links';
import { tauriApi } from '../services/tauri_api';

const artistProfileCache = new Map<string, ArtistProfile>();

export interface ArtistAlbum {
  id: string;
  title: string;
  year?: number;
  releaseDate?: string;
  coverUrl?: string;
  albumType: string;
}

export interface SimilarArtist {
  id: string;
  name: string;
  coverUrl?: string;
}

export interface ArtistProfile {
  id: string;
  name: string;
  coverUrl?: string;
  genres: string[];
  tracksCount: number;
  albumsCount: number;
  likesCount: number;
  monthlyListeners: number;
  popularTracks: TrackItem[];
  allTracks: TrackItem[];
  albums: ArtistAlbum[];
  similarArtists: SimilarArtist[];
}

interface ArtistViewProps {
  artistName: string;
  artistId?: string;
  localTracks: TrackItem[];
  favoriteIds: Set<string>;
  currentTrackId: string | null;
  isPlaying: boolean;
  onBack: () => void;
  onSelectTrack: (track: TrackItem, queue: TrackItem[]) => void;
  onToggleFavorite: (trackId: string, track?: TrackItem) => void;
  onAddToPlaylist?: (track: TrackItem) => void;
  onOpenArtist: (artistName: string) => void;
}

type ArtistSubPage = 'overview' | 'all-tracks' | 'all-albums' | 'familiar' | 'album-detail';

export const ArtistView: React.FC<ArtistViewProps> = ({
  artistName,
  artistId,
  localTracks,
  favoriteIds,
  currentTrackId,
  isPlaying,
  onBack,
  onSelectTrack,
  onToggleFavorite,
  onAddToPlaylist,
  onOpenArtist,
}) => {
  const [profile, setProfile] = useState<ArtistProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [subPage, setSubPage] = useState<ArtistSubPage>('overview');
  const [filterQuery, setFilterQuery] = useState('');
  const [selectedAlbum, setSelectedAlbum] = useState<ArtistAlbum | null>(null);
  const [albumTracks, setAlbumTracks] = useState<TrackItem[]>([]);
  const [isLoadingAlbum, setIsLoadingAlbum] = useState(false);
  const [listeningSeconds, setListeningSeconds] = useState<number>(0);
  const albumReqSeqRef = useRef(0);

  const [isArtistLiked, setIsArtistLiked] = useState<boolean>(() => {
    try {
      const raw = localStorage.getItem('abyss-liked-artists');
      const list: string[] = raw ? JSON.parse(raw) : [];
      return list.includes(artistName.toLowerCase());
    } catch {
      return false;
    }
  });

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setError(null);
    setProfile(null);
    setSubPage('overview');
    setFilterQuery('');
    setSelectedAlbum(null);
    setAlbumTracks([]);

    tauriApi
      .getArtistListeningTime(artistName)
      .then((secs) => {
        if (!cancelled) setListeningSeconds(secs);
      })
      .catch(() => {});

    try {
      const raw = localStorage.getItem('abyss-liked-artists');
      const list: string[] = raw ? JSON.parse(raw) : [];
      setIsArtistLiked(list.includes(artistName.toLowerCase()));
    } catch {
      setIsArtistLiked(false);
    }

    const cacheKey = artistId ? `id:${artistId}` : `name:${artistName.toLowerCase()}`;
    const cached = artistProfileCache.get(cacheKey);
    if (cached) {
      setProfile(cached);
      setIsLoading(false);
      return;
    }

    invoke<ArtistProfile>('get_artist_profile', {
      artistName,
      artistId: artistId ?? null,
    })
      .then((data) => {
        artistProfileCache.set(cacheKey, data);
        artistProfileCache.set(`name:${data.name.toLowerCase()}`, data);
        if (artistProfileCache.size > 30) {
          const oldest = artistProfileCache.keys().next().value;
          if (oldest !== undefined) artistProfileCache.delete(oldest);
        }
        if (!cancelled) {
          setProfile(data);
          try {
            const raw = localStorage.getItem('abyss-liked-artists');
            const list: string[] = raw ? JSON.parse(raw) : [];
            setIsArtistLiked(
              list.includes(artistName.toLowerCase()) ||
                list.includes(data.name.toLowerCase())
            );
          } catch {}
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(typeof err === 'string' ? err : 'Не удалось загрузить профиль артиста');
        }
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
      albumReqSeqRef.current += 1;
    };
  }, [artistName, artistId]);

  const toggleArtistLike = () => {
    setIsArtistLiked((prev) => {
      const next = !prev;
      try {
        const raw = localStorage.getItem('abyss-liked-artists');
        const list: string[] = raw ? JSON.parse(raw) : [];
        const key = (profile?.name || artistName).toLowerCase();
        const updated = next ? Array.from(new Set([...list, key])) : list.filter((x) => x !== key);
        localStorage.setItem('abyss-liked-artists', JSON.stringify(updated));
      } catch {}
      return next;
    });
  };

  const applyFavs = (list: TrackItem[]) =>
    list.map((t) => (favoriteIds.has(t.id) ? { ...t, isFavorite: true } : t));

  const mergedAllTracks = useMemo(() => {
    const cleanTarget = artistName.toLowerCase();
    const map = new Map<string, TrackItem>();

    if (profile) {
      for (const t of profile.allTracks) map.set(t.id, t);
      for (const t of profile.popularTracks) {
        if (!map.has(t.id)) map.set(t.id, t);
      }
    }

    for (const lt of localTracks) {
      if (lt.artist.toLowerCase().includes(cleanTarget) && !map.has(lt.id)) {
        map.set(lt.id, lt);
      }
    }

    return applyFavs(Array.from(map.values()));
  }, [profile, localTracks, artistName, favoriteIds]);

  const popularTracks = useMemo(() => {
    const base =
      profile && profile.popularTracks.length > 0
        ? profile.popularTracks
        : mergedAllTracks.slice(0, 10);
    return applyFavs(base);
  }, [profile, mergedAllTracks, favoriteIds]);

  // «Знакомое вам»: лайкнутые треки этого артиста + локальные треки с диска
  const familiarTracks = useMemo(() => {
    const cleanTarget = (profile?.name || artistName).toLowerCase();
    const map = new Map<string, TrackItem>();

    for (const t of mergedAllTracks) {
      if (favoriteIds.has(t.id)) map.set(t.id, { ...t, isFavorite: true });
    }
    for (const lt of localTracks) {
      if (lt.artist.toLowerCase().includes(cleanTarget) && !map.has(lt.id)) {
        map.set(lt.id, favoriteIds.has(lt.id) ? { ...lt, isFavorite: true } : lt);
      }
    }
    return Array.from(map.values());
  }, [mergedAllTracks, localTracks, favoriteIds, profile?.name, artistName]);

  const familiarAlbumsCount = useMemo(() => {
    const albums = new Set(familiarTracks.map((t) => t.album).filter(Boolean));
    return albums.size;
  }, [familiarTracks]);

  const latestRelease = useMemo(() => {
    if (!profile || profile.albums.length === 0) return null;
    return profile.albums[0];
  }, [profile]);

  const filteredSubTracks = useMemo(() => {
    const source =
      subPage === 'familiar'
        ? familiarTracks
        : subPage === 'album-detail'
        ? applyFavs(albumTracks)
        : mergedAllTracks;

    const q = filterQuery.trim().toLowerCase();
    if (!q) return source;
    return source.filter(
      (t) =>
        t.title.toLowerCase().includes(q) ||
        t.album.toLowerCase().includes(q) ||
        t.artist.toLowerCase().includes(q)
    );
  }, [subPage, familiarTracks, albumTracks, mergedAllTracks, filterQuery, favoriteIds]);

  const handleOpenAlbum = async (album: ArtistAlbum) => {
    const seq = ++albumReqSeqRef.current;
    setSelectedAlbum(album);
    setSubPage('album-detail');
    setFilterQuery('');
    setIsLoadingAlbum(true);
    try {
      const tracks = await invoke<TrackItem[]>('get_album_tracks', { albumId: album.id });
      if (seq === albumReqSeqRef.current) {
        setAlbumTracks(tracks);
      }
    } catch {
      if (seq === albumReqSeqRef.current) {
        setAlbumTracks([]);
      }
    } finally {
      if (seq === albumReqSeqRef.current) {
        setIsLoadingAlbum(false);
      }
    }
  };

  const handlePlayAll = () => {
    const queue = popularTracks.length > 0 ? popularTracks : mergedAllTracks;
    if (queue.length > 0) {
      onSelectTrack(queue[0], queue);
    }
  };

  const handlePlayArtistWave = () => {
    if (mergedAllTracks.length === 0) return;
    const shuffled = [...mergedAllTracks].sort(() => Math.random() - 0.5);
    onSelectTrack(shuffled[0], shuffled);
  };

  const isArtistPlaying =
    isPlaying &&
    currentTrackId !== null &&
    mergedAllTracks.some((t) => t.id === currentTrackId);

  const displayName = profile?.name || artistName;

  return (
    <div style={{ paddingBottom: 32 }}>
      {/* Верхняя навигация */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
        <button
          type="button"
          className="wave-settings-btn"
          onClick={() => {
            if (subPage !== 'overview') {
              setSubPage('overview');
              setSelectedAlbum(null);
              setFilterQuery('');
            } else {
              onBack();
            }
          }}
        >
          <ArrowLeft size={16} />
          <span>{subPage !== 'overview' ? `К странице ${displayName}` : 'Назад'}</span>
        </button>
      </div>

      {/* Шапка исполнителя как в Яндекс Музыке */}
      <section
        className="wave-hero"
        style={{
          position: 'relative',
          overflow: 'hidden',
          padding: '32px 34px',
          minHeight: 236,
          alignItems: 'center',
          borderRadius: 24,
        }}
      >
        {profile?.coverUrl && (
          <div
            style={{
              position: 'absolute',
              inset: -30,
              backgroundImage: `url(${profile.coverUrl})`,
              backgroundSize: 'cover',
              backgroundPosition: 'center 25%',
              filter: 'blur(42px) brightness(0.36) saturate(1.2)',
              transform: 'scale(1.12)',
              pointerEvents: 'none',
            }}
          />
        )}

        <div
          style={{
            position: 'relative',
            zIndex: 1,
            display: 'flex',
            alignItems: 'center',
            gap: 28,
            flex: 1,
            minWidth: 0,
          }}
        >
          {profile?.coverUrl ? (
            <img
              src={profile.coverUrl}
              alt={displayName}
              style={{
                width: 168,
                height: 168,
                borderRadius: '50%',
                objectFit: 'cover',
                boxShadow: '0 18px 44px rgba(0, 0, 0, 0.6)',
                border: '2px solid rgba(255, 255, 255, 0.14)',
                flexShrink: 0,
              }}
            />
          ) : (
            <div
              style={{
                width: 168,
                height: 168,
                borderRadius: '50%',
                background: getCoverGradient(artistName),
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              <Music size={58} />
            </div>
          )}

          <div style={{ minWidth: 0, flex: 1 }}>
            <div
              style={{
                fontSize: 13,
                fontWeight: 500,
                color: 'rgba(255, 255, 255, 0.72)',
                marginBottom: 4,
              }}
            >
              Исполнитель
            </div>

            <h1
              className="shimmer-text"
              style={{
                fontSize: 44,
                fontWeight: 800,
                letterSpacing: '-0.02em',
                lineHeight: 1.08,
                marginBottom: 12,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {displayName}
            </h1>

            {/* Плашка статистики */}
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                padding: '6px 14px',
                borderRadius: 999,
                background: 'rgba(255, 255, 255, 0.08)',
                backdropFilter: 'blur(12px)',
                fontSize: 13,
                color: 'rgba(255, 255, 255, 0.88)',
                marginBottom: 18,
              }}
            >
              <Users size={14} style={{ opacity: 0.8 }} />
              <span>
                {profile && profile.monthlyListeners > 0
                  ? `${profile.monthlyListeners.toLocaleString('ru-RU')} слушателей в месяц`
                  : profile && profile.likesCount > 0
                  ? `${profile.likesCount.toLocaleString('ru-RU')} слушателей`
                  : `${mergedAllTracks.length} треков`}
              </span>
              {profile && profile.tracksCount > 0 && (
                <span style={{ opacity: 0.6 }}>• {profile.tracksCount} треков</span>
              )}
              {listeningSeconds > 0 && (
                <span style={{ opacity: 0.85, color: 'var(--accent-warm)', fontWeight: 600 }}>
                  •{' '}
                  {listeningSeconds >= 3600
                    ? `${(listeningSeconds / 3600).toFixed(1)} ч прослушано`
                    : listeningSeconds >= 60
                    ? `${Math.floor(listeningSeconds / 60)} мин прослушано`
                    : `${listeningSeconds} сек прослушано`}
                </span>
              )}
            </div>

            {/* Ряд кнопок: Слушать + Волна по артисту + Сердце */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={handlePlayAll}
                disabled={mergedAllTracks.length === 0}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '11px 24px',
                  borderRadius: 999,
                  border: 'none',
                  background: 'var(--accent-warm)',
                  color: '#121214',
                  fontWeight: 700,
                  fontSize: 14,
                  cursor: mergedAllTracks.length > 0 ? 'pointer' : 'not-allowed',
                  boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
                }}
              >
                {isArtistPlaying ? (
                  <Pause size={17} fill="currentColor" />
                ) : (
                  <Play size={17} fill="currentColor" />
                )}
                <span>Слушать</span>
              </button>

              <button
                type="button"
                onClick={handlePlayArtistWave}
                disabled={mergedAllTracks.length === 0}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '11px 20px',
                  borderRadius: 999,
                  border: '1px solid rgba(255, 255, 255, 0.14)',
                  background: 'rgba(255, 255, 255, 0.08)',
                  backdropFilter: 'blur(12px)',
                  color: '#ffffff',
                  fontWeight: 600,
                  fontSize: 14,
                  cursor: mergedAllTracks.length > 0 ? 'pointer' : 'not-allowed',
                }}
              >
                <Radio size={16} />
                <span>Волна по артисту</span>
              </button>

              <button
                type="button"
                onClick={toggleArtistLike}
                title={isArtistLiked ? 'Убрать из любимых артистов' : 'Добавить в любимые артисты'}
                style={{
                  width: 42,
                  height: 42,
                  borderRadius: '50%',
                  border: '1px solid rgba(255, 255, 255, 0.14)',
                  background: 'rgba(255, 255, 255, 0.08)',
                  backdropFilter: 'blur(12px)',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  color: isArtistLiked ? 'var(--accent-warm)' : '#ffffff',
                }}
              >
                <Heart
                  size={18}
                  fill={isArtistLiked ? 'var(--accent-warm)' : 'none'}
                  color={isArtistLiked ? 'var(--accent-warm)' : '#ffffff'}
                />
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* Загрузка / Ошибка */}
      {isLoading && (
        <div style={{ marginTop: 28 }} className="empty-box">
          <Sparkles size={32} className="pulse-icon" />
          <div className="track-name" style={{ fontSize: 16 }}>
            Загружаем страницу исполнителя {artistName}...
          </div>
        </div>
      )}

      {!isLoading && error && mergedAllTracks.length === 0 && (
        <div style={{ marginTop: 28 }} className="empty-box">
          <Music size={32} />
          <div className="track-name" style={{ fontSize: 16 }}>
            {error}
          </div>
          <p className="track-artist">
            Проверь подключение к Яндекс ID в боковом меню слева
          </p>
        </div>
      )}

      {/* РЕЖИМ 1: ОБЗОР СТРАНИЦЫ АРТИСТА (КАК В ЯНДЕКС МУЗЫКЕ) */}
      {!isLoading && subPage === 'overview' && mergedAllTracks.length > 0 && (
        <>
          {/* Двухколоночный ряд: Популярные треки (слева) + Новый релиз (справа) */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: latestRelease ? 'minmax(0, 1fr) 210px' : '1fr',
              gap: 28,
              marginTop: 28,
              alignItems: 'start',
            }}
          >
            {/* Левая колонка: Популярные треки > */}
            <div>
              <button
                type="button"
                onClick={() => setSubPage('all-tracks')}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  background: 'transparent',
                  border: 'none',
                  padding: 0,
                  marginBottom: 14,
                  cursor: 'pointer',
                  color: '#ffffff',
                }}
              >
                <h2 className="section-heading shimmer-text" style={{ margin: 0, fontSize: 22 }}>
                  Популярные треки
                </h2>
                <ChevronRight size={20} style={{ opacity: 0.65 }} />
              </button>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {popularTracks.slice(0, 5).map((track) => {
                  const isCurrent = track.id === currentTrackId;
                  return (
                    <div
                      key={track.id}
                      onClick={() => onSelectTrack(track, popularTracks)}
                      className={`track-row ${isCurrent ? 'active' : ''}`}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 12,
                        padding: '8px 12px',
                        borderRadius: 12,
                        cursor: 'pointer',
                        background: isCurrent ? 'rgba(255,255,255,0.08)' : 'transparent',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
                        {track.coverUrl ? (
                          <img
                            src={track.coverUrl}
                            alt={track.title}
                            style={{
                              width: 44,
                              height: 44,
                              borderRadius: 8,
                              objectFit: 'cover',
                              flexShrink: 0,
                            }}
                          />
                        ) : (
                          <div
                            style={{
                              width: 44,
                              height: 44,
                              borderRadius: 8,
                              background: getCoverGradient(track.id),
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              flexShrink: 0,
                            }}
                          >
                            <Music size={16} />
                          </div>
                        )}

                        <div style={{ minWidth: 0 }}>
                          <div
                            className="track-name"
                            style={{
                              color: isCurrent ? 'var(--accent-warm)' : '#ffffff',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {track.title}
                          </div>
                          <div
                            className="track-artist"
                            style={{
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            <ArtistLinks
                              artist={track.artist}
                              onSelectArtist={onOpenArtist}
                            />
                          </div>
                        </div>
                      </div>

                      <div
                        style={{ display: 'flex', alignItems: 'center', gap: 14, flexShrink: 0 }}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <button
                          type="button"
                          className="icon-ghost-btn"
                          onClick={() => onToggleFavorite(track.id, track)}
                          title="Мне нравится"
                        >
                          <Heart
                            size={16}
                            fill={track.isFavorite ? 'var(--accent-warm)' : 'none'}
                            color={track.isFavorite ? 'var(--accent-warm)' : 'rgba(255,255,255,0.6)'}
                          />
                        </button>
                        <span
                          className="tabular-time"
                          style={{ fontSize: 13, color: 'rgba(255,255,255,0.55)', minWidth: 38, textAlign: 'right' }}
                        >
                          {formatDuration(track.durationSeconds)}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Правая колонка: Новый релиз */}
            {latestRelease && (
              <div>
                <h2 className="section-heading shimmer-text" style={{ margin: '0 0 14px 0', fontSize: 22 }}>
                  Новый релиз
                </h2>

                <button
                  type="button"
                  onClick={() => handleOpenAlbum(latestRelease)}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    textAlign: 'left',
                    width: '100%',
                    padding: 0,
                    background: 'transparent',
                    border: 'none',
                    cursor: 'pointer',
                  }}
                >
                  {latestRelease.coverUrl ? (
                    <img
                      src={latestRelease.coverUrl}
                      alt={latestRelease.title}
                      style={{
                        width: '100%',
                        aspectRatio: '1 / 1',
                        borderRadius: 16,
                        objectFit: 'cover',
                        marginBottom: 12,
                        boxShadow: '0 14px 32px rgba(0,0,0,0.45)',
                      }}
                    />
                  ) : (
                    <div
                      style={{
                        width: '100%',
                        aspectRatio: '1 / 1',
                        borderRadius: 16,
                        marginBottom: 12,
                        background: getCoverGradient(latestRelease.id),
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <Disc size={48} />
                    </div>
                  )}

                  <div className="track-name" style={{ fontSize: 16, fontWeight: 700 }}>
                    {latestRelease.title}
                  </div>
                  <div className="track-artist" style={{ fontSize: 13, marginTop: 3 }}>
                    {displayName}
                  </div>
                  <div className="track-artist" style={{ fontSize: 12, marginTop: 2, opacity: 0.7 }}>
                    {latestRelease.year ? `${latestRelease.year} • ` : ''}
                    {latestRelease.albumType}
                  </div>
                </button>
              </div>
            )}
          </div>

          {/* Плашка «Знакомое вам >» */}
          {familiarTracks.length > 0 && (
            <div style={{ marginTop: 28 }}>
              <button
                type="button"
                onClick={() => setSubPage('familiar')}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 14,
                  padding: '12px 18px',
                  borderRadius: 16,
                  background: 'rgba(255, 255, 255, 0.04)',
                  border: '1px solid rgba(255, 255, 255, 0.08)',
                  cursor: 'pointer',
                  textAlign: 'left',
                }}
              >
                <div
                  style={{
                    width: 48,
                    height: 48,
                    borderRadius: 12,
                    background: 'linear-gradient(135deg, var(--accent-warm), #7c5c3e)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#121214',
                    flexShrink: 0,
                  }}
                >
                  <Heart size={22} fill="#121214" />
                </div>
                <div>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 4,
                      fontSize: 16,
                      fontWeight: 700,
                      color: '#ffffff',
                    }}
                  >
                    <span>Знакомое вам</span>
                    <ChevronRight size={17} style={{ opacity: 0.65 }} />
                  </div>
                  <div className="track-artist" style={{ fontSize: 13, marginTop: 2 }}>
                    {familiarTracks.length} треков
                    {familiarAlbumsCount > 0 ? ` • ${familiarAlbumsCount} альбомов` : ''}
                  </div>
                </div>
              </button>
            </div>
          )}

          {/* Секция «Популярные альбомы >» */}
          {profile && profile.albums.length > 0 && (
            <div style={{ marginTop: 32 }}>
              <button
                type="button"
                onClick={() => setSubPage('all-albums')}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  background: 'transparent',
                  border: 'none',
                  padding: 0,
                  marginBottom: 16,
                  cursor: 'pointer',
                  color: '#ffffff',
                }}
              >
                <h2 className="section-heading shimmer-text" style={{ margin: 0, fontSize: 22 }}>
                  Популярные альбомы
                </h2>
                <ChevronRight size={20} style={{ opacity: 0.65 }} />
              </button>

              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(175px, 1fr))',
                  gap: 18,
                }}
              >
                {profile.albums.slice(0, 6).map((album) => (
                  <button
                    key={album.id}
                    type="button"
                    onClick={() => handleOpenAlbum(album)}
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      textAlign: 'left',
                      padding: 0,
                      background: 'transparent',
                      border: 'none',
                      cursor: 'pointer',
                    }}
                  >
                    {album.coverUrl ? (
                      <img
                        src={album.coverUrl}
                        alt={album.title}
                        style={{
                          width: '100%',
                          aspectRatio: '1 / 1',
                          objectFit: 'cover',
                          borderRadius: 14,
                          marginBottom: 10,
                        }}
                        loading="lazy"
                      />
                    ) : (
                      <div
                        style={{
                          width: '100%',
                          aspectRatio: '1 / 1',
                          borderRadius: 14,
                          marginBottom: 10,
                          background: getCoverGradient(album.id),
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                      >
                        <Disc size={36} />
                      </div>
                    )}
                    <div
                      className="track-name"
                      style={{
                        fontSize: 14,
                        fontWeight: 600,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        width: '100%',
                      }}
                    >
                      {album.title}
                    </div>
                    <div className="track-artist" style={{ fontSize: 12, marginTop: 2 }}>
                      {displayName}
                    </div>
                    <div className="track-artist" style={{ fontSize: 12, marginTop: 1, opacity: 0.7 }}>
                      {album.year ? `${album.year} • ` : ''}
                      {album.albumType}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Секция «Похожие исполнители >» */}
          {profile && profile.similarArtists.length > 0 && (
            <div style={{ marginTop: 36 }}>
              <div className="section-header-row" style={{ marginBottom: 16 }}>
                <h2 className="section-heading shimmer-text" style={{ margin: 0, fontSize: 22 }}>
                  Похожие исполнители
                </h2>
              </div>

              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))',
                  gap: 18,
                }}
              >
                {profile.similarArtists.slice(0, 6).map((sa) => (
                  <button
                    key={sa.id}
                    type="button"
                    onClick={() => onOpenArtist(sa.name)}
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      textAlign: 'center',
                      padding: 8,
                      background: 'transparent',
                      border: 'none',
                      cursor: 'pointer',
                    }}
                  >
                    {sa.coverUrl ? (
                      <img
                        src={sa.coverUrl}
                        alt={sa.name}
                        style={{
                          width: 136,
                          height: 136,
                          borderRadius: '50%',
                          objectFit: 'cover',
                          marginBottom: 12,
                          boxShadow: '0 10px 26px rgba(0,0,0,0.4)',
                        }}
                        loading="lazy"
                      />
                    ) : (
                      <div
                        style={{
                          width: 136,
                          height: 136,
                          borderRadius: '50%',
                          background: getCoverGradient(sa.id),
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          marginBottom: 12,
                        }}
                      >
                        <Music size={34} />
                      </div>
                    )}
                    <span
                      className="track-name"
                      style={{
                        fontSize: 14,
                        fontWeight: 600,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        width: '100%',
                      }}
                    >
                      {sa.name}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {/* РЕЖИМ 2: ВСЕ ТРЕКИ / ЗНАКОМОЕ ВАМ / ТРЕКИ АЛЬБОМА */}
      {!isLoading &&
        (subPage === 'all-tracks' || subPage === 'familiar' || subPage === 'album-detail') && (
          <div style={{ marginTop: 24 }}>
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: 12,
                marginBottom: 16,
              }}
            >
              <h2 className="section-heading shimmer-text" style={{ margin: 0, fontSize: 22 }}>
                {subPage === 'familiar'
                  ? `Знакомое вам (${filteredSubTracks.length})`
                  : subPage === 'album-detail' && selectedAlbum
                  ? `${selectedAlbum.title}${selectedAlbum.year ? ` (${selectedAlbum.year})` : ''}`
                  : `Все треки ${displayName} (${filteredSubTracks.length})`}
              </h2>

              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '6px 14px',
                  borderRadius: 999,
                  background: 'rgba(255,255,255,0.06)',
                  border: '1px solid rgba(255,255,255,0.1)',
                }}
              >
                <Search size={14} style={{ opacity: 0.65 }} />
                <input
                  type="text"
                  value={filterQuery}
                  onChange={(e) => setFilterQuery(e.target.value)}
                  placeholder="Поиск по трекам..."
                  style={{
                    background: 'transparent',
                    border: 'none',
                    outline: 'none',
                    color: '#fff',
                    fontSize: 13,
                    width: 190,
                  }}
                />
              </div>
            </div>

            {subPage === 'album-detail' && isLoadingAlbum ? (
              <div className="empty-box">
                <Disc size={30} className="pulse-icon" />
                <span>Загружаем треки релиза...</span>
              </div>
            ) : (
              <TrackList
                tracks={filteredSubTracks}
                currentTrackId={currentTrackId}
                isPlaying={isPlaying}
                onSelectTrack={(t) => onSelectTrack(t, filteredSubTracks)}
                onToggleFavorite={onToggleFavorite}
                onAddToPlaylist={onAddToPlaylist}
                onSelectArtist={onOpenArtist}
              />
            )}
          </div>
        )}

      {/* РЕЖИМ 3: ВСЕ АЛЬБОМЫ И СИНГЛЫ АРТИСТА */}
      {!isLoading && subPage === 'all-albums' && profile && (
        <div style={{ marginTop: 24 }}>
          <h2 className="section-heading shimmer-text" style={{ margin: '0 0 18px 0', fontSize: 22 }}>
            Дискография {displayName} ({profile.albums.length})
          </h2>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
              gap: 18,
            }}
          >
            {profile.albums.map((album) => (
              <button
                key={album.id}
                type="button"
                onClick={() => handleOpenAlbum(album)}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  textAlign: 'left',
                  padding: 0,
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                }}
              >
                {album.coverUrl ? (
                  <img
                    src={album.coverUrl}
                    alt={album.title}
                    style={{
                      width: '100%',
                      aspectRatio: '1 / 1',
                      objectFit: 'cover',
                      borderRadius: 14,
                      marginBottom: 10,
                    }}
                    loading="lazy"
                  />
                ) : (
                  <div
                    style={{
                      width: '100%',
                      aspectRatio: '1 / 1',
                      borderRadius: 14,
                      marginBottom: 10,
                      background: getCoverGradient(album.id),
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Disc size={36} />
                  </div>
                )}
                <div
                  className="track-name"
                  style={{
                    fontSize: 14,
                    fontWeight: 600,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    width: '100%',
                  }}
                >
                  {album.title}
                </div>
                <div className="track-artist" style={{ fontSize: 12, marginTop: 2 }}>
                  {album.year ? `${album.year} • ` : ''}
                  {album.albumType}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};