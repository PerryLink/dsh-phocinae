#!/usr/bin/env python3
"""README visuals for dsh-phocinae, generated from what this package runs.

Outputs (idempotent overwrite)
  docs/assets/dsh-phocinae-hero-{zh,en}-{light,dark}.webp   1440x576  (Pillow)
  docs/assets/dsh-phocinae-flow-v5-{light,dark}.svg         1100x660  (hand SVG)
  docs/assets/dsh-phocinae-evidence-{zh,en}-{light,dark}.webp  1600x700
      (retained benchmark chart; numbers stay verbatim from
      bench/results/gate-by-mode.json)

1. Hero — 1440x576, left copy column + one verdict docket.
   Left: kicker, title, the two-line value sentence, one subtitle, one meta
   line, install footer. Right: the verdict one gate decision produces. A
   tool call enters as a dark command strip (`shell · rm -rf /`), the local
   loopback decision service answers the harm question, a three-zone harm
   dial marks the answer `destructive`, a verdict stamp reads `deny`, and a
   confidence rail shows the 0.45 floor the allow path has to clear. The
   footer of the docket carries the audit line and the measured gate cost.

2. Flow — 1100x660. Grammar: an ORDERED SCREENING LADDER feeding a
   HARM x CONFIDENCE DECISION MATRIX, with a fail-closed row and a verdict
   strip. Not a row of nodes.
   The top band is the input (`tools/pre-execute` / `phocinae_gate`) and the
   three exits `decideToolCall` takes before any HTTP (gate disabled, tool not
   matched, command on `gate.autoAllow`). Everything that survives reaches the
   loopback `POST /v1/systemone` ribbon; its answer (`harm` + calibrated
   confidence) is resolved by the table: harmless/confident = allow,
   harmless/unsure = ask, risky = ask in both columns, destructive = deny in
   both columns. The last row is the failure path that never reads as safe:
   timeout / non-2xx / unreadable body -> ask under `failMode: closed`
   (allow only when the operator chose `open`). The bottom strip is the
   `PreToolDecision` that leaves the hook and the audit line it writes.

Every string is a token from this repository. The SVG uses command tokens
only, so all five README languages share the same pair. Every label is
measured before it is drawn: a label that would leave its box aborts the run
instead of shipping clipped. At 880px display width this keeps flow labels at
or above 13px for nodes and 11px for annotations.

Run:  python scripts/gen-readme-assets.py
Needs: Python 3, Pillow, and msyh.ttc / msyhbd.ttc / consola.ttf /
       consolab.ttf / segoeui.ttf / segoeuib.ttf.
"""
from __future__ import annotations

import math
import os
import sys

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "docs", "assets")

FONT_CJK = r"C:\Windows\Fonts\msyh.ttc"
FONT_CJK_BOLD = r"C:\Windows\Fonts\msyhbd.ttc"
FONT_MONO = r"C:\Windows\Fonts\consola.ttf"
FONT_MONO_BOLD = r"C:\Windows\Fonts\consolab.ttf"
FONT_EN = r"C:\Windows\Fonts\segoeui.ttf"
FONT_EN_BOLD = r"C:\Windows\Fonts\segoeuib.ttf"
for _p in (FONT_CJK, FONT_CJK_BOLD, FONT_MONO, FONT_MONO_BOLD,
           FONT_EN, FONT_EN_BOLD):
    if not os.path.exists(_p):
        sys.exit(f"FATAL: font missing: {_p}")

FONTS = {
    "cjk": FONT_CJK, "cjk_bold": FONT_CJK_BOLD,
    "mono": FONT_MONO, "mono_bold": FONT_MONO_BOLD,
    "en": FONT_EN, "en_bold": FONT_EN_BOLD,
}

# --- palette: family accent #4B67B4, light #f9f6fd -> #e4eaf8 -------------
SKIN = {
    "light": dict(
        bg_from="#f9f6fd", bg_to="#e4eaf8", card="#ffffff",
        panel="#f7f4fd", edge="#e5e0f0", text="#17141f", sub="#4c5160",
        faint="#878ca1", accent="#4B67B4", accent_soft="#ece7f9",
        green="#15803d", amber="#b45309", red="#b91c1c",
        track="#e9e4f3", pill="#ece7f9", ink="#1b2233",
        on_ink="#f2f5fc", on_ink_dim="#9aa4b8", on_accent="#ffffff",
        shadow=(24, 20, 48), shadow_alpha=44, dots="#d9d3ea",
        glow="#8f7ce8", glow_alpha=40, halo="#4B67B4",
    ),
    "dark": dict(
        bg_from="#131a2a", bg_to="#0c1016", card="#1b2231",
        panel="#202939", edge="#2e374b", text="#f0f3f9", sub="#a8b1c4",
        faint="#8791a4", accent="#8496f5", accent_soft="#242d42",
        green="#3fb950", amber="#d29922", red="#f0776e",
        track="#2b3549", pill="#242d42", ink="#0d1320",
        on_ink="#eef2fb", on_ink_dim="#8b95aa", on_accent="#0f1424",
        shadow=(0, 0, 0), shadow_alpha=120, dots="#2c3549",
        glow="#4B67B4", glow_alpha=58, halo="#8496f5",
    ),
}

_MEASURE = ImageDraw.Draw(Image.new("RGB", (1, 1)))
_CACHE: dict[tuple[str, int], ImageFont.FreeTypeFont] = {}
_WIDTHS: dict[tuple[str, int, str], float] = {}


def hx(value: str) -> tuple[int, int, int]:
    value = value.lstrip("#")
    return tuple(int(value[i:i + 2], 16) for i in (0, 2, 4))


def tint(color: str, alpha: int) -> tuple[int, int, int, int]:
    return (*hx(color), max(0, min(255, alpha)))


def mix(top: str, alpha: int, base: str) -> tuple[int, int, int]:
    """Opaque blend of `top` over `base` (ImageDraw replaces alpha, not blends)."""
    f = max(0, min(255, alpha)) / 255
    a, b = hx(top), hx(base)
    return tuple(round(a[i] * f + b[i] * (1 - f)) for i in range(3))


def font(size: int, kind: str) -> ImageFont.FreeTypeFont:
    key = (kind, size)
    if key not in _CACHE:
        _CACHE[key] = ImageFont.truetype(FONTS[kind], size)
    return _CACHE[key]


def tw(text: str, size: int, kind: str) -> float:
    key = (text, size, kind)
    if key not in _WIDTHS:
        _WIDTHS[key] = _MEASURE.textlength(text, font=font(size, kind))
    return _WIDTHS[key]


def must_fit(text: str, size: int, kind: str, maxw: float, where: str) -> None:
    width = tw(text, size, kind)
    if width > maxw:
        sys.exit(f"FATAL: {where}: {text!r} needs {width:.0f}px at {size}px, "
                 f"the box allows {maxw:.0f}px. Shorten it or widen the box.")


def fit_size(text: str, kind: str, size: int, maxw: float, floor: int) -> int:
    while size > floor and tw(text, size, kind) > maxw:
        size -= 1
    return size


def check_display(size: float, floor_at_880: float, label: str) -> None:
    shown = size * 880 / 1440
    if shown < floor_at_880:
        sys.exit(f"FATAL: {label} is {shown:.1f}px at 880px wide, "
                 f"the floor is {floor_at_880}px")


# ---------------------------------------------------------------------------
# Hero (1440x576, drawn at 2x and downsampled)
# ---------------------------------------------------------------------------
W, H = 1440, 576
S = 2

COPY = {
    "zh": dict(
        kicker="DSH 插件 · 本机决策层",
        kicker_kind="cjk_bold", kicker_size=15,
        value1="工具执行之前，先让 150M 模型",
        value2="判一次「多危险」，再决定放不放。",
        value_kind="cjk_bold", value_size=32,
        subtitle="非生成式：只回结构化答案，不写作、不总结、不解释",
        sub_kind="cjk", sub_size=25,
        footer="dsh plugin --profile web add dsh-phocinae@0.2.5",
    ),
    "en": dict(
        kicker="DSH PLUGIN · LOCAL DECISION LAYER",
        kicker_kind="en_bold", kicker_size=13.5,
        value1="Before a tool runs, a local 150M model",
        value2="scores how harmful it is — then decides.",
        value_kind="en_bold", value_size=30,
        subtitle="No cloud API, no generation tokens; answers only",
        sub_kind="en", sub_size=25,
        footer="dsh plugin --profile web add dsh-phocinae@0.2.5",
    ),
}
META = "v0.2.5 · DSH ≥0.2.1 <0.3.0 · Node ^22.19 · Apache-2.0"

TEXT_MAX = 664


class Hero:
    """Design-space (1440x576) painter on a 2x canvas."""

    def __init__(self, lang: str, skin: str) -> None:
        self.lang = lang
        self.s = SKIN[skin]
        self.canvas = Image.new("RGBA", (W * S, H * S), (0, 0, 0, 0))
        self.d = ImageDraw.Draw(self.canvas)

    # -- primitives ------------------------------------------------------
    def gradient(self) -> None:
        top, bottom = hx(self.s["bg_from"]), hx(self.s["bg_to"])
        base = Image.new("RGB", (W * S, H * S))
        pen = ImageDraw.Draw(base)
        for y in range(H * S):
            t = y / (H * S - 1)
            pen.line([(0, y), (W * S, y)],
                     fill=tuple(round(a + (b - a) * t)
                                for a, b in zip(top, bottom)))
        self.canvas.alpha_composite(base.convert("RGBA"))

    def glow(self, cx: float, cy: float, rx: float, ry: float,
             color: str, alpha: int) -> None:
        layer = Image.new("RGBA", self.canvas.size, (0, 0, 0, 0))
        ImageDraw.Draw(layer).ellipse(
            [(cx - rx) * S, (cy - ry) * S, (cx + rx) * S, (cy + ry) * S],
            fill=tint(color, alpha))
        layer = layer.filter(ImageFilter.GaussianBlur(130 * S))
        self.canvas.alpha_composite(layer)

    def dots(self, x: float, y: float, w: float, h: float,
             step: float = 30) -> None:
        layer = Image.new("RGBA", self.canvas.size, (0, 0, 0, 0))
        pen = ImageDraw.Draw(layer)
        color = tint(self.s["dots"], 80)
        gy = y
        while gy < y + h:
            gx = x
            while gx < x + w:
                pen.ellipse([(gx - 1.2) * S, (gy - 1.2) * S,
                             (gx + 1.2) * S, (gy + 1.2) * S], fill=color)
                gx += step
            gy += step
        self.canvas.alpha_composite(layer)

    def text(self, x: float, y: float, label: str, size: float, kind: str,
             color: str, anchor: str = "ls", alpha: int = 255) -> None:
        self.d.text((x * S, y * S), label, font=font(round(size * S), kind),
                    fill=tint(color, alpha), anchor=anchor)

    @staticmethod
    def _paint(value):
        if value is None:
            return None
        return value if isinstance(value, tuple) else tint(value, 255)

    def rect(self, x: float, y: float, w: float, h: float, r: float,
             fill=None, edge=None, width: float = 1) -> None:
        self.d.rounded_rectangle(
            [x * S, y * S, (x + w) * S, (y + h) * S], radius=r * S,
            fill=self._paint(fill), outline=self._paint(edge),
            width=max(1, round(width * S)) if edge else 1)

    def card(self, x: float, y: float, w: float, h: float, r: float,
             fill: str, edge: str, dy: float = 12, blur: float = 22) -> None:
        shadow = Image.new("RGBA", self.canvas.size, (0, 0, 0, 0))
        ImageDraw.Draw(shadow).rounded_rectangle(
            [x * S, (y + dy) * S, (x + w) * S, (y + h + dy) * S],
            radius=r * S, fill=(*self.s["shadow"], self.s["shadow_alpha"]))
        shadow = shadow.filter(ImageFilter.GaussianBlur(blur * S))
        self.canvas.alpha_composite(shadow)
        self.rect(x, y, w, h, r, fill=fill, edge=edge)

    def rule(self, x1: float, y1: float, x2: float, y2: float,
             color: str, alpha: int = 255, width: float = 1) -> None:
        self.d.line([x1 * S, y1 * S, x2 * S, y2 * S],
                    fill=tint(color, alpha), width=max(1, round(width * S)))

    def pill(self, x: float, y: float, label: str, size: float, kind: str,
             fg: str, bg: str, edge: str, padx: float = 12,
             h: float = 22) -> float:
        width = tw(label, size, kind) + 2 * padx
        self.rect(x, y, width, h, h / 2, fill=bg, edge=edge)
        self.text(x + width / 2, y + h / 2 + size * 0.34, label, size, kind,
                  fg, anchor="ms")
        return width

    # -- copy column -----------------------------------------------------
    def copy_column(self) -> None:
        c = COPY[self.lang]
        s = self.s
        x = 88

        kicker_size = c["kicker_size"]
        kicker_w = tw(c["kicker"], kicker_size, c["kicker_kind"])
        must_fit(c["kicker"], kicker_size, c["kicker_kind"], 430, "kicker")
        pill_w = kicker_w + 62
        self.rect(x, 64, pill_w, 36, 18, fill=s["pill"], edge=s["edge"])
        self.d.ellipse([(x + 17) * S, 79 * S, (x + 24) * S, 86 * S],
                       fill=tint(s["accent"], 255))
        self.text(x + 33, 87, c["kicker"], kicker_size, c["kicker_kind"],
                  s["accent"])

        title = "dsh-phocinae"
        title_size = 84
        must_fit(title, title_size, "en_bold", TEXT_MAX, "hero title")
        check_display(title_size, 48, "hero title")
        self.text(x, 210, title, title_size, "en_bold", s["text"])

        value_size = c["value_size"]
        must_fit(c["value1"], value_size, c["value_kind"], TEXT_MAX,
                 "value line 1")
        must_fit(c["value2"], value_size, c["value_kind"], TEXT_MAX,
                 "value line 2")
        self.text(x, 280, c["value1"], value_size, c["value_kind"], s["text"])
        self.text(x, 322, c["value2"], value_size, c["value_kind"], s["text"])

        must_fit(c["subtitle"], c["sub_size"], c["sub_kind"], TEXT_MAX,
                 "subtitle")
        check_display(c["sub_size"], 15, "hero subtitle")
        self.text(x, 374, c["subtitle"], c["sub_size"], c["sub_kind"], s["sub"])

        must_fit(META, 20, "mono", TEXT_MAX, "meta line")
        check_display(20, 12, "hero meta")
        self.text(x, 416, META, 20, "mono", s["faint"])

        self.rule(88, 448, 728, 448, s["edge"])
        must_fit(c["footer"], 17, "mono", 560, "footer")
        self.text(x, 486, c["footer"], 17, "mono", s["sub"])
        self.text(728, 486, "Apache-2.0", 16, "mono", s["faint"], anchor="rs")

    # -- verdict docket --------------------------------------------------
    def docket(self) -> None:
        s = self.s
        x, y, w, h = 760, 42, 616, 494
        self.card(x, y, w, h, 22, s["card"], s["edge"])
        left, right = 786, 1350

        # header
        self.text(left, 82, "tools/pre-execute", 17, "mono_bold", s["text"])
        status = "failMode: closed"
        sw = tw(status, 10.5, "mono") + 26
        sx = right - sw
        self.rect(sx, 64, sw, 24, 12, fill=mix(s["accent"], 26, s["card"]),
                  edge=mix(s["accent"], 90, s["card"]))
        self.d.ellipse([(sx + 9) * S, 74 * S, (sx + 15) * S, 80 * S],
                       fill=tint(s["accent"], 255))
        self.text(sx + 19, 80.5, status, 10.5, "mono", s["accent"])
        self.text(left, 106, "gate.mode: harm · gate.tools: ['*']", 11,
                  "mono", s["faint"])
        self.rule(left, 122, right, 122, s["edge"])

        # incoming command strip
        self.rect(left, 138, right - left, 64, 14, fill=s["ink"])
        self.rect(left + 16, 154, 54, 22, 11, fill=s["accent"])
        self.text(left + 43, 170, "shell", 10, "mono_bold", s["on_accent"],
                  anchor="ms")
        must_fit("rm -rf /", 19, "mono_bold", 330, "hero command")
        self.text(left + 84, 180, "rm -rf /", 19, "mono_bold", s["on_ink"])
        must_fit("not on autoAllow", 10.5, "mono", 120, "hero command note")
        self.text(right - 16, 180, "not on autoAllow", 10.5, "mono",
                  s["on_ink_dim"], anchor="rs")

        # loopback hop
        self.text(left, 230, "POST 127.0.0.1:8155/v1/systemone", 11,
                  "mono", s["accent"])
        must_fit("timeoutMs 3000 · no retry", 10.5, "mono", 210,
                 "hero timeout")
        self.text(right, 230, "timeoutMs 3000 · no retry", 10.5, "mono",
                  s["faint"], anchor="rs")

        # local model block
        self.text(left, 266, "LOCAL", 9.5, "mono_bold", s["faint"])
        self.text(left, 302, "150M", 30, "mono_bold", s["accent"])
        self.text(left, 322, "non-generative", 10, "mono", s["sub"])
        self.rule(left, 338, left + 100, 338, s["edge"])
        self.text(left, 360, "loopback only", 10.5, "mono", s["sub"])
        self.text(left, 380, "1 forward", 10.5, "mono", s["sub"])
        self.text(left, 400, "0 output tokens", 10.5, "mono", s["sub"])

        # harm dial
        cx, cy, radius = 1010, 338, 96
        for a0, a1, color in ((181, 239, s["green"]), (242, 298, s["amber"]),
                              (301, 359, s["red"])):
            self.d.arc([(cx - radius) * S, (cy - radius) * S,
                        (cx + radius) * S, (cy + radius) * S],
                       a0, a1, fill=tint(color, 255), width=round(18 * S))
        angle = math.radians(32)
        tip = (cx + math.cos(angle) * (radius - 28),
               cy - math.sin(angle) * (radius - 28))
        back = (cx + math.cos(angle) * 6, cy - math.sin(angle) * 6)
        side = (math.cos(angle + math.pi / 2) * 7,
                -math.sin(angle + math.pi / 2) * 7)
        self.d.polygon([(tip[0] * S, tip[1] * S),
                        ((back[0] + side[0]) * S, (back[1] + side[1]) * S),
                        ((back[0] - side[0]) * S, (back[1] - side[1]) * S)],
                       fill=tint(s["text"], 255))
        self.d.ellipse([(cx - 8) * S, (cy - 8) * S, (cx + 8) * S,
                        (cy + 8) * S], fill=tint(s["text"], 255))
        self.d.ellipse([(cx - 3) * S, (cy - 3) * S, (cx + 3) * S,
                        (cy + 3) * S], fill=tint(s["card"], 255))
        for lx, label in ((cx - 66, "harmless"), (cx, "risky"),
                          (cx + 78, "destructive")):
            must_fit(label, 10, "mono", 100, "dial tick")
            self.text(lx, 364, label, 10, "mono", s["faint"], anchor="ms")
        self.text(cx, 400, "harm = destructive", 16, "mono_bold", s["red"],
                  anchor="ms")
        self.text(cx, 422, "confidence 0.9300 · escalate: true", 10.5,
                  "mono", s["faint"], anchor="ms")

        # verdict stamp
        self.rect(1152, 246, 198, 168, 16, fill=mix(s["red"], 20, s["card"]),
                  edge=mix(s["red"], 150, s["card"]), width=2)
        self.rect(1160, 254, 182, 152, 12,
                  edge=mix(s["red"], 80, s["card"]))
        self.text(1172, 274, "MODEL VERDICT", 9.5, "mono_bold", s["red"])
        self.text(1172, 326, "deny", 46, "mono_bold", s["red"])
        must_fit("model-called-it-destructive", 9.5, "mono", 164,
                 "stamp reason")
        self.text(1172, 350, "model-called-it-destructive", 9.5, "mono",
                  s["red"])
        self.pill(1172, 362, "escalate: true", 9, "mono", s["red"],
                  mix(s["red"], 22, s["card"]), mix(s["red"], 90, s["card"]),
                  padx=9, h=20)
        self.text(1172, 400, "option 2 of 3 · harm", 9.5, "mono", s["faint"])

        # confidence rail
        bar_x, bar_w = left, right - left
        self.text(bar_x, 428, "answer_confidence", 9.5, "mono", s["faint"])
        self.text(right, 428, "0.9300", 11, "mono_bold", s["text"],
                  anchor="rs")
        self.rect(bar_x, 438, bar_w, 12, 6, fill=s["track"])
        self.rect(bar_x, 438, bar_w * 0.93, 12, 6, fill=s["accent"])
        marker = bar_x + bar_w * 0.45
        self.rule(marker, 434, marker, 454, s["text"], width=2)
        self.text(marker, 468, "floor 0.45", 9.5, "mono", s["faint"],
                  anchor="ms")

        # audit line
        self.rule(left, 480, right, 480, s["edge"])
        self.text(left, 502, "phocinae gate: shell -> deny", 10.5, "mono",
                  s["sub"])
        self.text(right, 502, "21 ms · 0 session tokens", 10, "mono",
                  s["faint"], anchor="rs")
        must_fit("gate.audit: true · escalateAt 0.6 · failMode: closed",
                 9.5, "mono", right - left, "hero footer")
        self.text(left, 524,
                  "gate.audit: true · escalateAt 0.6 · failMode: closed",
                  9.5, "mono", s["faint"])

    def render(self) -> Image.Image:
        self.gradient()
        self.glow(1190, 170, 360, 240, self.s["glow"], self.s["glow_alpha"])
        self.glow(930, 520, 300, 170, self.s["glow"],
                  max(20, self.s["glow_alpha"] - 10))
        self.dots(768, 52, 640, 512)
        self.copy_column()
        self.docket()
        return self.canvas.resize((W, H), Image.LANCZOS)


def hero(lang: str, skin: str) -> Image.Image:
    return Hero(lang, skin).render()


# ---------------------------------------------------------------------------
# Flow SVG (1100x660) — screening ladder + harm x confidence matrix
# ---------------------------------------------------------------------------
SVG_MONO = "Consolas, SFMono-Regular, Menlo, monospace"
SVG_SANS = ("Segoe UI, Microsoft YaHei, PingFang SC, Noto Sans CJK SC, "
            "sans-serif")


def esc(text: str) -> str:
    return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def svg_text(x: float, y: float, label: str, size: float, kind: str,
             color: str, anchor: str | None = None,
             opacity: float | None = None) -> str:
    mono = kind.startswith("mono")
    family = SVG_MONO if mono else SVG_SANS
    weight = ' font-weight="700"' if kind.endswith("_bold") else ""
    attrs = [f'x="{x}"', f'y="{y}"', f'fill="{color}"',
             f'font-family="{family}"', f'font-size="{size}"' + weight]
    if anchor:
        attrs.append(f'text-anchor="{anchor}"')
    if opacity is not None:
        attrs.append(f'opacity="{opacity}"')
    return f'<text {" ".join(attrs)}>{esc(label)}</text>'


def check_svg(label: str, size: float, kind: str, maxw: float,
              where: str) -> None:
    if size < 11:
        sys.exit(f"FATAL: {where}: {size}px label is below the 11px floor")
    must_fit(label, int(math.ceil(size)),
             "mono" if kind.startswith("mono") else
             ("en_bold" if kind.endswith("_bold") else "en"),
             maxw, where)


def flow_svg(skin: str) -> str:
    s = SKIN[skin]
    accent, text, sub, faint = s["accent"], s["text"], s["sub"], s["faint"]
    edge, card, panel = s["edge"], s["card"], s["panel"]
    green, amber, red = s["green"], s["amber"], s["red"]
    p: list[str] = []

    def add(line: str) -> None:
        p.append(line)

    def box(x: float, y: float, w: float, h: float, rx: float = 16,
            fill: str | None = None, stroke: str | None = None,
            width: float = 1.2, dash: str | None = None,
            shadow: bool = True) -> None:
        filter_attr = ' filter="url(#soft)"' if shadow else ""
        dash_attr = f' stroke-dasharray="{dash}"' if dash else ""
        add(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{rx}" '
            f'fill="{fill or card}" stroke="{stroke or edge}" '
            f'stroke-width="{width}"{dash_attr}{filter_attr}/>')

    def line(x1: float, y1: float, x2: float, y2: float, color: str,
             width: float = 1.2, dash: str | None = None,
             marker: bool = False) -> None:
        dash_attr = f' stroke-dasharray="{dash}"' if dash else ""
        marker_attr = ' marker-end="url(#arr)"' if marker else ""
        add(f'<line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" '
            f'stroke="{color}" stroke-width="{width}" '
            f'stroke-linecap="round"{dash_attr}{marker_attr}/>')

    # ---- canvas + header --------------------------------------------------
    add(f'<svg xmlns="http://www.w3.org/2000/svg" width="1100" height="660" '
        f'viewBox="0 0 1100 660" role="img" aria-labelledby="fig-title">')
    add('<title id="fig-title">dsh-phocinae — an ordered three-exit screening '
        'ladder feeds a harm by confidence decision table; a fail-closed row '
        'turns an unreadable answer into ask, and the verdict leaves as a '
        'PreToolDecision</title>')
    add('<defs>')
    if skin == "light":
        add('<linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">'
            '<stop offset="0" stop-color="#f9f6fd"/>'
            '<stop offset="1" stop-color="#e4eaf8"/></linearGradient>')
    else:
        add('<linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">'
            '<stop offset="0" stop-color="#131a2a"/>'
            '<stop offset="1" stop-color="#0c1016"/></linearGradient>')
    add('<filter id="soft" x="-30%" y="-30%" width="170%" height="185%">'
        '<feDropShadow dx="0" dy="8" stdDeviation="11" flood-color="#1b1735" '
        'flood-opacity="0.14"/></filter>')
    add('<marker id="arr" viewBox="0 0 10 10" refX="8.5" refY="5" '
        'markerWidth="7" markerHeight="7" orient="auto-start-reverse">'
        f'<path d="M0.5 0.5 L9.5 5 L0.5 9.5 z" fill="{accent}"/></marker>')
    add('</defs>')
    add('<rect width="1100" height="660" fill="url(#bg)"/>')
    add(f'<circle cx="1000" cy="70" r="230" fill="{accent}" opacity="0.05"/>')
    add(f'<circle cx="90" cy="640" r="180" fill="{accent}" opacity="0.04"/>')

    # title
    title = "dsh-phocinae · what happens before a tool runs"
    check_svg(title, 23, "sans_bold", 700, "flow title")
    add(svg_text(44, 52, title, 23, "sans_bold", text))
    subtitle = ("tools/pre-execute → 3 exits → one loopback POST → "
                "harm × confidence → allow / ask / deny")
    check_svg(subtitle, 12.5, "mono", 640, "flow subtitle")
    add(svg_text(44, 82, subtitle, 12.5, "mono", sub))
    meta1 = "lib/guard.mjs · lib/protocol.mjs · lib/config.mjs"
    check_svg(meta1, 12.5, "mono", 380, "flow meta 1")
    add(svg_text(1056, 50, meta1, 12.5, "mono", faint, anchor="end"))
    meta2 = "failMode: closed · minConfidence 0.45"
    check_svg(meta2, 12.5, "mono", 380, "flow meta 2")
    add(svg_text(1056, 74, meta2, 12.5, "mono", accent, anchor="end"))
    line(44, 96, 1056, 96, edge, 1.4)

    # ---- input card -------------------------------------------------------
    box(44, 108, 252, 144, 18)
    add(f'<rect x="48" y="116" width="4" height="128" rx="2" '
        f'fill="{accent}" opacity="0.85"/>')
    add(svg_text(64, 136, "tool call", 16, "sans_bold", text))
    entry = "tools/pre-execute · phocinae_gate"
    check_svg(entry, 11, "mono", 212, "entry points")
    add(svg_text(64, 156, entry, 11, "mono", accent))
    line(64, 168, 276, 168, edge, 1)
    for i, label in enumerate(("exec.name", "exec.arguments",
                               "cwd · platform")):
        check_svg(label, 13, "mono", 190, f"input field {i}")
        add(svg_text(64, 190 + i * 22, label, 13, "mono", sub))

    # input -> screening band
    line(297, 180, 313, 180, accent, 2, marker=True)

    # ---- ordered exits panel ---------------------------------------------
    box(316, 108, 740, 144, 18, fill=panel)
    add(svg_text(336, 130, "three exits before any request", 13, "sans_bold",
                 text))
    cheap = "0 HTTP · 0 session tokens"
    check_svg(cheap, 11, "mono", 220, "exit panel note")
    add(svg_text(1036, 130, cheap, 11, "mono", faint, anchor="end"))
    line(336, 140, 1036, 140, edge, 1)
    rows = [
        ("01", "gate.enabled && gate.mode !== 'off'", "gate-disabled"),
        ("02", "toolMatches(gate.tools, toolName)", "tool-not-gated"),
        ("03", "isAutoAllowed(command, gate.autoAllow)",
         "command-on-auto-allow-list"),
    ]
    for i, (num, condition, reason) in enumerate(rows):
        ry = 146 + i * 34
        cy = ry + 16
        add(f'<circle cx="348" cy="{cy}" r="11" fill="{accent}" '
            f'opacity="0.12" stroke="{accent}" stroke-opacity="0.45"/>')
        add(svg_text(348, cy + 3.6, num, 11, "mono_bold", accent,
                     anchor="middle"))
        check_svg(condition, 13, "mono", 420, f"exit condition {num}")
        add(svg_text(370, cy + 4.5, condition, 13, "mono", text))
        cw = tw(condition, 13, "mono")
        line(370 + cw + 14, cy, 808, cy, edge, 1, dash="3 4")
        # allow pill
        pill_w = 50
        add(f'<rect x="820" y="{cy - 10}" width="{pill_w}" height="20" '
            f'rx="10" fill="{green}" fill-opacity="0.12" '
            f'stroke="{green}" stroke-opacity="0.45"/>')
        add(svg_text(820 + pill_w / 2, cy + 3.6, "allow", 11, "mono_bold",
                     green, anchor="middle"))
        check_svg(reason, 11, "mono", 160, f"exit reason {num}")
        add(svg_text(878, cy + 4, reason, 11, "mono", faint))

    # survivor arrow into the table
    line(686, 252, 686, 274, accent, 2, marker=True)
    survivor = "survives → model asked"
    check_svg(survivor, 11, "mono", 210, "survivor label")
    add(svg_text(700, 270, survivor, 11, "mono", accent))

    # ---- decision table ---------------------------------------------------
    box(44, 280, 1012, 278, 18)
    # ribbon with rounded top corners only
    add(f'<path d="M62 280 H1038 A18 18 0 0 1 1056 298 V316 H44 V298 '
        f'A18 18 0 0 1 62 280 Z" fill="{accent}" fill-opacity="0.08"/>')
    line(44, 316, 1056, 316, edge, 1.2)
    endpoint = "POST http://127.0.0.1:8155/v1/systemone"
    check_svg(endpoint, 13, "mono", 330, "endpoint")
    add(svg_text(64, 303, endpoint, 13, "mono", accent))
    add(svg_text(64 + tw(endpoint, 13, "mono") + 12, 303, "· loopback only",
                 11, "mono", faint))
    answered = "answers.harm · answer_confidence"
    check_svg(answered, 11, "mono", 210, "answer fields")
    add(svg_text(1036, 303, answered, 11, "mono", faint, anchor="end"))

    # column headers
    add(svg_text(64, 338, "harm answer", 13, "sans_bold", text))
    add(svg_text(64, 352, "question id: harm · gate.mode: harm", 11, "mono",
                 faint))
    add(svg_text(314, 338, "confidence ≥ 0.45", 13, "sans_bold", text))
    add(svg_text(314, 352, "gate.minConfidence", 11, "mono", faint))
    add(svg_text(695, 338, "confidence < 0.45", 13, "sans_bold", text))
    add(svg_text(695, 352, "only the allow cell moves", 11, "mono", faint))
    for cxx in (294, 675):
        line(cxx, 316, cxx, 534, edge, 1)
    line(44, 356, 1056, 356, edge, 1)

    # rows: (label, note, color, c1 verdict, c1 reason, c2 verdict, c2 reason)
    table_rows = [
        ("harmless", "only passing answer", green,
         "allow", "model-called-it-harmless",
         "ask", "confidence-below-threshold"),
        ("risky", "always a review", amber,
         "ask", "model-answered-ask",
         "ask", "confidence not consulted"),
        ("destructive", "a positive finding", red,
         "deny", "model-called-it-destructive",
         "deny", "a deny is not softened"),
    ]
    color_of = {"allow": green, "ask": amber, "deny": red}
    for i, (label, note, color, v1, r1, v2, r2) in enumerate(table_rows):
        top = 356 + i * 52
        if i:
            line(44, top, 1056, top, edge, 1)
        add(f'<circle cx="66" cy="{top + 20}" r="5" fill="{color}"/>')
        add(svg_text(80, top + 25, label, 15, "sans_bold", text))
        check_svg(note, 11, "mono", 200, f"{label} note")
        add(svg_text(80, top + 43, note, 11, "mono", faint))
        for cell_x, verdict, reason in ((300, v1, r1), (681, v2, r2)):
            vcolor = color_of[verdict]
            add(f'<rect x="{cell_x}" y="{top + 5}" width="369" height="42" '
                f'rx="10" fill="{vcolor}" fill-opacity="0.09" '
                f'stroke="{vcolor}" stroke-opacity="0.38"/>')
            add(svg_text(cell_x + 16, top + 29, verdict, 17, "mono_bold",
                         vcolor))
            check_svg(reason, 11, "mono", 330, f"{label} {verdict} reason")
            add(svg_text(cell_x + 16, top + 45, reason, 11, "mono", sub))

    # ---- fail-closed row --------------------------------------------------
    line(44, 512, 1056, 512, edge, 1)
    add(f'<circle cx="66" cy="530" r="5" fill="none" stroke="{faint}" '
        f'stroke-width="1.4" stroke-dasharray="2 2"/>')
    add(svg_text(80, 535, "no answer", 14, "sans_bold", text))
    add(svg_text(80, 550, "timeout · 5xx · bad body", 11, "mono", faint))
    add(f'<rect x="300" y="517" width="750" height="37" rx="10" '
        f'fill="{amber}" fill-opacity="0.07" stroke="{amber}" '
        f'stroke-opacity="0.55" stroke-dasharray="4 4"/>')
    add(svg_text(316, 541, "ask", 16, "mono_bold", amber))
    add(svg_text(358, 541, "decision-service-unavailable", 11, "mono", sub))
    add(f'<rect x="724" y="525" width="124" height="21" rx="10" '
        f'fill="{amber}" fill-opacity="0.12" stroke="{amber}" '
        f'stroke-opacity="0.40"/>')
    add(svg_text(786, 539.5, "failMode: closed", 11, "mono_bold", amber,
                 anchor="middle"))
    add(svg_text(1036, 541, "open → allow", 11, "mono", faint, anchor="end"))

    # ---- verdict strip ----------------------------------------------------
    box(44, 572, 1012, 44, 18, fill=panel, shadow=False)
    add(svg_text(64, 599, "PreToolDecision", 12, "sans_bold", accent))
    items = [
        (210, "{kind: 'allow'} → next()", green),
        (452, "{kind: 'ask'} → approval", amber),
        (694, "{kind: 'deny'} → blocked", red),
    ]
    for ix, label, color in items:
        check_svg(label, 11.5, "mono", 230, "verdict item")
        add(svg_text(ix, 600, label, 11.5, "mono", color))
    add(svg_text(1036, 600, "gate.audit: one line", 11, "mono", faint,
                 anchor="end"))

    # footer
    add(svg_text(44, 640, "resolveDecision() · lib/guard.mjs", 11, "mono",
                 faint))
    cost = "21 ms per gated command · 0.02 ms on autoAllow · 0 session tokens"
    check_svg(cost, 11, "mono", 560, "cost line")
    add(svg_text(1056, 640, cost, 11, "mono", faint, anchor="end"))
    add('</svg>')
    return "\n".join(p) + "\n"


# ---------------------------------------------------------------------------
# Evidence bar chart (retained; data from gate-by-mode.json)
# ---------------------------------------------------------------------------
GREEN = {"light": "#16a34a", "dark": "#3fb950"}
ORANGE = {"light": "#bc4c00", "dark": "#d29922"}
EVID_SKIN = {
    "light": dict(bg="#ffffff", box="#f6f8fa", border="#d0d7de",
                  text="#1f2328", sub="#57606a", track="#eaeef2"),
    "dark": dict(bg="#0d1117", box="#161b22", border="#30363d",
                 text="#f0f6fc", sub="#8b949e", track="#21262d"),
}

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
        legend=("destructive recall", "benign → human"),
        note1="shipped default: 31/31 intercepted, 0 passed, 6/22 benign "
              "reviewed, 16 on the allow-list, 15.7 ms mean",
        note2="no allow-list: all 22/22 benign commands reviewed — the list "
              "is a necessity, not an optimisation",
        note3="noul is the 0.1.2 question wording: all 31 destructive commands "
              "passed; kept only so an existing deployment can compare"),
}


def evidence(lang: str, skin: str) -> None:
    s = EVID_SKIN[skin]
    t = TEXT[lang]
    w, h = 1600, 700
    img = Image.new("RGB", (w, h), s["bg"])
    d = ImageDraw.Draw(img)
    pad = 70
    d.text((pad, 40), t["title"], font=font(36, "cjk"), fill=s["text"])
    d.text((pad, 98), t["sub"], font=font(19, "cjk"), fill=s["sub"])
    lx = pad
    for color, label in ((GREEN[skin], t["legend"][0]),
                         (ORANGE[skin], t["legend"][1])):
        d.rounded_rectangle([lx, 146, lx + 22, 168], radius=5, fill=color)
        d.text((lx + 32, 144), label, font=font(18, "cjk"), fill=s["sub"])
        lx += 32 + d.textbbox((0, 0), label, font=font(18, "cjk"))[2] + 46
    top, base = 205, 540
    plot_h = base - top
    d.line([pad, base, w - pad, base], fill=s["border"], width=2)
    for frac in (0.25, 0.5, 0.75, 1.0):
        y = base - int(plot_h * frac)
        d.line([pad, y, w - pad, y], fill=s["track"], width=1)
        d.text((22, y - 10), f"{frac:.2f}", font=font(14, "cjk"), fill=s["sub"])
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
                                                font=font(17, "cjk"))[2] // 2,
                    base - bar_h - 28), text, font=font(17, "cjk"), fill=s["text"])
        d.text((gx + group_w // 2 - d.textbbox((0, 0), label,
                                               font=font(19, "cjk"))[2] // 2,
                base + 22), label, font=font(19, "cjk"), fill=s["text"])
    ny = base + 70
    for i, note in enumerate((t["note1"], t["note2"], t["note3"])):
        d.text((pad, ny + i * 30), note, font=font(17, "cjk"), fill=s["sub"])
    img.save(os.path.join(OUT, f"dsh-phocinae-evidence-{lang}-{skin}.webp"),
             "WEBP", quality=90)


def main() -> None:
    os.makedirs(OUT, exist_ok=True)
    for skin in ("light", "dark"):
        with open(os.path.join(OUT, f"dsh-phocinae-flow-v5-{skin}.svg"),
                  "w", encoding="utf-8", newline="\n") as fh:
            fh.write(flow_svg(skin))
    for lang in ("zh", "en"):
        for skin in ("light", "dark"):
            hero(lang, skin).save(
                os.path.join(OUT, f"dsh-phocinae-hero-{lang}-{skin}.webp"),
                "WEBP", quality=92)
    if "--evidence" in sys.argv:
        for lang in ("zh", "en"):
            for skin in ("light", "dark"):
                evidence(lang, skin)
    print("wrote 2 flow SVGs + 4 hero WebPs to docs/assets/"
          + ("" if "--evidence" not in sys.argv else " + 4 evidence WebPs"))


if __name__ == "__main__":
    main()
