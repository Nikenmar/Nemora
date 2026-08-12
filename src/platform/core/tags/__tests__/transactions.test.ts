import { TagIoError } from '../errors';
import { onTagFileWritten } from '../events';
import type { TagFileIo } from '../io';
import { updateNodeId3Tags } from '../nodeId3';

const mp3Header = Uint8Array.from([
  0xff, 0xfb, 0x90, 0x64, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0
]);

describe('atomic tag transactions', () => {
  test('a failed validation never calls the atomic writer', async () => {
    const writes: Uint8Array[] = [];
    const io: TagFileIo = {
      read: async () => mp3Header,
      writeAtomic: async (_path, contents) => {
        writes.push(contents);
      }
    };

    await expect(
      updateNodeId3Tags(
        'test.mp3',
        { title: 'new title' },
        {
          io,
          validate: async () => {
            throw new TagIoError('validation-failed', 'test.mp3', 'invalid candidate');
          }
        }
      )
    ).rejects.toMatchObject({ code: 'validation-failed' });
    expect(writes).toHaveLength(0);
  });

  test('successful writes emit only after the atomic writer finishes', async () => {
    const order: string[] = [];
    const io: TagFileIo = {
      read: async () => mp3Header,
      writeAtomic: async () => {
        order.push('commit');
      }
    };
    const unsubscribe = onTagFileWritten((event) => order.push(`event:${event.reason}`));
    try {
      await updateNodeId3Tags(
        'test.mp3',
        { title: 'new title' },
        {
          io,
          validate: async () => undefined
        }
      );
    } finally {
      unsubscribe();
    }
    expect(order).toEqual(['commit', 'event:node-id3-edit']);
  });
});
