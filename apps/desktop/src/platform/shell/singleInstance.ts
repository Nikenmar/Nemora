import type { ShellEventPort, Unlisten, WindowPort } from './types';

export const SECOND_INSTANCE_EVENT = 'nemora://second-instance';

export interface FileArgumentPort {
  isFile(path: string): Promise<boolean>;
}

export interface SecondInstanceRoutes {
  openAuthUri(uri: string): void | Promise<void>;
  openAudioFile(path: string): void | Promise<void>;
}

export interface SingleInstanceOptions {
  supportedMusicExtensions: readonly string[];
  initialArgv?: readonly string[];
}

const extensionOf = (path: string): string => {
  const fileName = path.replaceAll('\\', '/').split('/').at(-1) ?? path;
  const index = fileName.lastIndexOf('.');
  return index < 0 ? '' : fileName.slice(index + 1).toLocaleLowerCase('en-US');
};

export class SingleInstanceController {
  private readonly window: WindowPort;
  private readonly events: ShellEventPort;
  private readonly files: FileArgumentPort;
  private readonly routes: SecondInstanceRoutes;
  private readonly extensions: ReadonlySet<string>;
  private readonly pending: string[][] = [];
  private readonly initialArgv: readonly string[];
  private unlisten: Unlisten | undefined;
  private ready = false;
  private processing = Promise.resolve();

  constructor(
    window: WindowPort,
    events: ShellEventPort,
    files: FileArgumentPort,
    routes: SecondInstanceRoutes,
    options: SingleInstanceOptions
  ) {
    this.window = window;
    this.events = events;
    this.files = files;
    this.routes = routes;
    this.extensions = new Set(
      options.supportedMusicExtensions.map((extension) =>
        extension.replace(/^\./u, '').toLocaleLowerCase('en-US')
      )
    );
    this.initialArgv = options.initialArgv ?? [];
  }

  async start(): Promise<void> {
    if (this.unlisten) return;
    this.unlisten = await this.events.listen<string[]>(SECOND_INSTANCE_EVENT, (argv) =>
      this.enqueue(argv)
    );
    if (this.initialArgv.length > 0) this.enqueue(this.initialArgv);
  }

  stop(): void {
    this.unlisten?.();
    this.unlisten = undefined;
  }

  async markRendererReady(): Promise<void> {
    this.ready = true;
    const queued = this.pending.splice(0);
    for (const argv of queued) this.enqueue(argv);
    await this.processing;
  }

  private enqueue(argv: readonly string[]): void {
    const copy = [...argv];
    if (!this.ready) {
      this.pending.push(copy);
      return;
    }
    this.processing = this.processing.then(() => this.handle(copy));
  }

  private async handle(argv: readonly string[]): Promise<void> {
    await this.restoreAndFocus();

    const authUri = argv.find((argument) =>
      argument.toLocaleLowerCase('en-US').startsWith('nemora://auth')
    );
    if (authUri) await this.routes.openAuthUri(authUri);

    for (const argument of argv) {
      if (!this.extensions.has(extensionOf(argument))) continue;
      if (!(await this.files.isFile(argument))) continue;
      await this.routes.openAudioFile(argument);
      break;
    }
  }

  private async restoreAndFocus(): Promise<void> {
    if (await this.window.isMinimized()) await this.window.unminimize();
    if (!(await this.window.isVisible())) await this.window.show();
    await this.window.focus();
  }
}
