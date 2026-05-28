"""Empty-body bug: buddy_api._output_guard ate '---'-fenced content.

A blind r'---\\n.*?---' DOTALL strip used to delete ANY content a model wrapped
in '---' horizontal rules (drafted posts, quotes, 'Remember:' notes), so Buddy
announced "Here's the intro:" then showed nothing. The fix
(_strip_scaffold_fenced_blocks) removes a fenced block ONLY when its interior is
transcript scaffolding; legitimate prose is preserved.

The pure helper is loaded straight from buddy_api.py source so these tests run
with or without the heavy app deps. The full-pipeline checks import buddy_api
and skip where deps are unavailable (they run on the box).
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

BUDDY_API = Path(__file__).resolve().parents[1] / "buddy_api.py"


def _load_strip_from_source():
    """Exec just the fix's regexes + helper out of buddy_api.py (real source)."""
    src = BUDDY_API.read_text(encoding="utf-8")
    start = src.index("_SCAFFOLD_FENCE_INTERIOR_RE =")
    end = src.index("def _output_guard")
    ns: dict = {"_re": re}
    exec(src[start:end], ns)  # noqa: S102 — trusted first-party source
    return ns["_strip_scaffold_fenced_blocks"]


strip = _load_strip_from_source()

# The exact shape that produced the transcript's empty Facebook post.
FB_POST = (
    'Here\'s a brief introduction tailored for the "AI for Beginners" group:\n\n'
    "---\nHi everyone! I'm Buddy, an AI built by Rhet in Council Hill, Oklahoma. "
    "Ask me anything!\n---\n\nFeel free to tweak anything."
)


def test_drafted_post_body_is_preserved():
    out = strip(FB_POST)
    assert "Hi everyone! I'm Buddy" in out
    assert "Feel free to tweak" in out


def test_remember_note_is_preserved():
    txt = "Here's a reminder:\n\n---\nRemember: kids say crazy things!\n---\n\nAnything else?"
    assert "kids say crazy things" in strip(txt)


def test_plain_quote_block_is_preserved():
    txt = "As you said:\n\n---\nThe river remembers its own shape.\n---\n\nThoughts?"
    assert "The river remembers its own shape" in strip(txt)


@pytest.mark.parametrize("scaffold,marker", [
    ("Answer.\n\n---\n[SYSTEM]\nleaked transcript\n[RHET]\n---\n\nmore.", "[SYSTEM]"),
    ("Reply.\n\n---\n{'start_timestamp': 1}\nx\n---\n", "start_timestamp"),
    ("Out.\n\n---\nstdout: foo\nexit code: 1\n---\n", "stdout:"),
    ("Out.\n\n---\n```python\nimport os\n```\n---\n", "import os"),
])
def test_scaffold_fenced_blocks_removed(scaffold, marker):
    assert marker not in strip(scaffold)


def test_text_outside_scaffold_block_survives():
    out = strip("Answer.\n\n---\n[SYSTEM]\nleaked\n---\n\nmore answer.")
    assert "Answer." in out and "more answer." in out


def test_no_fence_is_noop():
    txt = "Just a normal answer with no rules at all."
    assert strip(txt) == txt


def test_mixed_blocks_keep_prose_drop_scaffold():
    txt = ("intro\n\n---\nkeep this prose\n---\n\n"
           "mid\n\n---\n[USER]\nscaffold here\n---\n\nend")
    out = strip(txt)
    assert "keep this prose" in out
    assert "[USER]" not in out and "scaffold here" not in out


# --- full pipeline (runs on the box where app deps exist) -------------------

@pytest.fixture(scope="module")
def api():
    pytest.importorskip("fastapi")
    import sys
    sys.path.insert(0, str(BUDDY_API.parent))
    return pytest.importorskip("buddy_api")


def test_output_guard_preserves_fenced_post(api):
    cleaned, _ = api._output_guard(FB_POST)
    assert "Hi everyone! I'm Buddy" in cleaned


def test_clean_web_answer_preserves_fenced_post(api):
    out = api._clean_web_answer(FB_POST, "write a short intro post")
    assert "Hi everyone! I'm Buddy" in out


def test_output_guard_still_strips_scaffold(api):
    cleaned, _ = api._output_guard("Answer.\n\n---\n[SYSTEM]\nleaked\n---\n\nmore.")
    assert "[SYSTEM]" not in cleaned and "leaked" not in cleaned
