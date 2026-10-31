type Props = {
  rank: number;
  entry: StatsNameEntry;
};

const TopNameRow = (props: Props) => {
  const { rank, entry } = props;

  return (
    <li className="flex items-center gap-3 py-1">
      <span className="w-6 shrink-0 text-right font-medium opacity-60">{rank}</span>
      <span className="min-w-0 grow truncate">{entry.name}</span>
      <span className="shrink-0 font-medium tabular-nums text-ink-dim">
        {entry.listens}
      </span>
    </li>
  );
};

export default TopNameRow;
