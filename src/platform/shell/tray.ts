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
  private tray: TrayHandle | undefined;
  private exiting = false;

  constructor(window: WindowPort, factory: TrayFactory, process: ExitPort) {
    this.window = window;
    this.factory = factory;
    this.process = process;
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
    await this.process.exit(0);
  }
}
