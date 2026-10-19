"""Builds the benchmark hooks into a checkout of Nora v3.1.0-stable.

    python tools/bench/nora/apply-patch.py <nora checkout>

Idempotent: a file that already carries a hook is left alone. The hooks only act when the app is
started with --bench=<folder>; without it the build behaves as the release did.
"""
import pathlib
import shutil
import sys

ROOT = pathlib.Path(sys.argv[1])
HERE = pathlib.Path(__file__).resolve().parent


def patch(relative, edits):
    path = ROOT / relative
    raw = path.read_bytes().decode('utf-8')
    crlf = '\r\n' in raw
    text = raw.replace('\r\n', '\n')
    for marker, old, new in edits:
        if marker in text:
            continue
        if old not in text:
            sys.exit(f'{relative}: cannot find the place for the hook:\n{old}')
        text = text.replace(old, new, 1)
    if crlf:
        text = text.replace('\n', '\r\n')
    path.write_bytes(text.encode('utf-8'))


# The main-process half and the shared scenario runner.
shutil.copyfile(HERE / 'bench-main.ts', ROOT / 'src/main/bench.ts')
shutil.copyfile(HERE.parent / 'app/bench.ts', ROOT / 'src/renderer/src/other/bench.ts')

patch('src/main/main.ts', [
    # First import: the stores open while their modules load, so the profile moves before them.
    ("from './bench'", "import path, { join } from 'path';",
     "import { BENCH_DIR, benchMark } from './bench';\nimport path, { join } from 'path';"),
    # A run must not register itself as the handler of nora:// for the whole user account.
    ('!BENCH_DIR && !app.isDefaultProtocolClient', 'if (!app.isDefaultProtocolClient(DEFAULT_APP_PROTOCOL)) {',
     'if (!BENCH_DIR && !app.isDefaultProtocolClient(DEFAULT_APP_PROTOCOL)) {'),
    ('if (!BENCH_DIR) checkForUpdates();', '      checkForUpdates();', '      if (!BENCH_DIR) checkForUpdates();'),
    # Global shortcuts belong to the whole desktop.
    ("if (!BENCH_DIR) globalShortcut.register('F12'", "      globalShortcut.register('F12', () => {",
     "      if (!BENCH_DIR) globalShortcut.register('F12', () => {"),
    ("benchMark('renderer-loaded')", "    mainWindow.webContents.once('did-finish-load', manageWindowFinishLoad);",
     "    mainWindow.webContents.once('did-finish-load', manageWindowFinishLoad);\n"
     "    mainWindow.webContents.once('did-finish-load', () => benchMark('renderer-loaded'));"),
])

patch('src/main/ipc.ts', [
    ("from './bench'", "import logger, { logFilePath } from './logger';",
     "import logger, { logFilePath } from './logger';\nimport { benchConfig, benchMark } from './bench';"),
    ("'bench/config'", "    ipcMain.on('app/close', () => app.quit());",
     "    ipcMain.on('app/close', () => app.quit());\n\n"
     "    ipcMain.handle('bench/config', () => benchConfig());\n"
     "    ipcMain.on('bench/mark', (_, name: string, at: number, data?: unknown) => benchMark(name, at, data));\n"
     "    ipcMain.on('bench/quit', () => app.quit());"),
    ('benchSignal } from', "import { benchConfig, benchMark } from './bench';",
     "import { benchConfig, benchMark, benchSignal } from './bench';"),
    ("'bench/signal'", "    ipcMain.on('bench/quit', () => app.quit());",
     "    ipcMain.handle('bench/signal', (_, name: string) => benchSignal(name));\n"
     "    ipcMain.on('bench/quit', () => app.quit());"),
])

patch('src/main/other/generatePalette.ts', [
    ("from '../bench'", "import logger from '../logger';", "import logger from '../logger';\nimport { benchMark } from '../bench';"),
    ("benchMark('palettes-done')", '      setTimeout(generatePalettesForGenres, 1000);',
     "      setTimeout(\n"
     "        () => void Promise.resolve(generatePalettesForGenres()).finally(() => benchMark('palettes-done')),\n"
     "        1000\n"
     "      );"),
])

patch('src/preload/index.ts', [
    ("'bench/config'", '// $ OTHER\nconst utils = {',
     "// $ BENCHMARK (tools/bench in the Nemora repository)\n"
     "const bench = {\n"
     "  config: () => ipcRenderer.invoke('bench/config'),\n"
     "  mark: (name: string, at: number, data?: unknown) => ipcRenderer.send('bench/mark', name, at, data),\n"
     "  quit: () => ipcRenderer.send('bench/quit')\n"
     "};\n\n"
     "// $ OTHER\nconst utils = {"),
    ('  bench,\n  utils\n};', '  appControls,\n  utils\n};', '  appControls,\n  bench,\n  utils\n};'),
    ("'bench/signal'", "  quit: () => ipcRenderer.send('bench/quit')\n",
     "  signal: (name: string): Promise<boolean> => ipcRenderer.invoke('bench/signal', name),\n"
     "  quit: () => ipcRenderer.send('bench/quit')\n"),
])

patch('src/renderer/src/App.tsx', [
    ("from './other/bench'", "import { releaseNotes, version, appPreferences } from '../../../package.json';",
     "import { releaseNotes, version, appPreferences } from '../../../package.json';\n"
     "import { isBenchRun, registerBenchApp } from './other/bench';"),
    # An old build asked about updates opens the release notes over the page being measured.
    ('const checkUnlessBenchmark', '      const timeoutId = setTimeout(checkForAppUpdates, 5000);',
     '      const checkUnlessBenchmark = () =>\n'
     '        void isBenchRun().then((benchmark) => benchmark || checkForAppUpdates());\n'
     '      const timeoutId = setTimeout(checkUnlessBenchmark, 5000);'),
    ('setInterval(checkUnlessBenchmark', '      const intervalId = setInterval(checkForAppUpdates, 1000 * 60 * 15);',
     '      const intervalId = setInterval(checkUnlessBenchmark, 1000 * 60 * 15);'),
])

# The bridge goes right after changeCurrentActivePage, the later of the two callbacks it hands over.
app = ROOT / 'src/renderer/src/App.tsx'
raw = app.read_bytes().decode('utf-8')
crlf = '\r\n' in raw
lines = raw.replace('\r\n', '\n').split('\n')
if not any('registerBenchApp({' in line for line in lines):
    start = next(i for i, line in enumerate(lines) if 'const changeCurrentActivePage = useCallback(' in line)
    end = next(i for i in range(start, len(lines)) if lines[i] == '  );')
    lines[end + 1:end + 1] = [
        '',
        '  useEffect(',
        '    () => registerBenchApp({ changeCurrentActivePage, playSong }),',
        '    [changeCurrentActivePage, playSong]',
        '  );',
    ]
    text = '\n'.join(lines)
    app.write_bytes((text.replace('\n', '\r\n') if crlf else text).encode('utf-8'))

print('bench hooks in place')
