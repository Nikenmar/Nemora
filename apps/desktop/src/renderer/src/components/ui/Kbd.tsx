import Icon from './Icon';

/**
 * A key, drawn as a key: a small raised cap with a glyph (arrows as icons, since the app's font
 * draws arrow characters as dashes) or a word ("Space", "Enter").
 */
const Kbd = ({ icon, label, className = '' }: { icon?: string; label?: string; className?: string }) => (
  <kbd
    className={`inline-flex h-[1.375rem] min-w-[1.375rem] items-center justify-center rounded-[5px] border border-line border-b-2 bg-surface-2 px-1 font-[inherit] text-[11px] font-semibold leading-none text-ink-dim ${className}`}
  >
    {icon ? <Icon name={icon} size={15} /> : label}
  </kbd>
);

export default Kbd;
