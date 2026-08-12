#!/usr/bin/env node
/**
 * The README header banner: a rounded card with the app icon and the name.
 *
 * Shaped after Nora's own banner, which is where the format comes from, minus
 * its screenshot collage: that one was a montage of the app's pages, and a
 * montage goes stale the moment the UI changes. This keeps the part that
 * identifies the product and leaves the screenshots to the feature sections,
 * where they are captioned and can be replaced one at a time.
 *
 * Everything is the app's own: the dark surface tokens, Poppins, and the icon
 * file the app ships. Rendered with Satori like the installer art and the
 * benchmark card, so the whole set is reproducible from source rather than
 * being three binaries nobody can regenerate.
 *
 * Outside the card is transparent, so the banner sits correctly on both the
 * light and dark GitHub themes.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const h = (type, props = {}, ...children) => ({
  type,
  props: { ...props, children: children.flat().filter(Boolean) }
});

const COLORS = {
  card: 'hsl(228, 7%, 14%)', // --dark-background-color-1
  edge: 'hsl(225, 8%, 22%)',
  text: 'hsl(0, 0%, 100%)',
  accent: 'hsl(213, 80%, 78%)' // --dark-text-color-highlight
};

const WIDTH = 1200;
const HEIGHT = 330;

const logo = readFileSync(join(root, 'resources/logo_light_mode.png'));
const logoUri = `data:image/png;base64,${logo.toString('base64')}`;

const banner = h(
  'div',
  {
    style: {
      display: 'flex',
      width: `${WIDTH}px`,
      height: `${HEIGHT}px`,
      // Transparent margin so the rounded corners are actually round on any
      // page background rather than sitting on a square of our own colour.
      padding: '10px',
      background: 'transparent',
      fontFamily: 'Poppins'
    }
  },
  h(
    'div',
    {
      style: {
        display: 'flex',
        flex: '1',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '38px',
        borderRadius: '26px',
        border: `1px solid ${COLORS.edge}`,
        // A quiet lift towards the logo's blue, so the card is not a flat
        // rectangle but does not compete with the mark either.
        backgroundImage: `linear-gradient(115deg, hsl(228, 7%, 12%) 0%, hsl(226, 9%, 16%) 55%, hsl(220, 14%, 19%) 100%)`,
        backgroundColor: COLORS.card
      }
    },
    h('img', { src: logoUri, width: 148, height: 148, style: { borderRadius: '30px' } }),
    h(
      'div',
      {
        style: {
          display: 'flex',
          alignItems: 'baseline',
          gap: '18px'
        }
      },
      h(
        'div',
        { style: { display: 'flex', fontSize: '84px', fontWeight: 500, color: COLORS.text } },
        'Nemora'
      ),
      h(
        'div',
        { style: { display: 'flex', fontSize: '46px', fontWeight: 400, color: COLORS.accent } },
        'Player'
      )
    )
  )
);

const FONT_DIR = process.env.NEMORA_FONT_DIR ?? 'E:/tmp/nemora-fonts';
const font = (file) => {
  const path = join(FONT_DIR, file);
  if (!existsSync(path)) throw new Error(`missing ${path}; run: python scripts/bench-fonts.py`);
  return readFileSync(path);
};

const svg = await satori(banner, {
  width: WIDTH,
  height: HEIGHT,
  fonts: [
    { name: 'Poppins', data: font('Poppins-Regular.ttf'), weight: 400, style: 'normal' },
    { name: 'Poppins', data: font('Poppins-Medium.ttf'), weight: 500, style: 'normal' },
    { name: 'Poppins', data: font('Poppins-SemiBold.ttf'), weight: 600, style: 'normal' }
  ]
});

const png = new Resvg(svg, {
  fitTo: { mode: 'width', value: WIDTH * 2 },
  background: 'rgba(0,0,0,0)'
})
  .render()
  .asPng();

const out = join(root, 'resources/banner.png');
writeFileSync(out, png);
process.stdout.write(`wrote ${out} (${(png.length / 1024).toFixed(0)} KB)\n`);
