/* eslint-disable jsx-a11y/no-static-element-interactions */
/* eslint-disable jsx-a11y/click-events-have-key-events */

import { useContext } from 'react';
import { AppUpdateContext } from '../../contexts/AppUpdateContext';

const ContextMenuItem = (props: ContextMenuItem) => {
  const { updateContextMenuData } = useContext(AppUpdateContext);
  return (
    <div
      className={`menu-item ${props.class || ''} ${
        props.fileDrag ? 'cursor-grab select-none active:cursor-grabbing' : 'cursor-pointer'
      } flex flex-row items-center px-4 py-1 text-sm font-light text-font-color-black hover:bg-context-menu-list-hover/75 dark:text-font-color-white dark:hover:bg-dark-context-menu-list-hover/25`}
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
      {props.iconName && (
        <span className={`material-icons-round icon mr-4 text-lg ${props.iconClassName}`}>
          {props.iconName}
        </span>
      )}{' '}
      {props.label}
    </div>
  );
};

ContextMenuItem.displayName = 'ContextMenuItem';
export default ContextMenuItem;
