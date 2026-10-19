#!/usr/bin/env node
/**
 * Writes apps/desktop/open_source_licenses.txt, the list Settings > About shows, from what the
 * Windows build actually ships:
 *
 *   - manual.txt: Nemora's own licence and the assets no package manager knows of (icons, fonts,
 *     illustrations);
 *   - the C++ vendored into the audio engine (crates/nemora-audio/vendor);
 *   - every Rust crate the Windows app depends on: normal dependencies, not build or dev ones
 *     (procedural macros count as normal ones and are credited too, though they only run while
 *     building);
 *   - every npm package bundled into the view: the lockfile's non-dev packages.
 *
 *   node tools/licenses/licenses.mjs           # rewrite the file
 *   node tools/licenses/licenses.mjs --check   # fail if it is out of date (CI)
 *
 * Short licences (MIT, BSD, ISC, Zlib...) carry each project's own copyright line, so their text is
 * printed per project, with projects sharing an identical text grouped. Long ones (Apache-2.0,
 * MPL-2.0...) are the same document everywhere: printed once at the end, after the list of what is
 * under them; a project's own NOTICE file, which Apache-2.0 requires to travel with it, is printed
 * with the project. For a choice of licences ("MIT OR Apache-2.0") the first of PREFERRED is taken.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = join(ROOT, 'apps/desktop/open_source_licenses.txt');
const MANUAL = join(dirname(fileURLToPath(import.meta.url)), 'manual.txt');
const SEPARATOR = '* * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * *';

/** Licences in the order one is chosen from an "OR"; anything else is taken as written. */
const PREFERRED = ['MIT', 'MIT-0', 'ISC', '0BSD', 'BSD-2-Clause', 'BSD-3-Clause', 'Zlib', 'Unlicense', 'CC0-1.0', 'Apache-2.0', 'BSL-1.0', 'Unicode-3.0', 'CDLA-Permissive-2.0', 'MPL-2.0'];
/** The same document for every project: printed once. */
const LONG = new Set(['Apache-2.0', 'MPL-2.0', 'BSL-1.0', 'Unicode-3.0', 'CC0-1.0', 'CDLA-Permissive-2.0']);

/** What a licence file's text is, from words only that licence uses. */
const KINDS = [
  ['Apache-2.0', /Apache License,?\s+Version 2\.0/i],
  ['MPL-2.0', /Mozilla Public License,?\s+(Version|v\.?)\s*2\.0/i],
  ['BSL-1.0', /Boost Software License/i],
  ['Unicode-3.0', /UNICODE LICENSE V3|UNICODE, INC\. LICENSE AGREEMENT/i],
  ['CDLA-Permissive-2.0', /Community Data License Agreement/i],
  ['CC0-1.0', /CC0 1\.0 Universal|Creative Commons Zero/i],
  ['Unlicense', /This is free and unencumbered software released into the public domain/i],
  // MIT without its one condition, the notice.
  ['MIT-0', /Permission is hereby granted, free of charge/i, (t) => !/subject to the following conditions/i.test(t)],
  ['MIT', /Permission is hereby granted, free of charge/i],
  ['0BSD', /Permission to use, copy, modify, and\/or distribute this software for any purpose with or without fee is hereby granted\.\s*THE SOFTWARE IS PROVIDED/i],
  ['ISC', /Permission to use, copy, modify, and\/or distribute this software for any/i],
  ['BSD-3-Clause', /Neither the name/i, (t) => /Redistribution and use in source and binary forms/i.test(t)],
  ['BSD-2-Clause', /Redistribution and use in source and binary forms/i],
  ['Zlib', /This software is provided ['‘]as-is['’]/i]
];
const kindOf = (text) => {
  const flat = text.replace(/\s+/g, ' ');
  return KINDS.find(([, pattern, extra]) => pattern.test(flat) && (!extra || extra(flat)))?.[0] ?? null;
};

const LICENCE_FILE = /^(licen[cs]e|copying|unlicense|notice|copyright)/i;
const read = (file) => readFileSync(file, 'utf8').replace(/^﻿/, '').replace(/\r\n?/g, '\n');
const files = (dir) =>
  existsSync(dir)
    ? readdirSync(dir)
        // An .spdx file describes the licence for machines; it is not its text.
        .filter((name) => LICENCE_FILE.test(name) && !/\.spdx$/i.test(name) && statSync(join(dir, name)).isFile())
        .sort()
        .map((name) => ({ name, text: read(join(dir, name)).trim() }))
    : [];

/**
 * The licences one complies with, from an SPDX-ish expression ("A OR B", "A/B", "(A OR B) AND C"):
 * of a choice, the preferred one whose text the project ships, else the preferred one.
 */
function chosen(expression, shipped) {
  return expression
    .replace(/[()]/g, ' ')
    .split(/\s+AND\s+/i)
    .map((part) =>
      part
        .split(/\s+OR\s+|\s*\/\s*/i)
        .map((id) => id.trim())
        .filter(Boolean)
    )
    .map(
      (options) =>
        PREFERRED.find((id) => options.includes(id) && shipped.has(id)) ??
        PREFERRED.find((id) => options.includes(id)) ??
        options[0]
    );
}

// --- what ships -----------------------------------------------------------------------------------

function rustCrates() {
  const metadata = JSON.parse(
    execFileSync('cargo', ['metadata', '--format-version', '1', '--locked', '--filter-platform', 'x86_64-pc-windows-msvc'], {
      cwd: ROOT,
      maxBuffer: 256 * 1024 * 1024,
      encoding: 'utf8'
    })
  );
  const byId = new Map(metadata.packages.map((p) => [p.id, p]));
  const nodes = new Map(metadata.resolve.nodes.map((n) => [n.id, n]));
  const app = metadata.packages.find((p) => p.name === 'nemora-desktop');
  const seen = new Set();
  const stack = [app.id];
  while (stack.length) {
    const id = stack.pop();
    if (seen.has(id)) continue;
    seen.add(id);
    for (const dep of nodes.get(id).deps) {
      if (dep.dep_kinds.some((k) => k.kind === null)) stack.push(dep.pkg);
    }
  }
  return [...seen]
    .map((id) => byId.get(id))
    .filter((p) => p.source) // the workspace's own crates are Nemora
    .map((p) => ({
      name: p.name,
      version: p.version,
      licence: p.license ?? null,
      home: p.repository ?? p.homepage ?? `https://crates.io/crates/${p.name}`,
      authors: p.authors ?? [],
      dir: dirname(p.manifest_path)
    }));
}

function npmPackages() {
  const desktop = join(ROOT, 'apps/desktop');
  const lock = JSON.parse(read(join(desktop, 'package-lock.json')));
  return Object.entries(lock.packages)
    .filter(([path, entry]) => path && !entry.dev && !entry.link)
    .map(([path, entry]) => {
      const dir = join(desktop, path);
      const manifest = existsSync(join(dir, 'package.json')) ? JSON.parse(read(join(dir, 'package.json'))) : {};
      const name = path.split('node_modules/').at(-1);
      const repository = typeof manifest.repository === 'string' ? manifest.repository : manifest.repository?.url;
      return {
        name,
        version: entry.version,
        licence: entry.license ?? manifest.license ?? null,
        home: (repository ?? manifest.homepage ?? `https://www.npmjs.com/package/${name}`).replace(/^git\+/, '').replace(/\.git$/, ''),
        authors: [typeof manifest.author === 'string' ? manifest.author : manifest.author?.name].filter(Boolean),
        dir,
        optional: Boolean(entry.optional)
      };
    })
    // Optional platform builds (a binary for macOS or Linux) are never bundled.
    .filter((p) => !p.optional || existsSync(p.dir));
}

/** The C++ copied into the audio engine; vendor/signalsmith/README.md says where each part is from. */
function vendored() {
  const root = join(ROOT, 'crates/nemora-audio/vendor/signalsmith');
  const from = {
    'signalsmith-stretch': 'https://github.com/Signalsmith-Audio/signalsmith-stretch',
    'signalsmith-linear': 'https://github.com/Signalsmith-Audio/linear',
    wrapper: 'https://github.com/colinmarc/signalsmith-stretch-rs'
  };
  return Object.entries(from).map(([name, home]) => ({
    name: `signalsmith/${name}`,
    version: 'vendored',
    licence: null,
    home,
    authors: [],
    dir: join(root, name)
  }));
}

// --- grouping -------------------------------------------------------------------------------------

const normalise = (text) => text.replace(/\s+/g, ' ').trim();
const long = new Map(); // licence id -> { text, projects }
const short = new Map(); // normalised text -> { text, projects }
const unknown = [];

function credit(project) {
  const found = files(project.dir);
  const classified = found.map((f) => ({ ...f, kind: kindOf(f.text) }));
  const shipped = new Set(classified.map((f) => f.kind).filter(Boolean));
  const ids = project.licence ? chosen(project.licence, shipped) : [...shipped];
  if (!ids.length) {
    unknown.push(project);
    return;
  }
  const label = `${project.name} ${project.version} (${project.home})`;
  for (const id of ids) {
    if (LONG.has(id)) {
      const entry = long.get(id) ?? { text: null, projects: [] };
      entry.text ??= classified.find((f) => f.kind === id)?.text ?? null;
      const notice = classified.find((f) => /^notice/i.test(f.name));
      entry.projects.push(notice ? `${label}\n\n${notice.text}` : label);
      long.set(id, entry);
      continue;
    }
    // The project's own text for this licence, or the only licence file it has.
    const own = classified.find((f) => f.kind === id) ?? (classified.length === 1 && !classified[0].kind ? classified[0] : null);
    const text = own?.text ?? standardText(id, project);
    if (!text) {
      unknown.push(project);
      continue;
    }
    const key = normalise(text);
    const entry = short.get(key) ?? { text, projects: [] };
    entry.projects.push(label);
    short.set(key, entry);
  }
}

/** For a project that names a short licence but ships no file of it: the standard wording. */
const STANDARD = {};
function standardText(id, project) {
  const template = STANDARD[id];
  if (!template) return null;
  // An SPDX description, when there is one, names the holder.
  const spdx = existsSync(project.dir) ? readdirSync(project.dir).find((name) => /\.spdx$/i.test(name)) : null;
  const declared = spdx && read(join(project.dir, spdx)).match(/^PackageCopyrightText:\s*(.+)$/m)?.[1].trim();
  const holders =
    declared || project.authors.map((a) => a.replace(/\s*<[^>]*>/, '')).join(', ') || `the ${project.name} authors`;
  return template.replace(/^Copyright.*$/m, `Copyright (c) ${holders}`);
}

// --- output ---------------------------------------------------------------------------------------

/** Code-unit order: the same on every machine, unlike a locale's. */
const byText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const heading = (title) =>`${title}\n${'='.repeat(title.length)}`;
const block = (title, body) => `${heading(title)}\n\n${body.trim()}\n\n${SEPARATOR}\n`;
const shortName = (projects) => {
  const names = [...new Set(projects.map((p) => p.split(' ')[0]))];
  return (names.length > 3 ? `${names.slice(0, 3).join(', ')} and ${names.length - 3} more` : names.join(', ')).toUpperCase();
};

const crates = rustCrates();
const packages = npmPackages();
const all = [...vendored(), ...crates, ...packages].sort((a, b) => byText(a.name, b.name) || byText(a.version, b.version));

// A standard text for each short licence, from a project that ships one, with its copyright
// line to be replaced.
for (const project of all) {
  for (const f of files(project.dir)) {
    const kind = kindOf(f.text);
    if (kind && !LONG.has(kind) && !STANDARD[kind] && /^Copyright/m.test(f.text)) STANDARD[kind] = f.text;
  }
}
for (const project of all) credit(project);

if (unknown.length) {
  console.error(`no licence found for:\n${unknown.map((p) => `  ${p.name} ${p.version} (${p.dir})`).join('\n')}`);
  process.exit(1);
}
const missingText = [...long].filter(([, entry]) => !entry.text).map(([id]) => id);
if (missingText.length) {
  console.error(`no project ships the text of ${missingText.join(', ')}`);
  process.exit(1);
}

const parts = [read(MANUAL).trimEnd(), ''];
parts.push(
  block(
    'SQLITE',
    'SQLite is compiled into Nemora (through the libsqlite3-sys crate, credited below). It is in the public domain: https://sqlite.org/copyright.html'
  )
);
for (const entry of [...short.values()].sort((a, b) => byText(a.projects[0], b.projects[0]))) {
  parts.push(block(shortName(entry.projects), `${entry.projects.join('\n')}\n\n${entry.text}`));
}
for (const [id, entry] of [...long].sort(([a], [b]) => byText(a, b))) {
  const source =
    id === 'MPL-2.0'
      ? 'The source code of these projects is available at the addresses given.\n\n'
      : '';
  parts.push(block(`UNDER ${id}`, `${entry.projects.join('\n\n')}\n\n${source}${entry.text}`));
}
const text = `${parts.join('\n')}\n`;

if (process.argv.includes('--check')) {
  const current = existsSync(OUT) ? read(OUT) : '';
  if (current !== text) {
    console.error(`${OUT} is out of date: run node tools/licenses/licenses.mjs`);
    process.exit(1);
  }
  console.log('licences up to date');
} else {
  writeFileSync(OUT, text);
  console.log(
    `wrote ${OUT}: ${crates.length} crates, ${packages.length} npm packages, ${short.size} short texts, ${long.size} long (${(text.length / 1024).toFixed(0)} KB)`
  );
}
