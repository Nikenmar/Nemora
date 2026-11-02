/* eslint-disable jsx-a11y/no-static-element-interactions */
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
      // The drag has to be handed to the OS while the button is still down, so
      // it starts on mousedown - a click handler fires only on release, by
      // which point there is no gesture left to take over.
      onMouseDown={(event) => {
        if (!props.fileDrag || event.button !== 0) return;
        event.preventDefault();
        window.api.songUpdates.startFileDrag(props.fileDrag.paths, props.fileDrag.artwork);
        updateContextMenuData(false, []);
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
