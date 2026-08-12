from PIL import Image, ImageDraw, ImageFont
import os

LOGO = 'resources/logo_light_mode.png'
OUT = 'src-tauri/installer'
os.makedirs(OUT, exist_ok=True)

# The app's dark surface, so the installer reads as the same product.
DARK = (18, 19, 22)
TEXT = (233, 235, 240)
MUTED = (170, 178, 192)

logo = Image.open(LOGO).convert('RGBA')


def font(size, weight='segoeuil.ttf'):
    for name in (weight, 'segoeui.ttf', 'arial.ttf'):
        path = os.path.join(os.environ.get('WINDIR', r'C:\Windows'), 'Fonts', name)
        if os.path.exists(path):
            try:
                return ImageFont.truetype(path, size)
            except Exception:
                pass
    return ImageFont.load_default()


def paste_logo(canvas, box_size, xy):
    """Alpha-composites the logo scaled to box_size with its top-left at xy."""
    scaled = logo.resize((box_size, box_size), Image.LANCZOS)
    canvas.alpha_composite(scaled, xy)


# --- Sidebar: 164 x 314, shown on the Welcome and Finish pages -----------------
side = Image.new('RGBA', (164, 314), DARK + (255,))
paste_logo(side, 96, ((164 - 96) // 2, 74))

draw = ImageDraw.Draw(side)
name_font = font(23)
sub_font = font(12)


def centered(text, y, f, fill):
    w = draw.textbbox((0, 0), text, font=f)[2]
    draw.text(((164 - w) // 2, y), text, font=f, fill=fill)


centered('Nemora', 186, name_font, TEXT)
centered('music player', 214, sub_font, MUTED)
side.convert('RGB').save(os.path.join(OUT, 'sidebar.bmp'), 'BMP')

# --- Header: 150 x 57, sits on the white strip of every other page ------------
# White ground on purpose: NSIS draws this band white, and a dark tile would
# read as a misplaced rectangle rather than as branding.
head = Image.new('RGBA', (150, 57), (255, 255, 255, 255))
paste_logo(head, 41, (8, 8))
hdraw = ImageDraw.Draw(head)
hdraw.text((57, 19), 'Nemora', font=font(17), fill=(24, 26, 30))
head.convert('RGB').save(os.path.join(OUT, 'header.bmp'), 'BMP')

for f in ('sidebar.bmp', 'header.bmp'):
    p = os.path.join(OUT, f)
    im = Image.open(p)
    print(f, im.size, im.mode, os.path.getsize(p), 'bytes')
