/*
 * Oracle: 1.1.9's LRC parser on hand-written edge cases and generated lyrics.
 * Regenerate with `tools/oracle/run.ps1 -Name lyrics`.
 */
import parseLyrics from '@old/common/parseLyrics';

const makePrng = (seed: number) => () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const prng = makePrng(99);
const pick = <T>(list: T[]) => list[Math.floor(prng() * list.length)];
const ts = (s: number, digits = 2) => {
  const m = Math.floor(s / 60);
  const rest = (s - m * 60).toFixed(digits);
  return `[${String(m).padStart(2, '0')}:${rest.padStart(digits + 3, '0')}]`;
};

const handWritten = [
  '[ti:Song]\n[ar:Artist]\n[00:01.00]one\n[00:02.50]two\n[00:04.00]three',
  '[offset:+250]\n[copyright:Someone]\n[lang:en]\n[00:01.00]with tags',
  '[00:01.00]line\n[00:01.00][lang:ru]строка\n[00:03.00]next\n[00:03.00][lang:ru]дальше',
  '[00:01.00]<00:01.00> word <00:01.50> by <00:02.00> word\n[00:03.00]<00:03.00> second <00:03.40> line',
  'plain one\n[lang:es]uno\nplain two\n[lang:es]dos',
  '[00:01.00]\n[00:02.00]after an empty timed line\n[00:05.00] ',
  '[00:01.00]crlf line\r\n[00:02.00]another\r\n',
  '[00:12.125]tie\n[00:12.13]near tie\n[00:20.000]end',
  '[01:02.3]short ms\n[10:00.99]ten minutes',
  'just plain text without any tags',
  '[00:01.00][00:05.00]compressed lrc',
  '[ab]two letter tag line\n[00:02.00]timed',
  '[00:01.00]ひかりの なかで\n[00:03.00]こころが',
  '[00:01.00]안녕하세요 여러분\n[00:02.00]감사합니다',
  '[00:01.00]月亮代表我的心\n[00:02.00]你问我爱你有多深',
  '',
  '\n\n\n',
  '[00:01.00]text with ] bracket\n[00:02.00][brackets] inside',
  '[00:01.00]<00:01.00>half<00:01.20>words without spaces'
];

const WORDS = ['love', 'night', 'drive', 'звезда', 'город', 'sky', 'rain', 'fire', 'hello', 'world', '...', '♪'];
const generated = Array.from({ length: 120 }, () => {
  const lines: string[] = [];
  if (prng() < 0.3) lines.push(`[ti:${pick(WORDS)}]`);
  if (prng() < 0.2) lines.push(`[offset:${pick(['-100', '+300', '0'])}]`);
  if (prng() < 0.2) lines.push('[lang:en]');
  const synced = prng() < 0.75;
  let t = prng() * 10;
  const count = 1 + Math.floor(prng() * 15);
  for (let i = 0; i < count; i += 1) {
    const text = Array.from({ length: 1 + Math.floor(prng() * 5) }, () => pick(WORDS)).join(' ');
    if (synced) {
      const stamp = ts(t, pick([2, 2, 3]));
      if (prng() < 0.15) {
        let w = t;
        lines.push(stamp + text.split(' ').map((word) => { const s = `<${ts(w).slice(1, -1)}>`; w += 0.3; return `${s} ${word}`; }).join(' '));
      } else lines.push(`${stamp}${prng() < 0.05 ? '' : text}`);
      if (prng() < 0.2) lines.push(`${stamp}[lang:${pick(['ru', 'es', 'JA'])}]${pick(WORDS)}`);
      t += 0.5 + prng() * 6;
    } else {
      lines.push(text);
      if (prng() < 0.2) lines.push(`[lang:${pick(['ru', 'es'])}]${pick(WORDS)}`);
    }
  }
  return lines.join(prng() < 0.1 ? '\r\n' : '\n');
});

const cases = [...handWritten, ...generated].map((input) => ({ input, output: parseLyrics(input) }));
process.stdout.write(JSON.stringify({ generatedFrom: '1.1.9 (326f15b)', cases }));
