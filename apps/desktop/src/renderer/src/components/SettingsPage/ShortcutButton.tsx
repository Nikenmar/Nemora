type Props = {
  shortcutKey?: string;
  className?: string;
  children?: string;
};

const ShortcutButton = (props: Props) => {
  const { children, shortcutKey, className } = props;
  return (
    <div
      className={`shortcut-button rounded-md bg-accent/75 px-2 py-1 text-center ${className}`}
    >
      {shortcutKey || children}
    </div>
  );
};

export default ShortcutButton;
