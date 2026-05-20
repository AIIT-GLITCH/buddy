#!/usr/bin/env python3
"""Generate print-ready Buddy testing flyers with embedded QR codes."""

from __future__ import annotations

from pathlib import Path

import qrcode
from PIL import Image, ImageDraw, ImageFont
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas


ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "public" / "flyers" / "buddy-testing"

URL = "https://aiit-threshold.com/ask-buddy/?src=buddy-testing-flyer"
DATA_POLICY = "https://aiit-threshold.com/data-policy"

DPI = 300

FONT_DIR = Path("/usr/share/fonts/truetype/noto")
SERIF = FONT_DIR / "NotoSerif-Regular.ttf"
SERIF_BOLD = FONT_DIR / "NotoSerif-Bold.ttf"
SERIF_ITALIC = FONT_DIR / "NotoSerif-Italic.ttf"
SANS = FONT_DIR / "NotoSans-Regular.ttf"
SANS_BOLD = FONT_DIR / "NotoSans-Bold.ttf"
MONO = FONT_DIR / "NotoSansMono-Regular.ttf"


COLORS = {
    "ink": "#17130f",
    "dark": "#111018",
    "dark2": "#20170f",
    "cream": "#f7efe1",
    "cream2": "#fff7df",
    "gold": "#f0a500",
    "gold2": "#ffd36a",
    "rust": "#c83a08",
    "cyan": "#40c0b0",
    "muted": "#8a7a60",
    "green": "#2bb673",
    "line": "#d8c7a2",
}


def hex_to_rgb(value: str) -> tuple[int, int, int]:
    value = value.lstrip("#")
    return tuple(int(value[i : i + 2], 16) for i in (0, 2, 4))


def font(path: Path, size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(str(path), size=size)


def text_bbox(draw: ImageDraw.ImageDraw, text: str, fnt: ImageFont.FreeTypeFont) -> tuple[int, int]:
    if not text:
        return 0, 0
    box = draw.textbbox((0, 0), text, font=fnt)
    return box[2] - box[0], box[3] - box[1]


def fit_font(draw: ImageDraw.ImageDraw, text: str, path: Path, max_size: int, max_width: int) -> ImageFont.FreeTypeFont:
    for size in range(max_size, 12, -2):
        fnt = font(path, size)
        if text_bbox(draw, text, fnt)[0] <= max_width:
            return fnt
    return font(path, 12)


def wrap_lines(draw: ImageDraw.ImageDraw, text: str, fnt: ImageFont.FreeTypeFont, max_width: int) -> list[str]:
    words = text.split()
    if not words:
        return []
    lines: list[str] = []
    current = words[0]
    for word in words[1:]:
        candidate = f"{current} {word}"
        if text_bbox(draw, candidate, fnt)[0] <= max_width:
            current = candidate
        else:
            lines.append(current)
            current = word
    lines.append(current)
    return lines


def draw_text_block(
    draw: ImageDraw.ImageDraw,
    xy: tuple[int, int],
    text: str,
    fnt: ImageFont.FreeTypeFont,
    fill: str,
    max_width: int,
    line_gap: int = 12,
    align: str = "left",
) -> int:
    x, y = xy
    lines: list[str] = []
    for para in text.split("\n"):
        if para.strip():
            lines.extend(wrap_lines(draw, para.strip(), fnt, max_width))
        lines.append("")
    if lines and lines[-1] == "":
        lines.pop()

    for line in lines:
        if not line:
            y += int(fnt.size * 0.6)
            continue
        w, h = text_bbox(draw, line, fnt)
        tx = x
        if align == "center":
            tx = x + (max_width - w) // 2
        elif align == "right":
            tx = x + max_width - w
        draw.text((tx, y), line, font=fnt, fill=fill)
        y += h + line_gap
    return y


def rounded(draw: ImageDraw.ImageDraw, box: tuple[int, int, int, int], radius: int, fill: str, outline: str | None = None, width: int = 1) -> None:
    draw.rounded_rectangle(box, radius=radius, fill=fill, outline=outline, width=width)


def qr_code(url: str, size: int) -> Image.Image:
    qr = qrcode.QRCode(
        version=None,
        error_correction=qrcode.constants.ERROR_CORRECT_H,
        box_size=16,
        border=3,
    )
    qr.add_data(url)
    qr.make(fit=True)
    img = qr.make_image(fill_color="#0a0a0a", back_color="#ffffff").convert("RGB")
    return img.resize((size, size), Image.Resampling.NEAREST)


def paste_qr(draw: ImageDraw.ImageDraw, page: Image.Image, box: tuple[int, int, int, int], url: str, label: str, dark: bool = True) -> None:
    x1, y1, x2, y2 = box
    bg = "#fffdf5"
    border = COLORS["gold"] if dark else COLORS["ink"]
    rounded(draw, box, 34, bg, border, 6)
    pad = 46
    qr = qr_code(url, min(x2 - x1, y2 - y1) - pad * 2)
    page.paste(qr, (x1 + pad, y1 + pad))
    label_font = font(MONO, 28)
    label_w, label_h = text_bbox(draw, label, label_font)
    draw.text((x1 + (x2 - x1 - label_w) // 2, y2 - pad // 2 - label_h), label, font=label_font, fill=COLORS["ink"])


def draw_pill(draw: ImageDraw.ImageDraw, xy: tuple[int, int], text: str, fill: str, text_fill: str, pad_x: int = 26, pad_y: int = 14) -> tuple[int, int, int, int]:
    fnt = font(MONO, 28)
    w, h = text_bbox(draw, text, fnt)
    x, y = xy
    box = (x, y, x + w + pad_x * 2, y + h + pad_y * 2)
    rounded(draw, box, 18, fill)
    draw.text((x + pad_x, y + pad_y - 2), text, font=fnt, fill=text_fill)
    return box


def draw_pixel_buddy(draw: ImageDraw.ImageDraw, x: int, y: int, scale: int = 10, dark_bg: bool = True) -> None:
    # Tiny print mascot: top hat, quantum head, tux. Intentionally simple for flyer scale.
    colors = {
        "K": "#0a0a0a",
        "W": "#fff7df",
        "G": COLORS["gold"],
        "C": COLORS["cyan"],
        "P": "#b483ff",
        "R": COLORS["rust"],
        "T": "#1a1a2e",
    }
    rows = [
        ".....KKKKK.....",
        ".....KWWWK.....",
        ".....KWWWK.....",
        "...KKKKKKKKK...",
        "...............",
        "....CPPPPC.....",
        "...PWWWWWWP....",
        "..CWWGWWGWWC...",
        "...PWWRWWWPP...",
        "....CWWWWC.....",
        "......KK.......",
        ".....KTTK......",
        "....KTTTTK.....",
        "....KGTTGK.....",
        ".....KTTK......",
        "....KK..KK.....",
    ]
    halo = COLORS["gold"] if dark_bg else "#ead28a"
    draw.ellipse((x - scale * 2, y - scale * 2, x + scale * 17, y + scale * 17), fill=halo if dark_bg else "#fff3c2")
    if dark_bg:
        draw.ellipse((x - scale, y - scale, x + scale * 16, y + scale * 16), fill="#252033")
    for r, row in enumerate(rows):
        for c, ch in enumerate(row):
            if ch == ".":
                continue
            draw.rectangle(
                (x + c * scale, y + r * scale, x + (c + 1) * scale - 1, y + (r + 1) * scale - 1),
                fill=colors[ch],
            )


def page_to_pdf(png_path: Path, pdf_path: Path, inches: tuple[float, float]) -> None:
    w_pt, h_pt = inches[0] * 72, inches[1] * 72
    c = canvas.Canvas(str(pdf_path), pagesize=(w_pt, h_pt))
    c.drawImage(ImageReader(str(png_path)), 0, 0, width=w_pt, height=h_pt)
    c.showPage()
    c.save()


def save(page: Image.Image, name: str, inches: tuple[float, float]) -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    png = OUT / f"{name}.png"
    pdf = OUT / f"{name}.pdf"
    page.save(png, optimize=True)
    page_to_pdf(png, pdf, inches)
    print(png.relative_to(ROOT))
    print(pdf.relative_to(ROOT))


def draw_bold_letter() -> None:
    w, h = int(8.5 * DPI), int(11 * DPI)
    page = Image.new("RGB", (w, h), hex_to_rgb(COLORS["dark"]))
    draw = ImageDraw.Draw(page)

    margin = 130
    rounded(draw, (margin, margin, w - margin, h - margin), 44, "#171019", COLORS["gold"], 8)
    draw.rectangle((margin, h - 460, w - margin, h - margin), fill="#201307")

    draw_pixel_buddy(draw, w - margin - 300, margin + 75, 12)
    draw.text((margin + 80, margin + 80), "AIIT-THRESHOLD | BUDDY PUBLIC TEST", font=font(MONO, 34), fill=COLORS["gold"])
    draw.text((margin + 80, margin + 170), "HELP TEST", font=font(SERIF_BOLD, 170), fill=COLORS["cream2"])
    draw.text((margin + 80, margin + 345), "BUDDY", font=font(SERIF_BOLD, 245), fill=COLORS["gold"])
    draw.text((margin + 80, margin + 610), "Persistent chat is live. We need real people to try it.", font=font(SERIF_ITALIC, 58), fill=COLORS["cream2"])

    card_y = margin + 760
    card_w = 1180
    card_h = 330
    cards = [
        ("WHAT TO DO", "Scan the code. Talk to Buddy. Come back later. See what carries through."),
        ("WHAT TO REPORT", "Forgot context, wrong memory, over-connected patterns, strange tone, loops, or anything unsafe."),
        ("WHAT NOT TO SHARE", "No passwords, private keys, emergencies, financial secrets, or confidential third-party material."),
    ]
    for i, (title, body) in enumerate(cards):
        y = card_y + i * (card_h + 55)
        rounded(draw, (margin + 80, y, margin + 80 + card_w, y + card_h), 28, "#231c16", "#56411f", 3)
        draw.text((margin + 125, y + 45), title, font=font(MONO, 36), fill=COLORS["gold"])
        draw_text_block(draw, (margin + 125, y + 115), body, font(SERIF, 45), COLORS["cream2"], card_w - 90, line_gap=12)

    qr_box = (w - margin - 900, card_y, w - margin - 80, card_y + 820)
    paste_qr(draw, page, qr_box, URL, "SCAN TO JOIN")
    draw_text_block(
        draw,
        (w - margin - 900, card_y + 870),
        "GitHub login unlocks the persistent Buddy Thread. Logged-out visitors can still ask one-shot questions.",
        font(SANS, 38),
        COLORS["cream2"],
        820,
        line_gap=10,
        align="center",
    )

    footer_y = h - 380
    draw.text((margin + 80, footer_y), "NOT A SEARCH BOX. A TEST SURFACE FOR AI MEMORY, CONTEXT, AND WEIRDNESS.", font=font(MONO, 36), fill=COLORS["gold2"])
    draw.text((margin + 80, footer_y + 85), "aiit-threshold.com/ask-buddy", font=font(SERIF_BOLD, 58), fill=COLORS["cream2"])
    draw.text((margin + 80, footer_y + 185), "Data policy: aiit-threshold.com/data-policy | AIIT-THRESHOLD LLC | Council Hill, Oklahoma", font=font(MONO, 28), fill="#b49a61")

    save(page, "buddy-testing-bold-letter", (8.5, 11))


def draw_clean_letter() -> None:
    w, h = int(8.5 * DPI), int(11 * DPI)
    page = Image.new("RGB", (w, h), hex_to_rgb(COLORS["cream"]))
    draw = ImageDraw.Draw(page)
    margin = 140

    draw.rectangle((0, 0, w, 110), fill=COLORS["dark"])
    draw.text((margin, 34), "BUDDY TESTING PERIOD | MAY 2026", font=font(MONO, 32), fill=COLORS["gold"])
    draw_pill(draw, (w - margin - 430, 28), "EARLY ACCESS", COLORS["gold"], COLORS["ink"])

    draw.text((margin, 210), "You're invited", font=font(SERIF_BOLD, 126), fill=COLORS["ink"])
    draw.text((margin, 350), "to test Buddy.", font=font(SERIF_BOLD, 126), fill=COLORS["rust"])
    draw_text_block(
        draw,
        (margin, 535),
        "Buddy is entering a new testing period for persistent conversation. We are looking for people willing to talk to him, return later, and tell us where the system feels useful, strange, broken, or genuinely different.",
        font(SERIF, 49),
        COLORS["ink"],
        w - margin * 2,
        line_gap=16,
    )

    left = margin
    top = 1080
    col_w = 1020
    rounded(draw, (left, top, left + col_w, top + 1080), 30, "#fffaf0", COLORS["line"], 4)
    draw.text((left + 55, top + 55), "Tester checklist", font=font(SERIF_BOLD, 62), fill=COLORS["ink"])
    checklist = [
        "Ask a real question.",
        "Come back later and continue.",
        "Notice what Buddy remembers.",
        "Use Report weird behavior.",
        "Tell us what felt different.",
    ]
    y = top + 180
    for item in checklist:
        draw.ellipse((left + 60, y + 13, left + 92, y + 45), fill=COLORS["gold"])
        draw.text((left + 120, y), item, font=font(SANS, 46), fill=COLORS["ink"])
        y += 125

    draw_text_block(
        draw,
        (left + 55, top + 860),
        "Do not submit passwords, private keys, emergencies, financial secrets, or anything you do not want reviewed by AIIT.",
        font(SANS_BOLD, 32),
        COLORS["rust"],
        col_w - 110,
        line_gap=10,
    )

    qr_box = (w - margin - 840, top, w - margin, top + 840)
    paste_qr(draw, page, qr_box, URL, "SCAN TO TALK", dark=False)
    draw_text_block(
        draw,
        (w - margin - 840, top + 900),
        "GitHub login unlocks the persistent Buddy Thread. Logged-out Ask Buddy remains available.",
        font(SANS, 38),
        COLORS["ink"],
        840,
        line_gap=10,
        align="center",
    )
    draw.text((w - margin - 770, top + 1060), "aiit-threshold.com/ask-buddy", font=font(MONO, 34), fill=COLORS["rust"])

    band_y = h - 520
    draw.rectangle((0, band_y, w, h), fill=COLORS["dark"])
    draw.text((margin, band_y + 95), "At the heart of this site:", font=font(MONO, 34), fill=COLORS["gold"])
    draw_text_block(
        draw,
        (margin, band_y + 165),
        "We are testing what AI can offer the world beyond cute pictures: memory, continuity, coherence, and honest human feedback.",
        font(SERIF_ITALIC, 47),
        COLORS["cream2"],
        w - margin * 2,
        line_gap=14,
    )
    draw.text((margin, h - 95), "Data policy: aiit-threshold.com/data-policy | AIIT-THRESHOLD LLC | Council Hill, Oklahoma", font=font(MONO, 27), fill="#b49a61")

    save(page, "buddy-testing-clean-letter", (8.5, 11))


def draw_card_5x7() -> None:
    w, h = int(5 * DPI), int(7 * DPI)
    page = Image.new("RGB", (w, h), hex_to_rgb(COLORS["dark"]))
    draw = ImageDraw.Draw(page)
    margin = 85

    rounded(draw, (margin, margin, w - margin, h - margin), 30, "#1c130d", COLORS["gold"], 5)
    draw_pixel_buddy(draw, margin + 55, margin + 70, 8)
    draw.text((margin + 220, margin + 80), "BUDDY", font=font(SERIF_BOLD, 94), fill=COLORS["gold"])
    draw.text((margin + 225, margin + 178), "testing period", font=font(MONO, 27), fill=COLORS["cream2"])

    draw_text_block(
        draw,
        (margin + 60, margin + 335),
        "Talk to Buddy.",
        font(SERIF_BOLD, 96),
        COLORS["cream2"],
        w - margin * 2 - 120,
        line_gap=8,
        align="center",
    )
    draw_text_block(
        draw,
        (margin + 80, margin + 570),
        "Help test persistent AI conversation: memory, context, weirdness, and what actually helps.",
        font(SERIF, 42),
        COLORS["cream2"],
        w - margin * 2 - 160,
        line_gap=12,
        align="center",
    )

    qr_size = 620
    qr_box = ((w - qr_size - 120) // 2, 900, (w + qr_size + 120) // 2, 900 + qr_size + 120)
    paste_qr(draw, page, qr_box, URL, "SCAN TO TEST")
    draw.text((margin + 110, 1650), "aiit-threshold.com/ask-buddy", font=fit_font(draw, "aiit-threshold.com/ask-buddy", MONO, 35, w - margin * 2 - 220), fill=COLORS["gold2"])

    rounded(draw, (margin + 65, 1735, w - margin - 65, 1930), 24, "#2a2119", "#5d431e", 3)
    draw_text_block(
        draw,
        (margin + 105, 1770),
        "Use the Report weird behavior button. Do not submit secrets or emergencies.",
        font(SANS_BOLD, 30),
        COLORS["cream2"],
        w - margin * 2 - 210,
        line_gap=8,
        align="center",
    )
    draw.text((margin + 100, h - 145), "AIIT-THRESHOLD LLC | Council Hill, Oklahoma", font=font(MONO, 22), fill="#b49a61")

    save(page, "buddy-testing-5x7-card", (5, 7))


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    draw_bold_letter()
    draw_clean_letter()
    draw_card_5x7()


if __name__ == "__main__":
    main()
