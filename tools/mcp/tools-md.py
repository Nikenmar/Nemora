"""Writes apps/mcp/TOOLS.md from what the server itself answers (tools/list, resources/list).

Run after `cargo build --release -p nemora-mcp`: python tools/mcp/tools-md.py [path to nemora-mcp.exe]
"""
import json, os, subprocess, sys, tempfile
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
EXE = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, 'target', 'release', 'nemora-mcp.exe')
# An empty profile: listing tools reads no library.
p = subprocess.Popen([EXE, '--profile', tempfile.mkdtemp(prefix='nemora-mcp-doc-')], stdin=subprocess.PIPE, stdout=subprocess.PIPE)
n = 0


def req(method, params=None):
    global n
    n += 1
    p.stdin.write((json.dumps({'jsonrpc': '2.0', 'id': n, 'method': method, 'params': params or {}}) + '\n').encode())
    p.stdin.flush()
    while True:
        r = json.loads(p.stdout.readline())
        if r.get('id') == n:
            return r['result']


init = req('initialize', {'protocolVersion': '2025-11-25', 'capabilities': {}, 'clientInfo': {'name': 'doc', 'version': '1'}})
p.stdin.write(b'{"jsonrpc":"2.0","method":"notifications/initialized"}\n')
p.stdin.flush()
tools = req('tools/list')['tools']
resources = req('resources/list')['resources']
p.stdin.close()

out = ['# nemora-mcp tools', '',
       'Written from the server\'s own answers (`tools/list`, `resources/list`); regenerate it when a tool changes.',
       'Every tool returns `structuredContent` that matches its `outputSchema`, and a text copy of it.', '',
       '## Server instructions', '', 'Sent to the agent when it connects:', '', '```', init['instructions'], '```', '',
       '## Tools', '']
for t in sorted(tools, key=lambda t: t['name']):
    a = t.get('annotations', {})
    level = 'read' if a.get('readOnlyHint') else ('destructive' if a.get('destructiveHint', True) else 'write')
    out.append(f"### `{t['name']}` ({level})")
    out.append('')
    out.append(t['description'])
    out.append('')
    props = t['inputSchema'].get('properties', {})
    if props:
        out.append('| Parameter | Type | Meaning |')
        out.append('|---|---|---|')
        for name, spec in props.items():
            kind = spec.get('type') or ' / '.join(str(x.get('type', x.get('$ref', '').split('/')[-1])) for x in spec.get('anyOf', []))
            if isinstance(kind, list):
                kind = ' / '.join(kind)
            desc = (spec.get('description') or '').replace('\n', ' ')
            out.append(f'| `{name}` | {kind} | {desc} |')
        out.append('')
out += ['## Resources', '']
for r in resources:
    out.append(f"- `{r['uri']}`: {r['name']}")
open(os.path.join(ROOT, 'apps', 'mcp', 'TOOLS.md'), 'w', encoding='utf-8', newline='\n').write('\n'.join(out) + '\n')
print(len(tools), 'tools written')
