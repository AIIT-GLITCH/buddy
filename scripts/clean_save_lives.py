#!/usr/bin/env python3
"""Convert the ASCII-monospace-block formatting inside SAVE_LIVES_NOW into
clean markdown — headings, bold labels, proper lists, de-indented prose.

Respects code blocks (```...```) — content inside is untouched.
"""
import re
import sys
from pathlib import Path

SRC = Path('/home/buddy_ai/Desktop/THE_SHOP/AIIT_SITE/src/content/save-lives-now.original.md')
OUT = Path('/home/buddy_ai/Desktop/THE_SHOP/AIIT_SITE/src/content/save-lives-now.md')

# Words that should stay lowercase in titlecase conversion (joining words)
LOWER_WORDS = {
    'a', 'an', 'the', 'and', 'or', 'but', 'of', 'for', 'to', 'in',
    'on', 'at', 'by', 'is', 'as', 'vs', 'with', 'from',
}

def titlecase(s: str) -> str:
    words = s.split()
    out = []
    for i, w in enumerate(words):
        lw = w.lower()
        if i > 0 and lw in LOWER_WORDS:
            out.append(lw)
        else:
            out.append(lw.capitalize())
    return ' '.join(out)

# Label header (own line): indented, CAPS (w/ optional digits + punctuation), ends with colon
# Examples:
#   "  WHAT TO DO:"
#   "  WHY IT WORKS:"
#   "  THE MECHANISM (verified gut-brain pathway):"
#   "  THE FINDING (155 million computations, Paper 25):"
LABEL_HEADER = re.compile(r'^\s+([A-Z][A-Z0-9 ,()\-\.\'&/]*[A-Z0-9)]):\s*$')

# Inline label: indented, CAPS prefix, colon, then content
# Examples:
#   "  RISK: essentially zero..."
#   "  CHANNEL 1: BEHAVIORAL FRAGMENTATION"
#   "  COST: $15-30 for LED..."
# Don't match when the part before : is too long (probably not a label)
INLINE_LABEL = re.compile(r'^\s+([A-Z][A-Z0-9 \-\.\'&/]{1,45}):\s+(.+?)\s*$')

# Lines that are purely decoration
PURE_EQUALS = re.compile(r'^\s*=+\s*$')
PURE_DASHES_HEAVY = re.compile(r'^\s*─+\s*$')  # Unicode em dashes used as underlines
PURE_DASHES_LIGHT = re.compile(r'^\s*-{5,}\s*$')

# Markdown fence detection
FENCE = re.compile(r'^\s*```')

def process(text: str) -> str:
    lines = text.split('\n')
    out = []
    in_fence = False

    for raw in lines:
        # Track fenced code blocks — pass through unchanged
        if FENCE.match(raw):
            in_fence = not in_fence
            out.append(raw)
            continue
        if in_fence:
            out.append(raw)
            continue

        # Strip decoration-only lines
        if PURE_EQUALS.match(raw) or PURE_DASHES_HEAVY.match(raw) or PURE_DASHES_LIGHT.match(raw):
            continue

        # Preserve empty lines
        if raw.strip() == '':
            out.append('')
            continue

        # Preserve already-good markdown structure
        stripped = raw.lstrip()
        if stripped.startswith('#'):
            out.append(raw)
            continue
        if raw.startswith('---') or raw.startswith('***'):
            out.append(raw)
            continue

        # Preserve top-level bullet/numbered lists (no indent)
        if re.match(r'^[-*]\s', raw) or re.match(r'^\d+\.\s', raw):
            out.append(raw)
            continue

        # Label on own line → ### heading
        m = LABEL_HEADER.match(raw)
        if m:
            label = m.group(1).strip()
            if 2 <= len(label) <= 80:
                out.append(f'### {titlecase(label)}')
                continue

        # Inline label → **Bold:** content
        m = INLINE_LABEL.match(raw)
        if m:
            label = m.group(1).strip()
            content = m.group(2).strip()
            if 2 <= len(label) <= 45 and content:
                out.append(f'**{titlecase(label)}:** {content}')
                continue

        # Indented bullet → flatten to top-level
        # "  - item" or "    - item" → "- item"
        m = re.match(r'^\s+([-*])\s+(.+)$', raw)
        if m:
            out.append(f'- {m.group(2).rstrip()}')
            continue

        # Numbered list indented → flatten
        m = re.match(r'^\s+(\d+)\.\s+(.+)$', raw)
        if m:
            out.append(f'{m.group(1)}. {m.group(2).rstrip()}')
            continue

        # Generic indented prose → de-indent
        if raw.startswith(' '):
            out.append(stripped.rstrip())
            continue

        # Fall-through: preserve as-is (trim trailing whitespace)
        out.append(raw.rstrip())

    # Post-pass: collapse 3+ blank lines to 2
    joined = '\n'.join(out)
    joined = re.sub(r'\n{3,}', '\n\n', joined)

    # Ensure blank line before ## and ### (easier rendering)
    joined = re.sub(r'([^\n])\n(### )', r'\1\n\n\2', joined)
    joined = re.sub(r'([^\n])\n(## )', r'\1\n\n\2', joined)
    joined = re.sub(r'([^\n])\n(# PART)', r'\1\n\n\2', joined)

    return joined

# --- Stage B post-passes -----------------------------------------------------

def fix_orphan_continuations(text: str) -> str:
    """If a non-bullet, non-heading line immediately follows a bullet with no
    blank line between, it's a continuation of that bullet. Join them."""
    lines = text.split('\n')
    out = []
    for line in lines:
        stripped = line.strip()
        if (out and stripped
            and out[-1].startswith('- ')
            and not stripped.startswith('- ')
            and not stripped.startswith('* ')
            and not line.startswith('#')
            and not stripped.startswith('**')
            and not stripped.startswith('>')
            and not stripped.startswith('---')
            and not re.match(r'^\d+\.\s', stripped)):
            out[-1] = out[-1] + ' ' + stripped
        else:
            out.append(line)
    return '\n'.join(out)

CITATION_HEADER_RE = re.compile(
    r'^###\s+(the\s+)?(proof|evidence|data|citations?|studies|trials?|'
    r'clinical\s+evidence|medical\s+evidence|findings?|research|results?)\s*$',
    re.IGNORECASE,
)

def bulletize_citations(text: str) -> str:
    """Inside a chapter, after a heading like `### The Proof`, consecutive
    paragraphs (separated by blank lines) are citations — turn each into a bullet."""
    lines = text.split('\n')
    out = []
    in_citations = False
    buffer: list[str] = []
    in_fence = False

    def flush():
        if buffer:
            joined = ' '.join(buffer).strip()
            if joined:
                out.append(f'- {joined}')
            buffer.clear()

    for line in lines:
        if FENCE.match(line):
            flush()
            in_fence = not in_fence
            out.append(line)
            continue
        if in_fence:
            out.append(line)
            continue

        stripped = line.strip()

        # Any heading or hr ends citation mode
        if line.startswith('#'):
            flush()
            in_citations = bool(CITATION_HEADER_RE.match(line))
            out.append(line)
            continue

        if stripped == '---':
            flush()
            in_citations = False
            out.append(line)
            continue

        if not in_citations:
            out.append(line)
            continue

        # In citation mode
        if stripped == '':
            flush()
            out.append(line)
            continue

        # Already a bullet? flush buffer, keep line as-is
        if stripped.startswith('- ') or stripped.startswith('* '):
            flush()
            out.append(line)
            continue

        # Bold label? probably not a citation, exit mode
        if stripped.startswith('**'):
            flush()
            in_citations = False
            out.append(line)
            continue

        buffer.append(stripped)

    flush()
    return '\n'.join(out)

# --- main --------------------------------------------------------------------

def main():
    src = SRC.read_text()
    cleaned = process(src)
    cleaned = fix_orphan_continuations(cleaned)
    cleaned = bulletize_citations(cleaned)
    # Final blank-line normalization after post-passes
    cleaned = re.sub(r'\n{3,}', '\n\n', cleaned)
    OUT.write_text(cleaned)

    src_lines = src.count('\n')
    out_lines = cleaned.count('\n')
    src_bytes = len(src.encode())
    out_bytes = len(cleaned.encode())
    print(f"IN:  {src_lines:>6} lines, {src_bytes:>8} bytes  ({SRC})")
    print(f"OUT: {out_lines:>6} lines, {out_bytes:>8} bytes  ({OUT})")
    print(f"DELTA: {out_lines - src_lines:+d} lines, {out_bytes - src_bytes:+d} bytes")

if __name__ == '__main__':
    main()
