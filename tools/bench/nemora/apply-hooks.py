"""Keeps Nemora's copy of the scenario runner in step with tools/bench/app/bench.ts and wires it in.

    python tools/bench/nemora/apply-hooks.py

The Rust half lives in apps/desktop/src-tauri/src/bench.rs. Idempotent.
"""
import pathlib
import shutil

REPO = pathlib.Path(__file__).resolve().parents[3]
SRC = REPO / 'apps/desktop/src'

shutil.copyfile(REPO / 'tools/bench/app/bench.ts', SRC / 'renderer/src/other/bench.ts')


def patch(path, marker, old, new):
    text = path.read_text(encoding='utf-8')
    if marker in text:
        return
    assert text.count(old) == 1, f'{path}: {old[:60]}'
    path.write_text(text.replace(old, new), encoding='utf-8', newline='\n')


api = SRC / 'platform/api/index.ts'
patch(api, "from './bench'", "import { battery } from './battery';\n",
      "import { battery } from './battery';\nimport { bench } from './bench';\n")
patch(api, '  bench,\n', '  appControls,\n', '  appControls,\n  bench,\n')

app = SRC / 'renderer/src/App.tsx'
patch(app, "from './other/bench'", "import { AppUpdateContext",
      "import { registerBenchApp } from './other/bench';\nimport { AppUpdateContext")
text = app.read_text(encoding='utf-8')
if 'registerBenchApp({' not in text:
    lines = text.split('\n')
    start = next(i for i, line in enumerate(lines) if 'const changeCurrentActivePage = useCallback(' in line)
    end = next(i for i in range(start, len(lines)) if lines[i] == '  );')
    lines[end + 1:end + 1] = [
        '',
        '  useEffect(',
        '    () => registerBenchApp({ changeCurrentActivePage, playSong }),',
        '    [changeCurrentActivePage, playSong]',
        '  );',
    ]
    app.write_text('\n'.join(lines), encoding='utf-8', newline='\n')
print('bench hooks in place')
