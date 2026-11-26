import React from 'react';

interface ArtistLinksProps {
  artist: string;
  className?: string;
  onSelectArtist?: (name: string) => void;
  onAfterClick?: () => void;
}

export const ArtistLinks: React.FC<ArtistLinksProps> = ({
  artist,
  className = '',
  onSelectArtist,
  onAfterClick,
}) => {
  const parts = artist
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  if (!onSelectArtist || parts.length === 0) {
    return <span className={className}>{artist}</span>;
  }

  return (
    <span className={className}>
      {parts.map((name, idx) => (
        <React.Fragment key={`${name}-${idx}`}>
          {idx > 0 && ', '}
          <span
            className="clickable-meta"
            onClick={(e) => {
              e.stopPropagation();
              onSelectArtist(name);
              onAfterClick?.();
            }}
          >
            {name}
          </span>
        </React.Fragment>
      ))}
    </span>
  );
};
