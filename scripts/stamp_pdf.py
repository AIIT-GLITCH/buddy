#!/usr/bin/env python3
"""
stamp_pdf.py — overlay copyright + wAIste Not watermark on every page of a PDF.

Usage:  stamp_pdf.py <input.pdf> <output.pdf>

Overlay (bottom strip on every page):
  left  — © 2026 Rhet Dillard Wike · AIIT-THRESHOLD LLC · All rights reserved
  right — wAIste Not · Print Verified    (AI = amber, rest = muted blue)
"""

import io
import sys
from pypdf import PdfReader, PdfWriter
from reportlab.pdfgen import canvas
from reportlab.lib.colors import Color


def build_overlay(page_width: float, page_height: float) -> io.BytesIO:
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=(page_width, page_height))

    # thin hairline top-border for the footer strip (very subtle)
    strip_h = 22.0
    margin  = 18.0
    baseline = 10.0

    # palette
    muted   = Color(0.35, 0.44, 0.50, alpha=0.55)   # muted blue-grey
    amber   = Color(0.83, 0.63, 0.38, alpha=0.95)   # gold accent
    wm_blue = Color(0.25, 0.56, 0.82, alpha=0.35)

    # faint divider line just above the footer
    c.setStrokeColor(Color(0.25, 0.56, 0.82, alpha=0.10))
    c.setLineWidth(0.3)
    c.line(margin, strip_h + 2, page_width - margin, strip_h + 2)

    # Copyright (left)
    c.setFont("Courier-Bold", 6.5)
    c.setFillColor(muted)
    copyright_text = "(C) 2026 RHET DILLARD WIKE  .  AIIT-THRESHOLD LLC  .  ALL RIGHTS RESERVED"
    c.drawString(margin, baseline, copyright_text)

    # wAIste Not (right) — "w" + "AI" amber + "ste Not . Print Verified"
    c.setFont("Courier-Bold", 6.5)
    c.setFillColor(wm_blue)
    # approximate right-align by measuring the string via canvas.stringWidth
    full_str = "wAIste Not  .  Print Verified"
    full_w   = c.stringWidth(full_str, "Courier-Bold", 6.5)
    x        = page_width - margin - full_w
    # segments for colored "AI"
    pre, ai, post = "w", "AI", "ste Not  .  Print Verified"
    c.setFillColor(wm_blue)
    c.drawString(x, baseline, pre)
    x_cursor = x + c.stringWidth(pre, "Courier-Bold", 6.5)
    c.setFillColor(amber)
    c.drawString(x_cursor, baseline, ai)
    x_cursor += c.stringWidth(ai, "Courier-Bold", 6.5)
    c.setFillColor(wm_blue)
    c.drawString(x_cursor, baseline, post)

    c.showPage()
    c.save()
    buf.seek(0)
    return buf


def stamp(input_path: str, output_path: str) -> None:
    reader = PdfReader(input_path)
    writer = PdfWriter()

    for page in reader.pages:
        pw = float(page.mediabox.width)
        ph = float(page.mediabox.height)
        overlay_pdf = PdfReader(build_overlay(pw, ph))
        overlay_page = overlay_pdf.pages[0]
        page.merge_page(overlay_page)
        writer.add_page(page)

    # Set metadata with copyright too
    writer.add_metadata({
        "/Author":    "Rhet Dillard Wike",
        "/Creator":   "AIIT-THRESHOLD LLC",
        "/Producer":  "wAIste Not — Print Verified",
        "/Copyright": "(C) 2026 Rhet Dillard Wike. All rights reserved.",
    })

    with open(output_path, "wb") as f:
        writer.write(f)


if __name__ == "__main__":
    if len(sys.argv) != 3:
        print("usage: stamp_pdf.py <input.pdf> <output.pdf>", file=sys.stderr)
        sys.exit(2)
    stamp(sys.argv[1], sys.argv[2])
