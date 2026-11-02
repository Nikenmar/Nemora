/**
 * The sound tag after a title, "- Slowed + Reverb": the title's own font, size and case, a quieter
 * colour, so it reads as part of the line but not as part of the name. Keyed by its text, so a
 * change of speed fades the new name in.
 */
const SoundTag = ({ tag, className = '' }: { tag: string | null | undefined; className?: string }) =>
  tag ? (
    <span key={tag} className={`sound-tag ml-[0.3em] shrink-0 whitespace-nowrap font-medium text-ink-dim ${className}`}>
      - {tag}
    </span>
  ) : null;

export default SoundTag;
