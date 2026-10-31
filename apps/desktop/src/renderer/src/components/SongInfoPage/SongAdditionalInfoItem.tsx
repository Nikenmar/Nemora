type Props = {
  label: string;
  value: string;
};

const SongAdditionalInfoItem = (props: Props) => {
  const { label, value } = props;

  return (
    <div className="mb-2 rounded-md p-2 first:mt-2 last:mb-0 odd:bg-canvas/25 hover:odd:bg-canvas/50 even:hover:bg-canvas/50 ">
      <p className="text-sm text-ink-dim">
        {label}
      </p>
      <p className="pl-2">{value}</p>
    </div>
  );
};

export default SongAdditionalInfoItem;
