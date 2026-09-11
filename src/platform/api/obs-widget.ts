import { invoke } from '@tauri-apps/api/core';

/**
 * The push side of the OBS now-playing widget.
 *
 * The widget is a Browser Source pointed at the loopback server in
 * `src-tauri/src/widget_server.rs`; this is the only thing that ever tells
 * that server what to show. Nothing is stored here - the Rust side keeps the
 * current state and discards a push that would not change it - so every caller
 * may push as often as it likes.
 */

export type ObsWidgetUpNext = {
  title: string;
  artist?: string;
  /** How many further artists the popup abbreviates as "+N". */
  extra: number;
};

export type ObsWidgetState = {
  title?: string;
  /** Already joined: the widget renders one artist line, not a list. */
  artists?: string;
  playing: boolean;
  /** Set only while the in-app "UP NEXT" popup is on screen. */
  upNext?: ObsWidgetUpNext;
  /**
   * The renderer's `artworkPath` as-is. It is a
   * `http://nemora.localhost/<encoded path>` URL for local artwork, which the
   * server turns back into a path and reads - the image bytes never cross IPC.
   */
  art?: string;
};

export const obsWidget = {
  /**
   * Opens or closes the loopback socket, following `enableObsWidget`.
   *
   * The renderer re-asserts the preference on every launch rather than the
   * shell reading it: the shell has no notion of the user profile, and the
   * profile is not even readable at the point the window is created.
   */
  setEnabled: (enabled: boolean): Promise<void> => invoke<void>('widget_set_enabled', { enabled }),

  setState: (state: ObsWidgetState): void => {
    void invoke('widget_set_state', { state }).catch((error: unknown) =>
      console.error('Failed to update the OBS widget state.', error)
    );
  }
};
