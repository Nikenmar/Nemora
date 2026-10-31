import { type ReactElement, memo, useRef } from 'react';
import { useCountUp } from '../../other/motion';

interface SongStatProp {
  title: string;
  value: number | string | ReactElement;
  className?: string;
}

const SongStat = memo((props: SongStatProp) => {
  const { title, value, className } = props;
  const valueRef = useRef<HTMLDivElement>(null);
  const counted = useCountUp(typeof value === 'object' ? '' : value, valueRef);

  return (
    <div
      className={`stat appear-from-bottom flex max-h-32 min-h-24 w-60 flex-row items-center justify-between rounded-lg bg-surface-2/70 p-2 text-ink backdrop-blur-md ${className}`}
    >
      <div
        ref={valueRef}
        className="stat-value flex w-1/2 items-center justify-center text-center text-[2.75rem] font-medium tabular-nums text-ink"
      >
        {typeof value === 'object' ? value : counted}
      </div>
      <div className="stat-description text-xl">{title}</div>
    </div>
  );
});

SongStat.displayName = 'SongStat';
export default SongStat;
