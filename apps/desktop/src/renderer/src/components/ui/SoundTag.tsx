/**
 * The sound tag beside a title ("Slowed + Reverb"): apart from the title, smaller, in capitals with a
 * little tracking and a quieter colour, so it reads as a label of how the song sounds, not as part
 * of its name. Keyed by its text, so a change of speed fades the new name in.
 */
const SoundTag = ({ tag, className = '' }: { tag: string | null | undefined; className?: string }) =>
  tag ? (
    <span
      key={tag}
      className={`sound-tag shrink-0 whitespace-nowrap text-[0.72em] font-semibold uppercase leading-none tracking-[0.07em] text-ink-faint ${className}`}
    >
      {tag}
    </span>
  ) : null;

export default SoundTag;
