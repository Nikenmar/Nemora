# Nemora logo

The mark: an N made of three layers — two Nora slabs (one big round corner each) and the diagonal between
them — each layer a tone of the brand blue `#1d4094`, with soft contact shadows where the layers overlap.
Every file here is plain SVG (shapes and gradients; no text, fonts or filters). The wordmark is Geologica
600, the app's UI font, as outlines.

| Folder | What |
|---|---|
| `mark/` | The mark in a 512 box: `color-light` (on white), `color-dark` (on the dark chrome `#08090c`), `color-on-blue` (on the brand blue), `flat-*` (no shadows), `one-blue`, `one-black`, `one-white` (one colour; the layers are parted by thin gaps). `mark/tight/` is the same, cropped to the letter. |
| `icon/` | The app icon: `white` (the one the app ships), `blue`, `black` tiles. `icon/small/` are the 16–48 px icons redrawn on the pixel grid; use them, not the 512 one scaled down. |
| `lockup/` | Mark and wordmark: `horizontal-*` and `stacked-*` for light, dark, on-blue and one colour. |
| `wordmark/` | The wordmark alone: `ink` (on light), `paper` and `white` (on dark), `blue`, `black`. |
| `other/` | The audio file icon, the installer header and sidebar, the README banner, the GitHub social preview. |

Colours: brand `#1d4094`, light step `#3986e4`, deep `#0f1646`; on dark the blues are lifted
(`#b5dcff` → `#1f3a8b`), since the brand blue on `#08090c` is about 2:1. Wordmark ink `#151e37` on light,
`#eff0f3` on dark.

Clear space around the mark: one stem width (a third of the letter's width). Smallest sizes: the icon at
16 px (from `icon/small/`), the horizontal lockup at 16 px cap height.

Shipped from these: `apps/desktop/src-tauri/icons/icon.ico` (white tile, 16–256 px),
`apps/desktop/src/renderer/src/assets/images/webp/logo_light_mode.webp` (title bar, loading screen, About),
`apps/desktop/src-tauri/installer/header.bmp` and `sidebar.bmp`, `nemoraAssociatedFileIcon.ico`,
`resources/banner.png`.
