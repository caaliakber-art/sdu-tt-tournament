#!/usr/bin/env python3
"""Build tt-offline.html: the whole site in one file that runs with no internet and no server.

Usage:  python scripts/build_offline.py [output path]      (default: _site/tt-offline.html)

Styles, script, fonts, logo, captain art and the current scores are all packed inside,
so the file can be copied to a pen drive or laptop and double-clicked. Scores are frozen
at the moment it was built; build (or download) a fresh copy after each scorecard update.
"""
import base64
import json
import mimetypes
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = Path(sys.argv[1] if len(sys.argv) > 1 else ROOT / "_site" / "tt-offline.html")
mimetypes.add_type("font/woff2", ".woff2")
mimetypes.add_type("image/webp", ".webp")


def data_uri(path):
    mime = mimetypes.guess_type(str(path))[0] or "application/octet-stream"
    return f"data:{mime};base64,{base64.b64encode(path.read_bytes()).decode()}"


def main():
    html = (ROOT / "index.html").read_text(encoding="utf-8")
    css = (ROOT / "assets" / "styles.css").read_text(encoding="utf-8")
    css = re.sub(r"url\(([^)\"']+)\)", lambda m: f"url({data_uri(ROOT / 'assets' / m.group(1))})", css)
    app = (ROOT / "assets" / "app.js").read_text(encoding="utf-8")

    data = {}
    for name in ("fixtures", "results", "config", "knockout"):
        p = ROOT / "data" / f"{name}.json"
        if p.exists():
            data[f"data/{name}.json"] = json.loads(p.read_text(encoding="utf-8"))
    cfg = data.get("data/config.json", {})
    for sides in (cfg.get("team_art") or {}).values():
        for side, src in list(sides.items()):
            if src and (ROOT / src).exists():
                sides[side] = data_uri(ROOT / src)
    blob = json.dumps(data, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")

    html = re.sub(r'<link rel="icon"[^>]*>', f'<link rel="icon" type="image/png" href="{data_uri(ROOT / "assets/sdu-stripe.png")}">', html)
    html = html.replace('<link rel="stylesheet" href="assets/styles.css">', f"<style>\n{css}\n</style>")
    html = html.replace('src="assets/sdu-logo-white.png"', f'src="{data_uri(ROOT / "assets/sdu-logo-white.png")}"')
    html = html.replace('<script src="assets/app.js" defer></script>',
                        f"<script>window.TT_OFFLINE={blob};</script>\n<script>\n{app.replace('</script', '<\\/script')}\n</script>")
    left = re.findall(r'(?:src|href)="(?!data:|https?:|#|mailto:|\$\{|cheer\.html|game\.html)[^"]+"', html)
    if left:
        sys.exit(f"Unpacked references left in the offline file: {left}")
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(html, encoding="utf-8")
    print(f"Wrote {OUT} ({OUT.stat().st_size / 1e6:.1f} MB)")


if __name__ == "__main__":
    main()
