/* eslint-disable jsx-a11y/click-events-have-key-events */
import { memo, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import ContextMenuItem from './ContextMenuItem';
import ContextMenuDataItem from './ContextMenuDataItem';
import { useStore } from '@tanstack/react-store';
import { store } from '@renderer/store';
import { raiseToTopLayer, topModalDialog } from '../ui/topLayer';

const ContextMenu = memo(() => {
  const contextMenuData = useStore(store, (state) => state.contextMenuData);

  const { isVisible, menuItems, data } = contextMenuData;

  const contextMenuRef = useRef(null as null | HTMLDivElement);
  // Over a modal dialog the menu opens inside it, in the top layer (ui/topLayer.ts).
  const [host, setHost] = useState<HTMLDialogElement | null>(null);

  useLayoutEffect(() => {
    if (isVisible) setHost(topModalDialog());
  }, [isVisible]);

  useLayoutEffect(() => {
    if (isVisible && host) raiseToTopLayer(contextMenuRef.current);
  }, [isVisible, host]);
  const [dimensions, setDimensions] = useState({
    width: 0,
    height: 0,
    positionX: 0,
    positionY: 0,
    transformOrigin: 'top left'
  });

  const contextMenuStyles: CSSProperties = {};
  contextMenuStyles['--position-x'] = `${dimensions.positionX}px`;
  contextMenuStyles['--position-y'] = `${dimensions.positionY}px`;
  contextMenuStyles['--transform-origin'] = `${dimensions.transformOrigin}`;

  useLayoutEffect(() => {
    const { pageX, pageY } = contextMenuData;

    if (contextMenuRef.current) {
      const viewportHeight = window.innerHeight;
      const viewportWidth = window.innerWidth;
      const menuHeight = contextMenuRef.current.clientHeight;
      const menuWidth = contextMenuRef.current.clientWidth;
      // console.log('viewportHeight', viewportHeight, 'viewportWidth', viewportWidth, 'menuHeight', menuHeight, 'menuWidth', menuWidth, 'pageX', pageX, 'pageY', pageY);

      setDimensions({
        width: menuWidth,
        height: menuHeight,
        positionX: pageX + menuWidth > viewportWidth ? pageX - menuWidth : pageX,
        positionY:
          pageY + menuHeight > viewportHeight
            ? pageY -
              menuHeight +
              // ? 40px get added to stop the context menu from reaching the title-bar.
              // ? Height of the title bar is  40px (2.5rem).
              (pageY - menuHeight > 40 ? 0 : Math.abs(pageY - menuHeight) + 40)
            : pageY,
        transformOrigin: `${
          pageY + menuHeight > viewportHeight ? 'bottom' : 'top'
        } ${pageX + menuWidth > viewportWidth ? 'right' : 'left'}`
      });
    }
  }, [contextMenuData]);

  const contextMenuItems = useMemo(
    () =>
      menuItems
        .filter((menuItem) => !menuItem.isDisabled)
        .map((menuItem, index) => {
          if (menuItem.isContextMenuItemSeperator)
            return (
              <div
                key={index}
                role="separator"
                className="context-menu-item-seperator mx-1.5 my-1 h-px bg-glass-border"
              />
            );
          return (
            <ContextMenuItem
              key={menuItem.label}
              label={menuItem.label}
              iconName={menuItem.iconName}
              iconClassName={menuItem.iconClassName}
              class={menuItem.class}
              handlerFunction={menuItem.handlerFunction}
              fileDrag={menuItem.fileDrag}
            />
          );
        }),
    [menuItems]
  );
  const menu = (
    <div
      popover={host ? 'manual' : undefined}
      className={`context-menu ${
        isVisible
          ? 'visible scale-100 opacity-100 duration-[140ms]'
          : 'invisible scale-[0.96] opacity-0 duration-[90ms]'
      } ${host ? 'fixed inset-auto m-0' : 'absolute'} z-50 h-fit max-h-[calc(100vh-3rem)] w-fit min-w-[14.5rem] max-w-[22rem] overflow-y-auto rounded-menu border border-glass-border bg-glass p-[5px] text-ink shadow-float backdrop-blur-[26px] backdrop-saturate-[1.7] transition-[opacity,transform,visibility] ease-out`}
      onClick={(e) => e.stopPropagation()}
      style={{
        top: dimensions.positionY,
        left: dimensions.positionX,
        // transform: `translate(${dimensions.positionX}px,${dimensions.positionY}px)`,
        transformOrigin: dimensions.transformOrigin
      }}
      ref={contextMenuRef}
      tabIndex={isVisible ? 0 : -1}
      role="menu"
    >
      {data && <ContextMenuDataItem data={data} />}
      {contextMenuItems}
    </div>
  );

  return host ? createPortal(menu, host) : menu;
});

ContextMenu.displayName = 'ContextMenu';
export default ContextMenu;
