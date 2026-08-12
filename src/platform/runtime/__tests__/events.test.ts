import { afterEach, describe, expect, jest, test } from '@jest/globals';

jest.mock('../../api/events', () => ({ emitLocal: jest.fn() }));

import { emitLocal } from '../../api/events';
import { LocalRuntimeEventSink } from '../events';

const emitLocalMock = jest.mocked(emitLocal);

afterEach(() => {
  jest.useRealTimers();
  emitLocalMock.mockReset();
});

describe('LocalRuntimeEventSink', () => {
  test('coalesces data updates for one second and emits the legacy event payload', () => {
    jest.useFakeTimers();
    const sink = new LocalRuntimeEventSink();

    sink.dataUpdated('songs/likes', ['one']);
    sink.dataUpdated('songs/likes', ['two'], 'changed');
    sink.dataUpdated('playlists/history');
    jest.advanceTimersByTime(999);
    expect(emitLocalMock).not.toHaveBeenCalled();

    jest.advanceTimersByTime(1);
    expect(emitLocalMock).toHaveBeenCalledTimes(1);
    expect(emitLocalMock).toHaveBeenCalledWith('app/dataUpdateEvent', [
      {
        dataType: 'songs/likes',
        eventData: [
          { data: ['one'], message: undefined },
          { data: ['two'], message: 'changed' }
        ]
      },
      { dataType: 'playlists/history', eventData: [] }
    ]);
  });

  test('emits messages immediately with the unchanged channel and payload', () => {
    const sink = new LocalRuntimeEventSink();
    sink.message('PLAYLIST_RENAME_SUCCESS', { name: 'Road Trip' });

    expect(emitLocalMock).toHaveBeenCalledWith(
      'app/sendMessageToRendererEvent',
      'PLAYLIST_RENAME_SUCCESS',
      { name: 'Road Trip' }
    );
  });
});
