import { extendTailwindMerge } from 'tailwind-merge';

/**
 * `twMerge` taught the redesign's tokens (tailwind.config.js): without it `text-page` reads as a
 * colour and is dropped when `text-ink` follows, and the radius and shadow tokens never merge.
 */
export const cn = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [{ text: ['micro', 'small', 'body', 'section', 'title', 'page', 'hero'] }],
      rounded: [{ rounded: ['menu', 'panel', 'dialog', 'cover-sm', 'cover', 'cover-lg'] }],
      shadow: [{ shadow: ['float'] }]
    }
  }
});

export default cn;
