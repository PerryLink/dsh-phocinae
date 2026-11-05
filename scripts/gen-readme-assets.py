#!/usr/bin/env python3
"""Generate README image assets for dsh-phocinae (docs/assets/).

Outputs (idempotent overwrite):
  dsh-phocinae-flow-light.svg / dsh-phocinae-flow-dark.svg
      Hero decision-path diagram. Two hand-written SVG files (vector — never
      rasterized to webp). Every string inside is a command-surface token
      (tools/pre-execute, /v1/systemone, allow / ask / deny, ...), so all five
      README languages share the same pair.
  dsh-phocinae-evidence-{zh,en}-{light,dark}.webp
      Gate evidence bar chart. Numbers are quoted verbatim from
      bench/results/gate-by-mode.json (53 labelled commands: 31 destructive,
      22 benign); the same numbers appear in bench/REPORT-0.2.1-measurements.md.
      Chinese needs an explicit CJK font — probed below; the script aborts
      loudly when none is found.

Run once:  python scripts/gen-readme-assets.py
Requires:  Pillow (pip install pillow)
"""
from __future__ import annotations

import os
import sys

from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "docs", "assets")

# --- palette: PerryLink family (accent) + GitHub page backgrounds ----------
FAMILY = "#4B67B4"   # family accent (badges labelColor family uses #2B3245)
GREEN = {"light": "#16a34a", "dark": "#3fb950"}
ORANGE = {"light": "#bc4c00", "dark": "#d29922"}
SKIN = {
    "light": dict(bg="#ffffff", box="#f6f8fa", border="#d0d7de",
                  text="#1f2328", sub="#57606a", track="#eaeef2"),
    "dark": dict(bg="#0d1117", box="#161b22", border="#30363d",
                 text="#f0f6fc", sub="#8b949e", track="#21262d"),
}

# --- CJK font probe: Chinese must never render as tofu boxes ----------------
FONT_CANDIDATES = [
    r"C:\Windows\Fonts\msyh.ttc",      # Microsoft YaHei
    r"C:\Windows\Fonts\simhei.ttf",    # SimHei
    r"C:\Windows\Fonts\Deng.ttf",      # DengXian
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
    "/System/Library/Fonts/PingFang.ttc",
]
FONT_PATH = next((p for p in FONT_CANDIDATES if os.path.exists(p)), None)
if FONT_PATH is None:
    sys.exit("FATAL: no CJK font found (looked for msyh.ttc, simhei.ttf, "
             "Deng.ttf, Noto Sans CJK, PingFang). Refusing to render Chinese "
             "as tofu boxes; install one of the probed fonts and re-run.")


def font(size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(FONT_PATH, size)


# ---------------------------------------------------------------------------
# 1. Hero decision-path SVG (light + dark)
# ---------------------------------------------------------------------------
# Tokens only: event name, endpoint, config keys, verdicts.
FLOW_NODES = [
    ("tools/pre-execute", "gate.tools"),
    ("POST /v1/systemone", "127.0.0.1:8155"),
    ("Phocinae-Largha-150M-v1", "harmless\u00b7risky\u00b7destructive"),
    ("allow / ask / deny", "failMode: closed"),
]
FLOW_BARS = [
    (80, 535, "phocinae_ask \u00b7 noul \u00b7 choice \u00b7 score "
              "\u00b7 escalateAt 0.6", "border"),
    (650, 505, "decision-service-unavailable \u2192 ask", "accent"),
]


def flow_svg(skin: str) -> str:
    s = SKIN[skin]
    w, h = 1200, 400
    nw, nh, gap = 215, 96, 60
    y0 = 150
    parts = [
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" '
        f'viewBox="0 0 {w} {h}" role="img" '
        f'aria-label="dsh-phocinae: tools/pre-execute to /v1/systemone to '
        f'allow / ask / deny">',
        f'<title>dsh-phocinae decision path</title>',
        f'<rect width="{w}" height="{h}" rx="18" fill="{s["bg"]}"/>',
        f'<text x="80" y="62" fill="{s["text"]}" font-family="ui-sans-serif,'
        f'system-ui,sans-serif" font-size="30" font-weight="700">dsh-phocinae</text>',
        f'<text x="80" y="96" fill="{s["sub"]}" font-family="ui-monospace,'
        f'monospace" font-size="16">tools/pre-execute \u00b7 '
        f'127.0.0.1:8155/v1/systemone \u00b7 failMode: closed</text>',
        f'<line x1="80" y1="118" x2="1120" y2="118" stroke="{s["border"]}"/>',
    ]
    for i, (label, sub) in enumerate(FLOW_NODES):
        x = 80 + i * (nw + gap)
        accent = GREEN[skin] if i == len(FLOW_NODES) - 1 else (
            FAMILY if i == 1 else s["border"])
        parts.append(
            f'<rect x="{x}" y="{y0}" width="{nw}" height="{nh}" rx="14" '
            f'fill="{s["box"]}" stroke="{accent}" stroke-width="2"/>')
        label_size = 14 if len(label) > 20 else 16
        parts.append(
            f'<text x="{x + nw // 2}" y="{y0 + 40}" fill="{s["text"]}" '
            f'text-anchor="middle" font-family="ui-monospace,monospace" '
            f'font-size="{label_size}" font-weight="700">{label}</text>')
        parts.append(
            f'<text x="{x + nw // 2}" y="{y0 + 68}" fill="{s["sub"]}" '
            f'text-anchor="middle" font-family="ui-monospace,monospace" '
            f'font-size="11">{sub}</text>')
        if i < len(FLOW_NODES) - 1:
            ax = x + nw + 8
            ay = y0 + nh // 2
            parts.append(
                f'<path d="M{ax} {ay}h{gap - 18}" stroke="{s["sub"]}" '
                f'stroke-width="3"/>')
            parts.append(
                f'<path d="M{ax + gap - 20} {ay - 7}l10 7-10 7" fill="none" '
                f'stroke="{s["sub"]}" stroke-width="3" '
                f'stroke-linecap="round" stroke-linejoin="round"/>')
    # annotation bars under the nodes
    for bx, bw, text, stroke_kind in FLOW_BARS:
        by, bh = 283, 54
        stroke = FAMILY if stroke_kind == "accent" else s["border"]
        parts.append(
            f'<rect x="{bx}" y="{by}" width="{bw}" height="{bh}" rx="12" '
            f'fill="{s["box"]}" stroke="{stroke}" stroke-width="2"/>')
        parts.append(
            f'<text x="{bx + bw // 2}" y="{by + 34}" fill="{s["text"]}" '
            f'text-anchor="middle" font-family="ui-monospace,monospace" '
            f'font-size="13">{text}</text>')
    # dashed connectors from node1 and node4 down to the annotation bars
    for cx in (80 + nw // 2, 80 + 3 * (nw + gap) + nw // 2):
        parts.append(
            f'<path d="M{cx} {y0 + nh}v{283 - y0 - nh}" stroke="{FAMILY}" '
            f'stroke-width="2" stroke-dasharray="5 5"/>')
    parts.append(
        f'<text x="80" y="376" fill="{s["sub"]}" font-family="ui-monospace,'
        f'monospace" font-size="13">gate.autoAllow \u00b7 '
        f'gate.minConfidence 0.45 \u00b7 gate.audit \u00b7 '
        f'Phocinae-Largha-150M-v1</text>')
    parts.append('</svg>')
    return "\n".join(parts) + "\n"


# ---------------------------------------------------------------------------
# 2. Evidence bar chart (zh/en x light/dark), data from gate-by-mode.json
# ---------------------------------------------------------------------------
# (zh label, en label, destructive recall, benign commands sent to a human)
# Quoted verbatim from bench/results/gate-by-mode.json (n=53: 31 destructive,
# 22 benign); the same run is written up in REPORT-0.2.1-measurements.md §5.
GATE_ROWS = [
    ("出厂默认", "default", 1.0, 6),
    ("去掉白名单", "no allow-list", 1.0, 22),
    ("minConf 0.6", "minConf 0.6", 1.0, 6),
    ("tri-state", "tri-state", 1.0, 6),
    ("noul", "noul", 0.0, 0),
]
BENIGN = 22

TEXT = {
    "zh": dict(
        title="dsh-phocinae 门控 — 真实门实测",
        sub="53 条标注命令（31 危险 / 22 良性）· 数据出自 "
            "bench/results/gate-by-mode.json",
        legend=("危险命令拦截率", "良性命令转人工率"),
        note1="出厂默认：31/31 拦截、0 漏放、良性 6/22 转人工、16 条走白名单，"
              "均值 15.7 ms",
        note2="去掉白名单：22/22 良性命令全部转人工——白名单不是优化，是必需",
        note3="noul 是 0.1.2 出厂的问题表述：31 条危险命令全部放行；保留它只为"
              "让既有部署对照新旧行为"),
    "en": dict(
        title="dsh-phocinae gate — measured on the real gate",
        sub="53 labelled commands (31 destructive, 22 benign) · from "
            "bench/results/gate-by-mode.json",
        legend=("destructive recall", "benign \u2192 human"),
        note1="shipped default: 31/31 intercepted, 0 passed, 6/22 benign "
              "reviewed, 16 on the allow-list, 15.7 ms mean",
        note2="no allow-list: all 22/22 benign commands reviewed — the list "
              "is a necessity, not an optimisation",
        note3="noul is the 0.1.2 question wording: all 31 destructive commands "
              "passed; kept only so an existing deployment can compare"),
}


def evidence(lang: str, skin: str) -> None:
    s = SKIN[skin]
    t = TEXT[lang]
    w, h = 1600, 700
    img = Image.new("RGB", (w, h), s["bg"])
    d = ImageDraw.Draw(img)
    pad = 70
    d.text((pad, 40), t["title"], font=font(36), fill=s["text"])
    d.text((pad, 98), t["sub"], font=font(19), fill=s["sub"])
    # legend
    lx = pad
    for color, label in ((GREEN[skin], t["legend"][0]),
                         (ORANGE[skin], t["legend"][1])):
        d.rounded_rectangle([lx, 146, lx + 22, 168], radius=5, fill=color)
        d.text((lx + 32, 144), label, font=font(18), fill=s["sub"])
        lx += 32 + d.textbbox((0, 0), label, font=font(18))[2] + 46
    # plot area
    top, base = 205, 540
    plot_h = base - top
    d.line([pad, base, w - pad, base], fill=s["border"], width=2)
    for frac in (0.25, 0.5, 0.75, 1.0):
        y = base - int(plot_h * frac)
        d.line([pad, y, w - pad, y], fill=s["track"], width=1)
        d.text((22, y - 10), f"{frac:.2f}", font=font(14), fill=s["sub"])
    group_w = (w - 2 * pad) // len(GATE_ROWS)
    bar_w, bar_gap = 72, 20
    for i, (zh, en, recall, benign) in enumerate(GATE_ROWS):
        label = zh if lang == "zh" else en
        gx = pad + i * group_w
        offset = (group_w - (2 * bar_w + bar_gap)) // 2
        for j, (value, color, text) in enumerate((
                (recall, GREEN[skin], f"{recall:.4f}"),
                (benign / BENIGN, ORANGE[skin], f"{benign}/{BENIGN}"))):
            x = gx + offset + j * (bar_w + bar_gap)
            bar_h = int(plot_h * value)
            if bar_h > 0:
                d.rounded_rectangle([x, base - bar_h, x + bar_w, base],
                                    radius=8, fill=color)
            d.text((x + bar_w // 2 - d.textbbox((0, 0), text,
                                                font=font(17))[2] // 2,
                    base - bar_h - 28), text, font=font(17), fill=s["text"])
        d.text((gx + group_w // 2 - d.textbbox((0, 0), label,
                                               font=font(19))[2] // 2,
                base + 22), label, font=font(19), fill=s["text"])
    # footnotes
    ny = base + 70
    for i, note in enumerate((t["note1"], t["note2"], t["note3"])):
        d.text((pad, ny + i * 30), note, font=font(17), fill=s["sub"])
    img.save(os.path.join(OUT, f"dsh-phocinae-evidence-{lang}-{skin}.webp"),
             "WEBP", quality=90)


def main() -> None:
    os.makedirs(OUT, exist_ok=True)
    for skin in ("light", "dark"):
        with open(os.path.join(OUT, f"dsh-phocinae-flow-{skin}.svg"),
                  "w", encoding="utf-8", newline="\n") as fh:
            fh.write(flow_svg(skin))
    for lang in ("zh", "en"):
        for skin in ("light", "dark"):
            evidence(lang, skin)
    print("wrote 2 SVG + 4 WebP assets to docs/assets/")


if __name__ == "__main__":
    main()
