// PLAN/21 P21.2: are the view's command types the ones the Rust commands say?
//
// The commands' types are generated from Rust into apps/desktop/src/platform/ipc/generated.ts
// (src-tauri/src/ipc_types.rs). This reads the view with the TypeScript compiler, finds every call
// of a command (`call`, `invoke`, `commands.invoke`, ... with the command's name as a string literal
// type) and compares, at that call:
//   - the answer the view expects (the call's type argument, written or inferred) with the
//     command's generated answer: equal when each is assignable to the other;
//   - the arguments the view sends with the command's generated arguments: assignable, nothing
//     extra, nothing required missing.
// A command answering `serde_json::Value` is untyped on the Rust side: its answer cannot be proven
// and is listed as such. A call whose answer the view does not read (`void`, `unknown`) proves
// nothing about the answer and is counted as unread.
//
// node tools/refactor/ipc-types-check.mjs [--json out.json] [--verbose]
// Exit code 1 when any call differs.
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { readFileSync, writeFileSync } from 'node:fs';

const EXPLAINED = JSON.parse(readFileSync(resolve(import.meta.dirname, 'ipc-types-explained.json'), 'utf8'));

const ROOT = resolve(import.meta.dirname, '../../apps/desktop');
const require = createRequire(resolve(ROOT, 'package.json'));
const ts = require('typescript');

const args = process.argv.slice(2);
const jsonOut = args.includes('--json') ? args[args.indexOf('--json') + 1] : null;
const verbose = args.includes('--verbose');

const configPath = resolve(ROOT, 'tsconfig.json');
const config = ts.readConfigFile(configPath, ts.sys.readFile);
const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, dirname(configPath));
const program = ts.createProgram(parsed.fileNames, parsed.options);
const checker = program.getTypeChecker();

const GENERATED = resolve(ROOT, 'src/platform/ipc/generated.ts').replace(/\\/g, '/');
const generatedFile = program.getSourceFile(GENERATED) ?? program.getSourceFiles().find((f) => f.fileName.endsWith('platform/ipc/generated.ts'));
if (!generatedFile) throw new Error('generated.ts is not in the program');
const iface = generatedFile.statements.find((s) => ts.isInterfaceDeclaration(s) && s.name.text === 'IpcCommands');
const commandsType = checker.getTypeAtLocation(iface);
const valueAlias = generatedFile.statements.find((s) => ts.isTypeAliasDeclaration(s) && s.name.text === 'Value');
const valueType = valueAlias ? checker.getTypeAtLocation(valueAlias) : null;

const generated = new Map();
for (const prop of commandsType.getProperties()) {
  const t = checker.getTypeOfSymbolAtLocation(prop, iface);
  const a = t.getProperty('args');
  const r = t.getProperty('ret');
  generated.set(prop.name, {
    args: checker.getTypeOfSymbolAtLocation(a, iface),
    ret: checker.getTypeOfSymbolAtLocation(r, iface)
  });
}

const show = (t) => checker.typeToString(t, undefined, ts.TypeFormatFlags.NoTruncation | ts.TypeFormatFlags.InTypeAlias);
const same = (a, b) => checker.isTypeAssignableTo(a, b) && checker.isTypeAssignableTo(b, a);
const mentionsValue = (t, seen = new Set()) => {
  if (!valueType || seen.has(t)) return false;
  seen.add(t);
  if (t === valueType || t.aliasSymbol?.name === 'Value') return true;
  if (t.isUnion() || t.isIntersection()) return t.types.some((u) => mentionsValue(u, seen));
  if (checker.isArrayType(t) || checker.isTupleType(t)) return checker.getTypeArguments(t).some((u) => mentionsValue(u, seen));
  // A named type of the generated file whose field is a Value: still partly untyped.
  if (t.getSymbol()?.declarations?.some((d) => d.getSourceFile() === generatedFile) && !(t.flags & ts.TypeFlags.Primitive)) {
    return t.getProperties().some((p) => mentionsValue(checker.getTypeOfSymbolAtLocation(p, generatedFile), seen));
  }
  return false;
};
const withoutUndefined = (t) => (t.isUnion() ? checker.getUnionType?.(t.types.filter((u) => !(u.flags & ts.TypeFlags.Undefined))) ?? t : t);
const hasNull = (t) => (t.isUnion() ? t.types.some((u) => u.flags & ts.TypeFlags.Null) : !!(t.flags & ts.TypeFlags.Null));
const isList = (t) => checker.isArrayType(t);
const isObject = (t) =>
  !!(t.flags & ts.TypeFlags.Object) && !isList(t) && !checker.isTupleType(t) && t.getCallSignatures().length === 0 && t.getProperties().length > 0;
/** The object or array part of `T | null | undefined`, when there is exactly one. */
const core = (t) => {
  const parts = t.isUnion() ? t.types.filter((u) => !(u.flags & (ts.TypeFlags.Null | ts.TypeFlags.Undefined))) : [t];
  return parts.length === 1 ? parts[0] : null;
};

/**
 * Where the view's type and Rust's part, as a list of paths (empty: they agree).
 * `answer`: the view reads what Rust sends; equal both ways, or `wider` when the view accepts all
 * Rust sends and more. `args`: Rust reads what the view sends, by serde's rules: a field Rust
 * takes as `Option` may be missing or undefined; a field the view sends that Rust does not
 * declare is ignored by serde but listed.
 */
const compare = (view, rust, mode, path = '') => {
  const v = core(view);
  const r = core(rust);
  const nullsAgree = mode === 'args' ? !hasNull(view) || hasNull(rust) : hasNull(view) === hasNull(rust);
  if (v && r && isList(v) && isList(r)) {
    const inner = compare(checker.getTypeArguments(v)[0], checker.getTypeArguments(r)[0], mode, `${path}[]`);
    return nullsAgree ? inner : [`${path || '.'}: null view ${hasNull(view)} | rust ${hasNull(rust)}`, ...inner];
  }
  if (v && r && isObject(v) && isObject(r) && !v.isUnion() && !r.isUnion()) {
    const out = nullsAgree ? [] : [`${path || '.'}: null view ${hasNull(view)} | rust ${hasNull(rust)}`];
    for (const p of r.getProperties()) {
      const q = v.getProperty(p.name);
      const rt = checker.getTypeOfSymbol(p);
      const optionalInRust = !!(p.flags & ts.SymbolFlags.Optional) || hasNull(rt);
      if (!q) {
        if (!(mode === 'args' && optionalInRust)) out.push(`${path}.${p.name}: not in the view (rust ${show(rt)})`);
        continue;
      }
      const vt = checker.getTypeOfSymbol(q);
      const vOptional = !!(q.flags & ts.SymbolFlags.Optional);
      if (mode === 'answer' && vOptional && !(p.flags & ts.SymbolFlags.Optional)) {
        // The view allows the field to be missing; Rust always sends it. Wider, not wrong.
        out.push(...compare(withoutUndefined(vt), rt, mode, `${path}.${p.name}`).map((d) => d));
        continue;
      }
      if (mode === 'args' && vOptional && !optionalInRust) out.push(`${path}.${p.name}: may be missing in the view, required in rust`);
      out.push(...compare(mode === 'args' ? withoutUndefined(vt) : vt, rt, mode, `${path}.${p.name}`));
    }
    for (const q of v.getProperties()) if (!r.getProperty(q.name)) out.push(`${path}.${q.name}: only in the view (${show(checker.getTypeOfSymbol(q))})`);
    return out;
  }
  // Leaves: primitives, unions of literals, tuples, records.
  if (mentionsValue(rust)) {
    // Rust takes or sends any JSON here: nothing to prove at this path.
    untypedPaths.add(path || '.');
    return [];
  }
  const ok = mode === 'args' ? checker.isTypeAssignableTo(withoutUndefined(view), rust) : same(view, rust);
  return ok ? [] : [`${path || '.'}: view ${show(view)} | rust ${show(rust)}`];
};
const untypedPaths = new Set();
const UNREAD =ts.TypeFlags.Void | ts.TypeFlags.Unknown | ts.TypeFlags.Undefined | ts.TypeFlags.Any;

const calls = [];
for (const file of program.getSourceFiles()) {
  if (file.isDeclarationFile || file === generatedFile || file.fileName.includes('/node_modules/')) continue;
  const visit = (node) => {
    if (ts.isCallExpression(node) && node.arguments.length > 0) {
      const callee = node.expression;
      const name = ts.isIdentifier(callee) ? callee.text : ts.isPropertyAccessExpression(callee) ? callee.name.text : '';
      if (/^(call|invoke|invokeCommand)$/.test(name)) {
        const first = checker.getTypeAtLocation(node.arguments[0]);
        if (first.isStringLiteral() && generated.has(first.value)) {
          const command = first.value;
          const signature = checker.getResolvedSignature(node);
          const returned = signature ? checker.getReturnTypeOfSignature(signature) : null;
          const answer = returned ? checker.getAwaitedType(returned) ?? returned : null;
          const sent = node.arguments[1] ? checker.getTypeAtLocation(node.arguments[1]) : null;
          const { line } = file.getLineAndCharacterOfPosition(node.getStart());
          calls.push({ command, where: `${file.fileName.replace(/.*apps\/desktop\//, '')}:${line + 1}`, answer, sent });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
}

const report = new Map([...generated.keys()].map((k) => [k, { command: k, calls: [], answer: 'not called', args: 'not called' }]));
let differs = 0;
for (const c of calls) {
  const g = generated.get(c.command);
  const entry = report.get(c.command);
  const row = { where: c.where };
  // The answer.
  if (!c.answer || c.answer.flags & UNREAD) row.answer = 'unread';
  else if (mentionsValue(g.ret) && !isObject(core(g.ret) ?? g.ret)) row.answer = 'rust-untyped';
  else if (same(c.answer, g.ret)) row.answer = 'equal';
  else {
    untypedPaths.clear();
    const why = compare(c.answer, g.ret, 'answer');
    if (!why.length) row.answer = untypedPaths.size ? 'rust-untyped' : 'view-wider';
    else {
      row.answer = 'differs';
      row.view = show(c.answer);
      row.rust = show(g.ret);
      row.why = why;
    }
  }
  // The arguments.
  untypedPaths.clear();
  const why = c.sent
    ? compare(c.sent, g.args, 'args')
    : g.args.getProperties().filter((w) => !(w.flags & ts.SymbolFlags.Optional) && !hasNull(checker.getTypeOfSymbol(w))).map((w) => `.${w.name}: not sent`);
  if (why.length) {
    row.args = 'differs';
    row.argsView = c.sent ? show(c.sent) : '(none)';
    row.argsRust = show(g.args);
    row.why = [...(row.why ?? []), ...why];
  } else row.args = untypedPaths.size ? 'rust-untyped' : 'equal';
  // A difference looked at and written down with its reason (ipc-types-explained.json) is listed
  // as explained and does not fail the check.
  for (const part of ['answer', 'args']) {
    const reason = EXPLAINED[`${c.command} ${part}`];
    if (row[part] === 'differs' && reason) {
      row[part] = 'explained';
      row[`${part}Reason`] = reason;
    }
  }
  if (row.answer === 'differs' || row.args === 'differs') differs++;
  entry.calls.push(row);
}
const usedExplanations = new Set(
  [...report.values()].flatMap((e) => e.calls.flatMap((r) => ['answer', 'args'].filter((p) => r[p] === 'explained').map((p) => `${e.command} ${p}`)))
);
for (const key of Object.keys(EXPLAINED)) {
  if (!usedExplanations.has(key)) {
    console.log(`stale explanation (nothing differs there any more): ${key}`);
    differs++;
  }
}

const rank = { differs: 0, explained: 1, 'rust-untyped': 2, 'view-wider': 3, equal: 4, unread: 5, 'not called': 6 };
const worst = (rows, key) => rows.length ? rows.map((r) => r[key]).sort((a, b) => rank[a] - rank[b])[0] : 'not called';
const summary = { commands: generated.size, calls: calls.length, differs, answer: {}, args: {} };
for (const entry of report.values()) {
  entry.answer = worst(entry.calls, 'answer');
  entry.args = worst(entry.calls, 'args');
  // A command whose answer is read somewhere and equal there is proven, even if another call ignores it.
  if (entry.calls.some((r) => r.answer === 'equal') && !entry.calls.some((r) => r.answer === 'differs')) entry.answer = 'equal';
  summary.answer[entry.answer] = (summary.answer[entry.answer] ?? 0) + 1;
  summary.args[entry.args] = (summary.args[entry.args] ?? 0) + 1;
}

for (const entry of [...report.values()].sort((a, b) => rank[a.answer] - rank[b.answer] || a.command.localeCompare(b.command))) {
  if (!verbose && !['differs', 'explained'].includes(entry.answer) && !['differs', 'explained'].includes(entry.args)) continue;
  console.log(`${entry.command}: answer ${entry.answer}, args ${entry.args} (${entry.calls.length} calls)`);
  for (const r of entry.calls) {
    const why = (r) => (r.why ?? []).map((w) => '\n      ' + w).join('');
    if (r.answer === 'differs') console.log(`  ${r.where} answer\n    view: ${r.view}\n    rust: ${r.rust}${why(r)}`);
    if (r.args === 'differs') console.log(`  ${r.where} args\n    view: ${r.argsView}\n    rust: ${r.argsRust}${why(r)}`);
    if (r.answer === 'explained') console.log(`  ${r.where} answer explained: ${r.answerReason}`);
    if (r.args === 'explained') console.log(`  ${r.where} args explained: ${r.argsReason}`);
  }
}
console.log(JSON.stringify(summary));
if (jsonOut) writeFileSync(jsonOut, JSON.stringify({ summary, commands: [...report.values()] }, null, 2));
process.exit(differs ? 1 : 0);
