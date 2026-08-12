"""Converts the app's Poppins woff2 files to ttf for the benchmark card.

Satori reads ttf, otf and woff, but not woff2, and the repository ships only
woff2 because that is what the renderer wants. Rather than commit a second copy
of the same typeface, the card converts on demand into a scratch directory.
"""

import os
from fontTools.ttLib import TTFont

SOURCE = os.path.join('src', 'renderer', 'src', 'assets', 'fonts')
DESTINATION = os.environ.get('NEMORA_FONT_DIR', r'E:\tmp\nemora-fonts')
FACES = ('Poppins-Regular', 'Poppins-Medium', 'Poppins-SemiBold')

os.makedirs(DESTINATION, exist_ok=True)
for face in FACES:
    font = TTFont(os.path.join(SOURCE, face + '.woff2'))
    font.flavor = None  # drop the woff2 wrapper, leaving plain ttf
    target = os.path.join(DESTINATION, face + '.ttf')
    font.save(target)
    print(f'{face} -> {target} ({os.path.getsize(target)} bytes)')
