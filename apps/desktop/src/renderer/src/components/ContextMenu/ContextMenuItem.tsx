/* eslint-disable jsx-a11y/no-static-element-interactions */
/* eslint-disable jsx-a11y/click-events-have-key-events */

import { useContext } from 'react';
import { AppUpdateContext } from '../../contexts/AppUpdateContext';
import Icon from '../ui/Icon';

const ContextMenuItem = (props: ContextMenuItem) => {
  const { updateContextMenuData } = useContext(AppUpdateContext);
  const isDanger = props.class?.includes('menu-item-danger');
  return (
    <div
      role="menuitem"
      className={`menu-item ${props.class || ''} ${
        props.fileDrag ? 'cursor-grab select-none active:cursor-grabbing' : 'cursor-pointer'
      } flex h-8 flex-row items-center gap-3 rounded-md px-2.5 text-body ${
        isDanger ? 'text-danger' : 'text-ink'
      } transition-colors duration-100 hover:bg-glass-hover`}
      // The drag has to be handed to the OS while the button is still down, so
      // it starts on mousedown - a click handler fires only on release, by
      // which point there is no gesture left to take over.
      onMouseDown={(event) => {
        if (!props.fileDrag || event.button !== 0) return;
        event.preventDefault();
        window.api.songUpdates.startFileDrag(props.fileDrag.paths, props.fileDrag.artwork);
        updateContextMenuData(false, []);
      }}
      onClick={() => {
        if (!props.isContextMenuItemSeperator && props.handlerFunction) {
          props.handlerFunction();
          updateContextMenuData(false, []);
        }
      }}
    >
      {/* Every item keeps the icon's place, so labels line up when some have none. */}
      <span className="flex w-[18px] shrink-0 items-center justify-center">
        {props.iconName && (
          <Icon
            name={props.iconName}
            size={18}
            className={`icon ${isDanger ? 'text-danger' : 'text-ink-dim'} ${props.iconClassName ?? ''}`}
          />
        )}
      </span>
      <span className="truncate">{props.label}</span>
    </div>
  );
};

ContextMenuItem.displayName = 'ContextMenuItem';
export default ContextMenuItem;
