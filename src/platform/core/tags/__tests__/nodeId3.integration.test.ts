import { existsSync } from 'node:fs';
import { readFile, rename, rm, writeFile } from 'node:fs/promises';
import { Buffer } from 'node:buffer';

import NodeID3 from 'node-id3';

import type { TagFileIo } from '../io';
import { readNodeId3Tags, updateNodeId3Tags } from '../nodeId3';

const sourceFixture = 'E:\\tmp\\nora-tags-fixtures\\source.mp3';
const editedFixture = 'E:\\tmp\\nora-tags-fixtures\\edited.mp3';
const describeWithRealFixture = existsSync(sourceFixture) ? describe : describe.skip;

describeWithRealFixture('NodeID3 buffer operations over an E:\\tmp copy', () => {
  test('reads, updates, parses back, and delegates the replacement to the atomic seam', async () => {
    await writeFile(editedFixture, await readFile(sourceFixture));
    let atomicWrites = 0;
    const io: TagFileIo = {
      read: async (path) => readFile(path),
      writeAtomic: async (path, contents) => {
        atomicWrites += 1;
        const temporary = `${path}.test-atomic.tmp`;
        await writeFile(temporary, contents);
        await rm(path, { force: true });
        await rename(temporary, path);
      }
    };

    await updateNodeId3Tags(
      editedFixture,
      { title: 'Nora atomic tag integration test' },
      {
        io,
        validate: async (_path, contents) => {
          expect(NodeID3.read(Buffer.from(contents)).title).toBe(
            'Nora atomic tag integration test'
          );
        }
      }
    );

    expect(atomicWrites).toBe(1);
    const tags = await readNodeId3Tags(editedFixture, {}, io);
    expect(tags.title).toBe('Nora atomic tag integration test');
  }, 120_000);
});
