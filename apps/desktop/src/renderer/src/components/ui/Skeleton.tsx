import { cn as twMerge } from './cn';

/** A placeholder block while something loads; pulses unless motion is reduced. */
export const Skeleton = ({ className }: { className?: string }) => (
  <span className={twMerge('block animate-skeleton rounded-md bg-surface-2', className)} aria-hidden />
);

/** Skeleton song rows: cover, two lines, the length. */
export const SkeletonRows = ({ count = 8 }: { count?: number }) => (
  <div className="flex w-full flex-col gap-1" role="status" aria-label="Loading">
    {Array.from({ length: count }, (_, i) => (
      <div key={i} className="flex h-[50px] items-center gap-3.5 px-2.5">
        <Skeleton className="h-[38px] w-[38px] rounded-cover-sm" />
        <div className="flex flex-1 flex-col gap-1.5">
          <Skeleton className="h-3 w-1/3" />
          <Skeleton className="h-2.5 w-1/5" />
        </div>
        <Skeleton className="h-2.5 w-10" />
      </div>
    ))}
  </div>
);

/** Skeleton cover tiles in a row. */
export const SkeletonTiles = ({ count = 6 }: { count?: number }) => (
  <div className="grid w-full grid-cols-[repeat(auto-fill,minmax(10rem,1fr))] gap-5" role="status" aria-label="Loading">
    {Array.from({ length: count }, (_, i) => (
      <div key={i} className="flex flex-col gap-2">
        <Skeleton className="aspect-square w-full rounded-cover" />
        <Skeleton className="h-3 w-2/3" />
        <Skeleton className="h-2.5 w-1/2" />
      </div>
    ))}
  </div>
);

export default Skeleton;
