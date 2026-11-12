"""Builds the README pictures: the hero banner and one card per feature, from real shots of the app.

  node tools/redesign/shots.mjs --label readme2x --scale 2 --skip-empty --only <the ids in SHOTS below>
  python tools/readme/compose.py [--shots E:\\tmp\\nemora-shots\\readme2x\\png] [--only hero,shuffle] [--png]

Writes resources/readme/*.webp (and *.png next to them with --png). Needs Python with playwright and
Pillow; renders in headless Edge (or Chromium), no window. Text is Geologica, the app's font, from
the repo; the logo comes from resources/brand.
"""
import argparse, io, pathlib, sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
FONT = ROOT / "apps/desktop/src/renderer/src/assets/fonts/Geologica-latin.woff2"
BRAND = ROOT / "resources/brand"
OUT = ROOT / "resources/readme"
W, H = 1600, 900
# Rendered at 1.5x (2400 x 1350): sharp on a high-density screen at README width.
SCALE = 1.5

# Backgrounds: all from the brand blue, each card its own light.
BG = {
    "night": "radial-gradient(120% 90% at 85% 15%, #2a5fd0 0%, #163a8f 38%, #0b1640 75%, #070b1f 100%)",
    "deep": "radial-gradient(110% 100% at 10% 90%, #3b7be6 0%, #1d4094 40%, #0f1c52 80%)",
    "sky": "radial-gradient(120% 120% at 90% 100%, #9fc7ff 0%, #4f8fe8 45%, #1d4094 100%)",
    "ink": "radial-gradient(100% 120% at 0% 0%, #1d2b5e 0%, #0d132e 55%, #07090f 100%)",
    "dawn": "linear-gradient(135deg, #5d9bf0 0%, #2a5bc4 45%, #172f78 100%)",
}

# A shot is (id, theme, crop, place): crop (x0, y0, x1, y1) in the 1600 x 900 shot (a panel or dialog cut just
# inside its own 1 px border, so no backdrop shows at its edges) or None for the whole
# window, place (x, y, width) on the 1600 x 900 card. The copy sits on the side named by `side`.
CARDS = [
    dict(key="shuffle", bg="night", side="left",
         shots=[("36b-queue-smart", "dark", None, (760, 120, 820)), ("36c-why-this-song", "dark", (543, 198, 1057, 702), (880, 300, 560))],
         title="Smart Shuffle<br>that explains itself",
         text="It leans toward what you rate and how you listen, shows why each song comes next, and lets you steer it for the session."),
    dict(key="tierlists", bg="dawn", side="right",
         shots=[("r-tierlist", "light", None, (60, 190, 840))],
         title="Rank your music<br>in tierlists",
         text="Drag songs into tiers, play a tierlist like a playlist, export it as an image. Your tiers feed Smart Shuffle."),
    dict(key="duels", bg="deep", side="left",
         shots=[("r-duel", "dark", (421, 122, 1179, 778), (760, 120, 600)), ("33-songguessr", "dark", (543, 86, 1057, 814), (1150, 250, 380))],
         title="Duels and<br>Song Guessr",
         text="A little bit of fun with your own library. Pick the better of two songs and an ELO rating sorts it by what you really choose. Or name a track from a tenth of a second."),
    dict(key="stats", bg="sky", side="right",
         shots=[("36t-stats-insights", "dark", (205, 40, 1600, 720), (60, 210, 840))],
         title="Know how<br>you listen",
         text="Plays, skips, hours, streaks and a heatmap of every day, with insights: this week against the last, what is rising, what fell out of rotation."),
    dict(key="tastemap", bg="ink", side="left",
         shots=[("36d-taste-map", "dark", None, (760, 180, 800))],
         title="Your taste,<br>as a map",
         text="The whole library laid out by how you listen: islands of songs that belong together. Pick an area and play it."),
    dict(key="sound", bg="night", side="right",
         shots=[("r-sound", "dark", None, (40, 170, 780)), ("r-sound", "dark", (1065, 363, 1397, 835), (560, 240, 340))],
         title="Slowed<br>+ reverb",
         text="Speed, pitch and a real reverb in the audio engine. Keep a sound as a version of the song, or switch the song itself to it."),
    dict(key="search", bg="dawn", side="left",
         shots=[("r-search", "dark", (205, 0, 1600, 620), (760, 90, 820)), ("36q-search-in-lyrics", "dark", (624, 2, 1120, 44), (800, 500, 500)), ("36q-search-in-lyrics", "dark", (215, 680, 1600, 812), (720, 570, 820))],
         title="Search that<br>gets you",
         text="Typos, any word order, Japanese readings, a wrong keyboard layout, even a line of the lyrics: it still finds the song."),
    dict(key="fullscreen", bg="ink", side="right",
         shots=[("36g-full-screen-bars", "dark", None, (60, 190, 840))],
         title="Full screen,<br>alive",
         text="Synced lyrics, the cover breathing with the music, a live equalizer under it."),
    dict(key="agents", bg="deep", side="left",
         shots=[("36w-settings-agents", "dark", (458, 53, 1561, 351), (730, 300, 860))],
         title="Ask an AI<br>about your music",
         text="Connect Claude or another agent over MCP: it reads your library and stats, builds playlists, runs the queue. You choose how much it may do."),
    dict(key="yours", bg="sky", side="right",
         shots=[("r-search", "dark", None, (60, 340, 700)), ("37-accent-picker", "light", (458, 65, 1561, 520), (200, 120, 680))],
         title="Make it<br>yours",
         text="Light and dark themes, eight accent colours, five frame shades, thirteen languages."),
]
HERO = dict(key="hero", shots=[("r-tierlist", "dark", None, (800, 150, 1100))])
# Order in the README; the cards alternate sides from the first, mirrored where they were drawn the other way.
ORDER = ["tierlists", "sound", "shuffle", "stats", "search", "duels", "tastemap", "fullscreen", "agents", "yours"]


def oriented(c, side):
    if c["side"] == side:
        return c
    shots = [(i, t, cr, (W - x - w, y, w)) for i, t, cr, (x, y, w) in c["shots"]]
    return {**c, "side": side, "shots": shots}


SHOTS = sorted({s[0] for c in CARDS + [HERO] for s in c["shots"]})


def css():
    return f"""
@font-face {{ font-family: G; src: url('{FONT.as_uri()}') format('woff2'); font-weight: 100 900; }}
* {{ box-sizing: border-box; }}
html, body {{ margin: 0; width: {W}px; height: {H}px; overflow: hidden; font-family: G, sans-serif; color: #fff; }}
.card {{ position: relative; width: {W}px; height: {H}px; overflow: hidden; }}
.mark {{ position: absolute; opacity: .07; }}
.copy {{ position: absolute; top: 0; bottom: 0; width: 560px; display: flex; flex-direction: column; justify-content: center; gap: 28px; }}
.copy h2 {{ margin: 0; font-size: 76px; line-height: 1.02; font-weight: 600; letter-spacing: -0.025em; }}
.copy p {{ margin: 0; font-size: 26px; line-height: 1.45; font-weight: 400; color: rgba(255,255,255,.82); max-width: 520px; }}
.win {{ position: absolute; border-radius: 16px; overflow: hidden;
  box-shadow: 0 0 0 1px rgba(255,255,255,.16), 0 50px 110px rgba(3,8,30,.6), 0 14px 34px rgba(3,8,30,.4); }}
.win img {{ display: block; width: 100%; height: auto; }}
/* a glass edge: light catching the top of the window */
.win::after {{ content: ""; position: absolute; inset: 0; border-radius: inherit; pointer-events: none;
  box-shadow: inset 0 1px 0 rgba(255,255,255,.22); background: linear-gradient(180deg, rgba(255,255,255,.06), rgba(255,255,255,0) 18%); }}
/* the screen's own light spilling onto the backdrop */
.glow {{ position: absolute; border-radius: 50%; pointer-events: none;
  background: radial-gradient(closest-side, rgba(110,160,255,.42), rgba(70,120,240,.16) 55%, rgba(40,80,200,0)); }}
.pill {{ display: inline-block; padding: 10px 20px; border-radius: 999px; font-size: 24px; font-weight: 500;
  background: rgba(255,255,255,.12); box-shadow: inset 0 0 0 1px rgba(255,255,255,.22); }}
"""


def mark_svg():
    return (BRAND / "mark/nemora-mark-one-white.svg").as_uri()


def windows(spec, shots):
    x, y, w = spec["shots"][0][3]
    glow = f'<div class="glow" style="left:{x - w * 0.15}px;top:{y - w * 0.12}px;width:{w * 1.3}px;height:{w * 0.9}px"></div>'
    return glow + "".join(f'<div class="win" style="width:{w}px;left:{x}px;top:{y}px"><img src="{u}"></div>'
                   for u, (_, _, _, (x, y, w)) in zip(shots, spec["shots"]))


def card_html(c, shots):
    left = c["side"] == "left"
    copy = f'<div class="copy" style="{"left:110px" if left else "right:70px"}"><h2>{c["title"]}</h2><p>{c["text"]}</p></div>'
    mark = f'<img class="mark" src="{mark_svg()}" style="width:1100px;{"right:-300px" if left else "left:-340px"};bottom:-380px">'
    return f'<div class="card" style="background:{BG[c["bg"]]}">{mark}{windows(c, shots)}{copy}</div>'


def hero_html(shots):
    pills = "".join(f'<span class="pill">{p}</span>' for p in ("Bit-perfect", "Gapless", "Smart Shuffle", "Slowed + reverb", "Tierlists & duels", "Free & open-source"))
    logo = (BRAND / "mark/nemora-mark-color-on-blue.svg").as_uri()
    word = (BRAND / "wordmark/nemora-wordmark-white.svg").as_uri()
    return f"""
<div class="card" style="background:{BG['night']}">
  <img class="mark" src="{mark_svg()}" style="width:1300px;left:-420px;top:-260px;opacity:.06">
  <div style="position:absolute;left:110px;top:0;bottom:0;width:640px;display:flex;flex-direction:column;justify-content:center;gap:34px">
    <div style="display:flex;align-items:center;gap:28px">
      <img src="{logo}" style="width:150px;height:150px;margin:-30px">
      <img src="{word}" style="height:96px">
    </div>
    <p style="margin:0;font-size:38px;line-height:1.25;font-weight:500;letter-spacing:-0.01em">Your library, heard properly.</p>
    <div style="display:flex;flex-wrap:wrap;gap:12px">{pills}</div>
  </div>
  {windows(HERO, shots)}
</div>"""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--shots", default=r"E:\tmp\nemora-shots\readme2x\png")
    ap.add_argument("--only", default="")
    ap.add_argument("--png", action="store_true")
    a = ap.parse_args()
    shots_dir = pathlib.Path(a.shots)
    only = set(filter(None, a.only.split(",")))
    from playwright.sync_api import sync_playwright
    from PIL import Image
    OUT.mkdir(parents=True, exist_ok=True)
    tmp = OUT / "_page.html"
    by_key = {c["key"]: c for c in CARDS}
    cards = [oriented(by_key[k], "right" if i % 2 == 0 else "left") for i, k in enumerate(ORDER)]
    jobs = [("hero", hero_html, HERO)] + [(c["key"], (lambda c: lambda s: card_html(c, s))(c), c) for c in cards]
    with sync_playwright() as p:
        try:
            br = p.chromium.launch(channel="msedge", headless=True)
        except Exception:
            br = p.chromium.launch(headless=True)
        for key, fn, spec in jobs:
            if only and key not in only:
                continue
            files = []
            for sid, theme, crop, _ in spec["shots"]:
                f = shots_dir / f"{sid}.{theme}.png"
                if not f.exists():
                    print(key, "missing", f.name)
                    break
                if crop:
                    # Crops are written in the 1600 x 900 layout; the shots may be denser (--scale).
                    shot = Image.open(f)
                    k = shot.width / 1600
                    cut = OUT / f"_crop-{key}-{len(files)}.png"
                    shot.crop(tuple(round(v * k) for v in crop)).save(cut)
                    f = cut
                files.append(f)
            if len(files) != len(spec["shots"]):
                continue
            tmp.write_text(f"<!doctype html><html><head><meta charset='utf-8'><style>{css()}</style></head>"
                           f"<body>{fn([f.as_uri() for f in files])}</body></html>", encoding="utf-8")
            pg = br.new_page(viewport={"width": W, "height": H}, device_scale_factor=SCALE)
            pg.goto(tmp.as_uri())
            pg.evaluate("document.fonts.ready")
            pg.wait_for_function("[...document.images].every(i => i.complete && i.naturalWidth)")
            png = pg.screenshot()
            pg.close()
            im = Image.open(io.BytesIO(png)).convert("RGB")
            im.save(OUT / f"{key}.webp", quality=90, method=6)
            if a.png:
                im.save(OUT / f"{key}.png")
            print(key, (OUT / f"{key}.webp").stat().st_size // 1024, "KiB")
        br.close()
    tmp.unlink(missing_ok=True)
    for f in OUT.glob("_crop-*.png"):
        f.unlink()


if __name__ == "__main__":
    sys.exit(main())
