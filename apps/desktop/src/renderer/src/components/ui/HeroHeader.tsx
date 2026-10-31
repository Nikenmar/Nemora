import type { ReactNode } from 'react';

import Img from '../Img';
import { cn } from './cn';

interface HeroHeaderProps {
  /** The cover, or a ready-made node (a mosaic of song covers). */
  artwork?: string;
  artworkNode?: ReactNode;
  fallbackArtwork?: string;
  /** What this page is: Album, Playlist, Genre, Artist. */
  kind: string;
  title: ReactNode;
  /** A second line under the title: artists, a description. */
  subtitle?: ReactNode;
  /** Short facts in one row: song count, duration, year. */
  meta?: ReactNode[];
  /** Artists are round. */
  isRound?: boolean;
  className?: string;
  children?: ReactNode;
}

/**
 * The head of an album, playlist, genre or artist page: the cover blurred behind, the cover itself,
 * the kind of page, the title, a subtitle and a row of facts. Actions go in `children`.
 */
const HeroHeader = ({
  artwork,
  artworkNode,
  fallbackArtwork,
  kind,
  title,
  subtitle,
  meta = [],
  isRound = false,
  className,
  children
}: HeroHeaderProps) => (
  <header className={cn('hero-header relative mb-6 mr-4 shrink-0 overflow-hidden rounded-panel bg-surface-1', className)}>
    {artwork && (
      <div className="pointer-events-none absolute inset-0" aria-hidden>
        <Img
          src={artwork}
          fallbackSrc={fallbackArtwork}
          alt=""
          className="h-full w-full scale-125 object-cover opacity-45 blur-[56px] saturate-[1.2]"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-surface-1 via-surface-1/60 to-transparent" />
      </div>
    )}
    <div className="relative flex items-center gap-7 p-6 lg:gap-5">
      <div
        className={cn(
          'h-[13rem] w-[13rem] shrink-0 overflow-hidden bg-surface-2 shadow-[0_18px_44px_rgb(0_0_0/0.4)] lg:h-40 lg:w-40',
          isRound ? 'rounded-full' : 'rounded-cover-lg'
        )}
      >
        {artworkNode ?? (
          <Img src={artwork} fallbackSrc={fallbackArtwork} alt="" loading="eager" className="h-full w-full object-cover" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-small text-ink-dim">{kind}</p>
        <h1 className="mt-1 line-clamp-2 text-hero font-semibold text-ink [text-wrap:balance]">{title}</h1>
        {subtitle && <div className="mt-2 truncate text-body text-ink">{subtitle}</div>}
        {meta.filter(Boolean).length > 0 && (
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-small text-ink-dim">
            {meta.filter(Boolean).map((item, index) => (
              // Facts handed in by position.
              <span key={index}>{item}</span>
            ))}
          </div>
        )}
        {children && <div className="mt-4 flex flex-wrap items-center gap-2">{children}</div>}
      </div>
    </div>
  </header>
);

export default HeroHeader;
