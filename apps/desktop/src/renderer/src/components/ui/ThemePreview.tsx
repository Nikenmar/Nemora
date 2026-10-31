import { cn } from './cn';

/** A miniature of the window, drawn with one theme's own tokens (`.light` / `.dark` in styles.css). */
const Mini = ({ theme, className }: { theme: 'light' | 'dark'; className?: string }) => (
  <div className={cn(theme, 'grid h-full w-full grid-cols-[26%_1fr] grid-rows-[10%_1fr_16%] bg-canvas', className)}>
    <div className="col-span-2 bg-chrome" />
    <div className="flex flex-col gap-[6%] bg-chrome px-[10%] pt-[12%]">
      <span className="h-[9%] w-full rounded-full bg-accent" />
      <span className="h-[6%] w-3/4 rounded-full bg-line" />
      <span className="h-[6%] w-2/3 rounded-full bg-line" />
      <span className="h-[6%] w-3/4 rounded-full bg-line" />
    </div>
    <div className="flex flex-col gap-[7%] px-[8%] pt-[8%]">
      <span className="h-[10%] w-1/3 rounded-full bg-ink/80" />
      {[0, 1, 2].map((row) => (
        <span key={row} className="flex h-[12%] items-center gap-[6%]">
          <span className="aspect-square h-full rounded-[2px] bg-echo/60" />
          <span className="h-[45%] flex-1 rounded-full bg-line" />
        </span>
      ))}
    </div>
    <div className="col-span-2 flex items-center justify-center border-t border-line bg-chrome">
      <span className="aspect-square h-[45%] rounded-full bg-ink" />
    </div>
  </div>
);

/** The theme choice's picture: light, black, or the two halves for "follow the system". */
const ThemePreview = ({ mode }: { mode: 'light' | 'dark' | 'system' }) => (
  <div className="relative h-24 w-40 overflow-hidden rounded-lg border border-line shadow-[0_6px_16px_rgb(0_0_0/0.18)]" aria-hidden>
    {mode === 'system' ? (
      <>
        <Mini theme="light" />
        <Mini theme="dark" className="absolute inset-0 [clip-path:polygon(100%_0,100%_100%,0_100%)]" />
      </>
    ) : (
      <Mini theme={mode} />
    )}
  </div>
);

export default ThemePreview;
