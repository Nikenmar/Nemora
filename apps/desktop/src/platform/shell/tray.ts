import type { WindowPort } from './types';

export interface TrayHandle {
  close(): Promise<void>;
}

export interface TrayFactory {
  create(options: {
    tooltip: string;
    onToggleVisibility: () => void;
    onExit: () => void;
  }): Promise<TrayHandle>;
}

export interface ExitPort {
  exit(code: number): Promise<void>;
}

export class TrayController {
  private readonly window: WindowPort;
  private readonly factory: TrayFactory;
  private readonly process: ExitPort;
  private readonly beforeExit: (() => Promise<void>) | undefined;
  private tray: TrayHandle | undefined;
  private exiting = false;

  /**
   * `beforeExit` runs before the process is killed. Exit from the tray does not
   * pass through the window at all, so nothing else would give the renderer the
   * chance to write the playback position and the repeat/shuffle state.
   */
  constructor(
    window: WindowPort,
    factory: TrayFactory,
    process: ExitPort,
    beforeExit?: () => Promise<void>
  ) {
    this.window = window;
    this.factory = factory;
    this.process = process;
    this.beforeExit = beforeExit;
  }

  async start(): Promise<void> {
    if (this.tray) return;
    this.tray = await this.factory.create({
      tooltip: 'Nemora',
      onToggleVisibility: () => void this.toggleVisibility(),
      onExit: () => void this.exit()
    });
  }

  async stop(): Promise<void> {
    const tray = this.tray;
    this.tray = undefined;
    await tray?.close();
  }

  async toggleVisibility(): Promise<void> {
    if (await this.window.isVisible()) await this.window.hide();
    else {
      await this.window.show();
      await this.window.focus();
    }
  }

  async exit(): Promise<void> {
    if (this.exiting) return;
    this.exiting = true;
    // A failed persist must not trap the user in a running app: Exit means exit.
    if (this.beforeExit) await this.beforeExit().catch(() => undefined);
    await this.process.exit(0);
  }
}
