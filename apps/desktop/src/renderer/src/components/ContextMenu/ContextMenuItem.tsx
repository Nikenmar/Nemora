 
/* eslint-disable jsx-a11y/click-events-have-key-events */

import { useContext } from 'react';
import { useTranslation } from 'react-i18next';
import { AppUpdateContext } from '../../contexts/AppUpdateContext';
import { store } from '../../store';
import Icon from '../ui/Icon';

/**
 * Menus still hand over icon classes written for the 1.x menu (`ms-icon mr-4 text-xl`): margins and
 * sizes from those push the glyph out of its slot. Only the fill and a colour still apply here.
 */
const iconLook = (classes?: string) =>
  (classes ?? '')
    .split(/\s+/)
    .filter((c) => c === 'ms-icon-filled' || /^!?text-(?!xs|sm|base|lg|\d*xl|\[)/.test(c))
    .join(' ');

const ContextMenuItem = (props: ContextMenuItem) => {
  const { updateContextMenuData } = useContext(AppUpdateContext);
  const { t } = useTranslation();
  const isDanger = props.class?.includes('menu-item-danger');
  const inner = props.innerContextMenus ?? [];
  const hasInner = inner.length > 0;
  return (
    <div
      role="menuitem"
      className={`menu-item ${props.class || ''} ${
        props.fileDrag ? 'cursor-grab select-none active:cursor-grabbing' : 'cursor-pointer'
      } flex h-8 flex-row items-center gap-3 rounded-md px-2.5 text-body ${
        isDanger ? 'text-danger' : 'text-ink'
      } transition-colors duration-100 hover:bg-glass-hover`}
      // The drag is handed to the OS once the browser itself sees a drag: the button held and the
      // mouse moved past its threshold. Starting on mousedown (as before) turned every plain click
      // into a drag that Windows dropped at once, back onto Nemora, and raced the release. The
      // browser's own drag is cancelled; the OS one takes the gesture over. The menu closes on the
      // next frame, so the item is still there while the drag begins.
      draggable={props.fileDrag ? true : undefined}
      onDragStart={(event) => {
        if (!props.fileDrag) return;
        event.preventDefault();
        window.api.songUpdates.startFileDrag(props.fileDrag.paths, props.fileDrag.artwork);
        requestAnimationFrame(() => updateContextMenuData(false, []));
      }}
      aria-haspopup={hasInner ? 'menu' : undefined}
      onClick={(event) => {
        if (props.isContextMenuItemSeperator || props.isDisabled) return;
        if (hasInner) {
          // A submenu opens in place of the menu, with a way back; the click must not reach the
          // window, whose listener closes any open menu.
          event.stopPropagation();
          const { menuItems, pageX, pageY, data } = store.state.contextMenuData;
          updateContextMenuData(
            true,
            [
              {
                label: t('common.back', 'Back'),
                iconName: 'arrow_back',
                handlerFunction: () => updateContextMenuData(true, menuItems, pageX, pageY, data),
                keepOpen: true
              },
              { label: '', isContextMenuItemSeperator: true, handlerFunction: () => true },
              ...inner
            ],
            pageX,
            pageY,
            data
          );
          return;
        }
        if (props.handlerFunction) {
          if (props.keepOpen) {
            event.stopPropagation();
            props.handlerFunction();
            return;
          }
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
            className={`icon ${isDanger ? 'text-danger' : 'text-ink-dim'} ${iconLook(props.iconClassName)}`}
          />
        )}
      </span>
      <span className="truncate">{props.label}</span>
      {hasInner && <Icon name="chevron_right" size={18} className="ml-auto text-ink-dim" />}
    </div>
  );
};

ContextMenuItem.displayName = 'ContextMenuItem';
export default ContextMenuItem;
