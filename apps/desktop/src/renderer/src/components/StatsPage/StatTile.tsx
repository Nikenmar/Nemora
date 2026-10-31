import { useRef } from 'react';
import { useCountUp } from '../../other/motion';

type Props = {
  label: string;
  value: string | number;
  title?: string;
};

const StatTile = (props: Props) => {
  const { label, value, title } = props;
  const valueRef = useRef<HTMLSpanElement>(null);
  const shown = useCountUp(value, valueRef);

  return (
    <span
      className="flex min-h-[130px] flex-col items-center justify-center rounded-lg border-[3px] border-surface-2 py-4 text-lg"
      title={title ?? `${value} ${label}`}
    >
      <span ref={valueRef} className="text-section font-semibold tabular-nums text-ink">
        {shown}
      </span>
      <span className="px-2 text-center lowercase opacity-75">{label}</span>
    </span>
  );
};

export default StatTile;
