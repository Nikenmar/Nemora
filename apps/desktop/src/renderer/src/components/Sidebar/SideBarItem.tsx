import Icon from '../ui/Icon';
import { cn } from '../ui/cn';

interface SideBarItems {
  id: string;
  icon: string;
  content: string;
  isActive: boolean;
  handleClick: (_id: string) => void;
}

/** One sidebar link: white with a filled icon on the sidebar's sliding blue pill while its page is open. */
const SideBarItem = (props: SideBarItems) => (
  <li>
    <button
      type="button"
      className={cn(
        `${props.id.toLowerCase()} relative z-[1] flex h-[34px] w-full items-center gap-3 rounded-full px-3 text-left text-body font-medium text-ink outline-none transition-colors duration-150 hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-echo lg:justify-center lg:px-0`,
        props.isActive && 'text-on-accent hover:bg-transparent'
      )}
      onClick={() => props.handleClick(props.id)}
      aria-current={props.isActive ? 'page' : undefined}
      aria-label={props.content}
    >
      <Icon
        name={props.icon}
        filled={props.isActive}
        size={20}
        className={cn('shrink-0', props.isActive ? 'text-on-accent' : 'text-ink-dim')}
      />
      <span className="truncate lg:hidden">{props.content}</span>
    </button>
  </li>
);

export default SideBarItem;
