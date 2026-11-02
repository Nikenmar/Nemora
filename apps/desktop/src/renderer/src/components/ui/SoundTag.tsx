/**
 * The sound tag after a title, "- Slowed + Reverb": the title's case, the artists line's light
 * weight, a size between the two and a quieter colour, so it reads as part of the line but not as
 * part of the name. Keyed by its text, so a change of speed fades the new name in.
 */
const SoundTag = ({ tag, className = '' }: { tag: string | null | undefined; className?: string }) =>
  tag ? (
    <span key={tag} className={`sound-tag ml-[0.3em] shrink-0 whitespace-nowrap font-normal text-ink-dim ${className}`}>
      - {tag}
    </span>
  ) : null;

export default SoundTag;
