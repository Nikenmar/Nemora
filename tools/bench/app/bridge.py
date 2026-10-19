"""Puts the scenario runner's bridge into a view's App.tsx; shared by the Nora and Nemora scripts.

The bridge hands the runner App's own navigation, playback, queue and seek callbacks. It goes right
after the last of them is defined, and replaces an earlier version of itself.
"""
import re

CALLBACKS = ['changeCurrentActivePage', 'playSong', 'createQueue', 'updateSongPosition']

BLOCK = [
    '',
    '  useEffect(',
    '    () =>',
    '      registerBenchApp({',
    '        changeCurrentActivePage,',
    '        playSong,',
    '        createQueue,',
    '        updateSongPosition,',
    '        currentSongId: () => store.state.currentSongData?.songId',
    '      }),',
    '    [changeCurrentActivePage, playSong, createQueue, updateSongPosition]',
    '  );',
]

OLD = re.compile(r'\n\n  useEffect\(\s*\(\) =>\s*registerBenchApp\(\{.*?\}\),?\s*\[[^\]]*\]\s*\);', re.S)


def end_of(lines, start):
    """The line that closes the useCallback opened at `start`."""
    for i in range(start, len(lines)):
        line = lines[i]
        if line == '  );' or (line.startswith('  }, [') and line.endswith(');')):
            return i
    raise SystemExit(f'cannot find the end of the callback at line {start + 1}')


def put_bridge(text):
    text = OLD.sub('', text)
    lines = text.split('\n')
    ends = []
    for name in CALLBACKS:
        start = next(i for i, line in enumerate(lines) if f'const {name} = useCallback(' in line)
        ends.append(end_of(lines, start))
    at = max(ends) + 1
    lines[at:at] = BLOCK
    return '\n'.join(lines)
