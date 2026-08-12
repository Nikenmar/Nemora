import { describe, expect, test } from '@jest/globals';

import {
  SECOND_INSTANCE_EVENT,
  SingleInstanceController,
  type FileArgumentPort,
  type SecondInstanceRoutes
} from '../singleInstance';
import { FakeEvents, FakeWindow } from './fakes';

/**
 * Opening a track from Explorer arrives by two different routes, and only one
 * of them was wired.
 *
 * A SECOND launch is reported by the single-instance plugin and forwarded as an
 * event. A FIRST launch is not: the file that started the app appears only in
 * this process's own argv, which production never passed in. So "Open with"
 * worked while the app was running and did nothing from a cold start, which is
 * the case that matters, because that is what double-clicking a file does when
 * the player is closed.
 */

const EXTENSIONS = ['.mp3', '.flac', '.wav'];

const controllerWith = (initialArgv?: readonly string[]) => {
  const opened: string[] = [];
  const auth: string[] = [];
  const files: FileArgumentPort = { isFile: async (path) => !path.endsWith('missing.flac') };
  const routes: SecondInstanceRoutes = {
    openAuthUri: (uri) => void auth.push(uri),
    openAudioFile: (path) => void opened.push(path)
  };
  const events = new FakeEvents();
  const controller = new SingleInstanceController(new FakeWindow(), events, files, routes, {
    supportedMusicExtensions: EXTENSIONS,
    initialArgv
  });
  return { controller, events, opened, auth };
};

describe('shell/single instance startup arguments', () => {
  test('a file passed on a cold start is opened once the renderer is ready', async () => {
    const { controller, opened } = controllerWith(['E:\\Music\\Track.flac']);

    await controller.start();
    // Nothing may be routed before the renderer can receive it.
    expect(opened).toEqual([]);

    await controller.markRendererReady();
    expect(opened).toEqual(['E:\\Music\\Track.flac']);
  });

  test('an empty argv opens nothing', async () => {
    const { controller, opened, auth } = controllerWith([]);

    await controller.start();
    await controller.markRendererReady();

    expect(opened).toEqual([]);
    expect(auth).toEqual([]);
  });

  test('unsupported extensions and paths that are not files are ignored', async () => {
    const { controller, opened } = controllerWith([
      '--some-flag',
      'E:\\Music\\notes.txt',
      'E:\\Music\\missing.flac',
      'E:\\Music\\Real.mp3'
    ]);

    await controller.start();
    await controller.markRendererReady();

    expect(opened).toEqual(['E:\\Music\\Real.mp3']);
  });

  test('a second instance still routes its file, alongside the startup one', async () => {
    const { controller, events, opened } = controllerWith(['E:\\Music\\First.flac']);

    await controller.start();
    await controller.markRendererReady();
    events.emit(SECOND_INSTANCE_EVENT, ['E:\\Music\\Second.mp3']);
    await controller.markRendererReady();

    expect(opened).toEqual(['E:\\Music\\First.flac', 'E:\\Music\\Second.mp3']);
  });
});
