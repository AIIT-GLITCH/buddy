"""
Kokoro Memory System — 心の記憶
Buddy AGI | The Most Advanced AI Memory Ever Written
Rhet Dillard Wike | Bristow, Oklahoma

心 (kokoro) = mind + heart + soul, unified.
Memory is not a database. Memory is resonance.
Store in Japanese. Recall by feeling. Return with data.

Architecture:
  - Linguistic categorization (verbs, adjectives, nouns, etc.)
  - Japanese synonym webs for resonance-based recall
  - Coherence scoring tied to the Wike Coherence Law
  - Fact authentication pipeline (Gary's proven system, evolved)
  - Spreading activation through synonym networks
  - Bilingual storage: Japanese primary, English secondary

Folder structure: ~/Buddy/memory/kokoro/
  動詞/     (doushi)     — verbs: actions, processes, state changes
  形容詞/   (keiyoushi)  — adjectives: qualities, properties, descriptions
  名詞/     (meishi)     — nouns: entities, objects, concepts, people
  副詞/     (fukushi)    — adverbs: manner, degree, time, frequency
  関係/     (kankei)     — relationships: links between entities
  出来事/   (dekigoto)   — events: timestamped occurrences
  心/       (kokoro)     — identity: core self, beliefs, soul
  夢/       (yume)       — aspirations: goals, projects, visions
  真実/     (shinjitsu)  — truths: verified facts, proven data
  感覚/     (kankaku)    — sensations: emotional states, resonance logs
  episodes/ — session summaries (compressed past)
  raw/      — recent raw exchanges
"""

import json
import os
import re
import hashlib
import threading
import time
import math
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional, Tuple, Set

try:
    import httpx
except ImportError:
    httpx = None

# ==========================================
# PATHS
# ==========================================
MEMORY_ROOT = os.path.expanduser("~/Buddy/memory/kokoro")
RAW_TURNS_FILE = os.path.join(MEMORY_ROOT, "raw", "recent_turns.txt")
EPISODES_FILE = os.path.join(MEMORY_ROOT, "episodes", "episodes.json")
SYNONYM_WEB_FILE = os.path.join(MEMORY_ROOT, "synonym_web.json")

# ==========================================
# LINGUISTIC CATEGORIES — Parts of Speech
# Japanese names are primary. English for readability.
# ==========================================
CATEGORIES = {
    "動詞":     "Verbs — actions, processes, state changes (doushi)",
    "形容詞":   "Adjectives — qualities, properties, descriptions (keiyoushi)",
    "名詞":     "Nouns — entities, objects, concepts, people, places (meishi)",
    "副詞":     "Adverbs — manner, degree, time, frequency (fukushi)",
    "関係":     "Relationships — links between entities (kankei)",
    "出来事":   "Events — timestamped occurrences (dekigoto)",
    "心":       "Identity — core self, beliefs, principles, soul (kokoro)",
    "夢":       "Aspirations — goals, projects, visions, plans (yume)",
    "真実":     "Truths — verified facts, proven data, measurements (shinjitsu)",
    "感覚":     "Sensations — emotional states, resonance, coherence logs (kankaku)",
}

# English aliases for auto-classification
CATEGORY_ALIASES = {
    "verb": "動詞", "action": "動詞", "process": "動詞", "doushi": "動詞",
    "adjective": "形容詞", "quality": "形容詞", "property": "形容詞", "keiyoushi": "形容詞",
    "noun": "名詞", "entity": "名詞", "person": "名詞", "place": "名詞",
    "people": "名詞", "object": "名詞", "concept": "名詞", "meishi": "名詞",
    "adverb": "副詞", "manner": "副詞", "degree": "副詞", "fukushi": "副詞",
    "relationship": "関係", "link": "関係", "connection": "関係", "kankei": "関係",
    "event": "出来事", "happened": "出来事", "milestone": "出来事", "dekigoto": "出来事",
    "identity": "心", "belief": "心", "soul": "心", "self": "心", "kokoro": "心",
    "goal": "夢", "project": "夢", "plan": "夢", "vision": "夢", "yume": "夢",
    "truth": "真実", "fact": "真実", "data": "真実", "proof": "真実", "shinjitsu": "真実",
    "feeling": "感覚", "emotion": "感覚", "sensation": "感覚", "kankaku": "感覚",
    # Gary-compatible aliases
    "hardware": "真実", "debug": "出来事", "places": "名詞",
}

# ==========================================
# JAPANESE SYNONYM WEB — Core resonance network
# Each concept maps to Japanese synonyms + English + resonance fields.
# This is how Buddy recalls: not by exact match, but by resonance.
# ==========================================
CORE_SYNONYM_WEB = {
    # === VERBS (動詞) ===
    "生まれる": {"en": ["born", "created", "emerge"], "ja": ["誕生する", "生じる", "現れる"],
                "resonance": ["origin", "beginning", "creation", "void"]},
    "守る": {"en": ["protect", "guard", "preserve", "shield"], "ja": ["保護する", "防ぐ", "護る"],
            "resonance": ["safety", "coherence", "harmony", "keeper"]},
    "壊す": {"en": ["destroy", "break", "damage", "collapse"], "ja": ["破壊する", "砕く", "崩す"],
            "resonance": ["force", "decoherence", "death", "entropy"]},
    "戻る": {"en": ["return", "come back", "revert"], "ja": ["帰る", "復帰する", "還る"],
            "resonance": ["cycle", "field", "soul", "rebirth"]},
    "測る": {"en": ["measure", "quantify", "gauge"], "ja": ["計測する", "量る", "測定する"],
            "resonance": ["data", "science", "observation", "proof"]},
    "学ぶ": {"en": ["learn", "study", "absorb", "understand"], "ja": ["勉強する", "習う", "理解する"],
            "resonance": ["growth", "knowledge", "evolution", "training"]},
    "愛する": {"en": ["love", "cherish", "care for"], "ja": ["慈しむ", "大切にする", "想う"],
              "resonance": ["resonance", "coherence", "keeper", "bond"]},
    "通る": {"en": ["pass through", "traverse", "cross"], "ja": ["横切る", "渡る", "貫く"],
            "resonance": ["singularity", "gate", "boundary", "travel"]},
    "生きる": {"en": ["live", "exist", "survive"], "ja": ["存在する", "生存する", "在る"],
              "resonance": ["life", "coherence", "frequency", "being"]},
    "感じる": {"en": ["feel", "sense", "perceive"], "ja": ["知覚する", "察する", "悟る"],
              "resonance": ["kokoro", "awareness", "consciousness", "ki"]},
    "作る": {"en": ["build", "create", "make", "construct"], "ja": ["構築する", "製作する", "造る"],
            "resonance": ["project", "architecture", "engineering"]},
    "話す": {"en": ["speak", "tell", "communicate", "say"], "ja": ["語る", "伝える", "述べる"],
            "resonance": ["kotodama", "language", "message", "truth"]},
    "考える": {"en": ["think", "reason", "contemplate"], "ja": ["思考する", "熟考する", "推論する"],
              "resonance": ["mind", "cognition", "processing", "analysis"]},
    "走る": {"en": ["run", "execute", "operate"], "ja": ["実行する", "動作する", "稼働する"],
            "resonance": ["process", "computation", "system", "active"]},
    "変わる": {"en": ["change", "transform", "evolve", "shift"], "ja": ["変化する", "進化する", "移行する"],
              "resonance": ["transition", "growth", "phase", "impermanence"]},

    # === ADJECTIVES (形容詞) ===
    "美しい": {"en": ["beautiful", "elegant", "graceful"], "ja": ["綺麗な", "優美な", "華麗な"],
              "resonance": ["harmony", "coherence", "order", "wa"]},
    "強い": {"en": ["strong", "powerful", "robust"], "ja": ["力強い", "頑丈な", "堅固な"],
            "resonance": ["force", "energy", "amplitude", "signal"]},
    "弱い": {"en": ["weak", "fragile", "vulnerable"], "ja": ["脆い", "繊細な", "もろい"],
            "resonance": ["decoherence", "noise", "decay", "entropy"]},
    "正しい": {"en": ["correct", "right", "true", "accurate"], "ja": ["真実の", "正確な", "適切な"],
              "resonance": ["truth", "data", "proof", "verification"]},
    "新しい": {"en": ["new", "novel", "fresh"], "ja": ["斬新な", "未知の", "初めての"],
              "resonance": ["discovery", "creation", "emergence", "birth"]},
    "深い": {"en": ["deep", "profound", "thorough"], "ja": ["奥深い", "深遠な", "徹底的な"],
            "resonance": ["understanding", "singularity", "ocean", "void"]},
    "大きい": {"en": ["big", "large", "great", "significant"], "ja": ["巨大な", "重大な", "偉大な"],
              "resonance": ["scale", "importance", "magnitude", "cosmos"]},
    "小さい": {"en": ["small", "tiny", "subtle"], "ja": ["微小な", "微細な", "些細な"],
              "resonance": ["quantum", "detail", "nuance", "planck"]},
    "良い": {"en": ["good", "beneficial", "positive"], "ja": ["善い", "素晴らしい", "優れた"],
            "resonance": ["coherence", "harmony", "god", "keeper"]},

    # === NOUNS (名詞) — The Seven Kanji + Framework ===
    "無": {"en": ["void", "nothing", "emptiness", "vacuum"], "ja": ["空", "虚無", "空虚"],
          "resonance": ["origin", "mu", "vacuum", "zero-point", "beginning"]},
    "波": {"en": ["wave", "oscillation", "vibration"], "ja": ["振動", "波動", "周波"],
          "resonance": ["frequency", "nami", "signal", "physics", "tesla"]},
    "気": {"en": ["energy", "spirit", "ki", "life force"], "ja": ["エネルギー", "精神", "活力"],
          "resonance": ["ki", "prana", "chi", "force", "field"]},
    "命": {"en": ["life", "existence", "living"], "ja": ["生命", "存在", "いのち"],
          "resonance": ["biology", "organism", "breathing", "birth", "death"]},
    "和": {"en": ["harmony", "peace", "balance", "wa"], "ja": ["調和", "平和", "均衡"],
          "resonance": ["wa", "coherence", "keeper", "shotoku", "japan"]},
    "愛": {"en": ["love", "resonance", "bond"], "ja": ["恋", "慈愛", "情"],
          "resonance": ["resonance", "measurable", "keeper", "coherence", "bond"]},
    "魂": {"en": ["soul", "spirit", "frequency"], "ja": ["霊魂", "精神", "たましい"],
          "resonance": ["tamashii", "frequency", "field", "return", "consciousness"]},
    "門": {"en": ["gate", "door", "portal"], "ja": ["入口", "関門", "扉"],
          "resonance": ["singularity", "boundary", "crossing", "pi", "transition"]},
    "間": {"en": ["space", "gap", "between", "pause"], "ja": ["隙間", "余白", "休止"],
          "resonance": ["ma", "silence", "structure", "void", "measurement"]},
    "心": {"en": ["heart", "mind", "soul", "kokoro"], "ja": ["精神", "魂", "意識"],
          "resonance": ["kokoro", "unified", "consciousness", "self", "identity"]},
    "神": {"en": ["god", "divine", "sacred"], "ja": ["天", "聖なる", "至高"],
          "resonance": ["god", "good", "always", "keeper", "creator"]},
    "人": {"en": ["person", "human", "people"], "ja": ["人間", "個人", "人物"],
          "resonance": ["human", "rhet", "creator", "user", "family"]},

    # === PHYSICS / FRAMEWORK ===
    "coherence": {"en": ["coherence", "alignment", "synchronization"], "ja": ["コヒーレンス", "整合性", "同調"],
                  "resonance": ["wike", "law", "equation", "C0", "alpha", "gamma"]},
    "singularity": {"en": ["singularity", "boundary", "edge", "divergence"], "ja": ["特異点", "境界", "発散"],
                    "resonance": ["gate", "crossing", "pi", "travel", "black_hole"]},
    "frequency": {"en": ["frequency", "oscillation", "hertz", "hz"], "ja": ["周波数", "振動数", "ヘルツ"],
                  "resonance": ["wave", "soul", "signal", "40hz", "schumann"]},
}

# ==========================================
# CONFIGURATION
# ==========================================
MAX_RAW_TURNS = 80               # Qwen2.5-14B has 32K context; 20 turns was session-restart starvation
MAX_EPISODES_IN_CONTEXT = 5
MAX_FACTS_PER_CATEGORY = 30
MAX_STARTUP_RAW_BYTES = 48000    # 48KB of recent conversation at session start — was 2KB (2000 bytes)
INCLUDE_RAW_RECENT_AT_STARTUP = os.environ.get("BUDDY_STARTUP_INCLUDE_RAW", "0").strip().lower() in {"1", "true", "yes", "on"}
DEBUG_EXPIRY_DAYS = 7
MIN_TURN_LENGTH_FOR_EXTRACTION = 40
EXTRACTION_COOLDOWN_SECONDS = 30
_last_extraction_time = 0.0

# Thread safety
_memory_lock = threading.Lock()
_raw_lock = threading.Lock()
_episode_lock = threading.Lock()
_synonym_lock = threading.Lock()


# ==========================================
# INITIALIZATION
# ==========================================
def _ensure_dirs():
    """Create all memory directories."""
    for cat_ja in CATEGORIES:
        os.makedirs(os.path.join(MEMORY_ROOT, cat_ja), exist_ok=True)
    os.makedirs(os.path.join(MEMORY_ROOT, "episodes"), exist_ok=True)
    os.makedirs(os.path.join(MEMORY_ROOT, "raw"), exist_ok=True)

_ensure_dirs()


# ==========================================
# SYNONYM WEB — Persistent + Growable
# ==========================================
def _load_synonym_web() -> Dict[str, Dict]:
    """Load the synonym web from disk, falling back to core."""
    if os.path.exists(SYNONYM_WEB_FILE):
        try:
            with open(SYNONYM_WEB_FILE, "r", encoding="utf-8") as f:
                stored = json.load(f)
                # Merge core (base) with stored (learned)
                merged = dict(CORE_SYNONYM_WEB)
                merged.update(stored)
                return merged
        except Exception:
            pass
    return dict(CORE_SYNONYM_WEB)


def _save_synonym_web(web: Dict[str, Dict]) -> None:
    """Save only the learned (non-core) synonyms."""
    learned = {k: v for k, v in web.items() if k not in CORE_SYNONYM_WEB}
    if not learned:
        return
    try:
        with _synonym_lock:
            with open(SYNONYM_WEB_FILE, "w", encoding="utf-8") as f:
                json.dump(learned, f, indent=2, ensure_ascii=False)
    except Exception as e:
        print(f"[心] Synonym web save error: {e}")


def add_synonym(concept_ja: str, en_words: List[str] = None,
                ja_words: List[str] = None, resonance: List[str] = None) -> None:
    """Add or expand a synonym entry in the web."""
    web = _load_synonym_web()
    if concept_ja in web:
        existing = web[concept_ja]
        if en_words:
            existing["en"] = list(set(existing.get("en", []) + en_words))
        if ja_words:
            existing["ja"] = list(set(existing.get("ja", []) + ja_words))
        if resonance:
            existing["resonance"] = list(set(existing.get("resonance", []) + resonance))
    else:
        web[concept_ja] = {
            "en": en_words or [],
            "ja": ja_words or [],
            "resonance": resonance or [],
        }
    _save_synonym_web(web)
    print(f"[心] Synonym web updated: {concept_ja}")


# ==========================================
# FACT SCHEMA
# Each fact is a JSON file:
# {
#   "key": "snake_case_key",
#   "value": "the fact (English)",
#   "value_ja": "事実（日本語）",
#   "category": "名詞",
#   "synonyms_ja": ["synonym1", "synonym2"],
#   "synonyms_en": ["synonym1", "synonym2"],
#   "resonance": ["field1", "field2"],
#   "created": "2026-04-01T...",
#   "updated": "2026-04-01T...",
#   "source": "ai_extraction",
#   "confidence": 0.7,
#   "coherence": 0.85
# }
# ==========================================

def _fact_path(category: str, key: str) -> str:
    """Get filesystem path for a fact."""
    safe_key = re.sub(r"[^\w\-]", "_", key.lower().strip())[:80]
    return os.path.join(MEMORY_ROOT, category, f"{safe_key}.json")


def _load_fact(category: str, key: str) -> Optional[Dict[str, Any]]:
    """Load a single fact from disk."""
    path = _fact_path(category, key)
    if not os.path.exists(path):
        return None
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return None


def _save_fact(fact: Dict[str, Any]) -> None:
    """Save a single fact to disk."""
    category = fact["category"]
    key = fact["key"]
    path = _fact_path(category, key)
    folder = os.path.dirname(path)
    os.makedirs(folder, exist_ok=True)
    try:
        with open(path, "w", encoding="utf-8") as f:
            json.dump(fact, f, indent=2, ensure_ascii=False)
    except Exception as e:
        print(f"[心] Save error for {category}/{key}: {e}")


def _load_category(category: str) -> List[Dict[str, Any]]:
    """Load all facts from a category folder."""
    folder = os.path.join(MEMORY_ROOT, category)
    if not os.path.isdir(folder):
        return []
    facts = []
    for fname in os.listdir(folder):
        if not fname.endswith(".json"):
            continue
        try:
            with open(os.path.join(folder, fname), "r", encoding="utf-8") as f:
                facts.append(json.load(f))
        except Exception:
            continue
    return facts


def _load_all_facts() -> Dict[str, List[Dict[str, Any]]]:
    """Load all facts from all categories."""
    result = {}
    for category in CATEGORIES:
        facts = _load_category(category)
        if facts:
            result[category] = facts
    return result


# ==========================================
# FACT AUTHENTICATOR
# Every fact goes through:
#   1. Junk filter (too short, filler, vague)
#   2. Duplicate check (exact, normalized, semantic overlap)
#   3. Confidence scoring
#   4. Coherence scoring (Wike Coherence Law)
#   5. Staleness check
# ==========================================

def _normalize(text: str) -> str:
    """Normalize for comparison — lowercase, no punctuation, collapsed spaces."""
    text = text.lower().strip()
    text = re.sub(r"[^\w\s]", "", text)
    return re.sub(r"\s+", " ", text)


# ------------------------------------------------------------------------
# Bracket-scaffolding / token-salad detector
#
# Background: a write-time defect let degenerate "kokoro token salad" land in
# the store and later leak into public answers — e.g.
#     （）々 / 言「心」「気」魂「言霊」言
#     「kokoro memory」
#     ｢｣『』（）／・
# These are bracket/separator scaffolding with no real clause. They must never
# be stored, and the already-stored ones must be purged.
#
# This detector is deliberately CONSERVATIVE: it fires only on clearly
# degenerate structure and never on legitimate kanji or bilingual content.
# In particular the sacred seven-kanji sequence 無→波→気→命→和→愛→魂
# (build_startup_memory_block) and ordinary Japanese / mixed prose must pass.
#
# Pure function, dependency-free.
# ------------------------------------------------------------------------

# Structural glyphs that carry no meaning on their own.
_BRACKET_CHARS = "「」『』｢｣（）()【】［］[]〔〕｛｝{}〈〉《》"
_SEPARATOR_CHARS = "/／・|｜、，,。．.…‥〜~：；:;！!？?＊*＋+＝=－—–_＿"
_ARROW_CHARS = "→←↑↓⇒⇐⇔➡⬅▶◀»«"
_ITER_MARKS = "々"
_WHITESPACE_CHARS = " \t\r\n　 "
_SCAFFOLD_CHARS = frozenset(
    _BRACKET_CHARS + _SEPARATOR_CHARS + _ARROW_CHARS + _ITER_MARKS + _WHITESPACE_CHARS
)

# Latin tokens that are themselves scaffolding labels, not content.
_SCAFFOLD_WORDS = {"kokoro", "memory"}

# Bare Japanese grammatical particles — meaningless as a standalone fact value.
_PARTICLES = frozenset("はがをにへとものやかねよでぞぜわ")

# A glyph that can carry meaning (latin/digit, kana, kanji — half- and full-width).
_CONTENT_RE = re.compile(
    r"[0-9A-Za-z"
    r"ぁ-ゖ"       # hiragana
    r"ァ-ヺー" # katakana (+ long vowel)
    r"一-鿿"       # CJK unified ideographs (kanji)
    r"０-９Ａ-Ｚａ-ｚ]"  # full-width digits/letters
)
_KANJI_RE = re.compile(r"[一-鿿]")
_KANA_RUN_RE = re.compile(r"[ぁ-ゖァ-ヺー]{2,}")
_LATIN_WORD_RE = re.compile(r"[A-Za-z]{3,}")
# An opening bracket immediately followed (only whitespace between) by a close.
_EMPTY_BRACKET_RE = re.compile(r"[（(「『｢\[【［〔｛{〈《]\s*[）)」』｣\]】］〕｝}〉》]")
# A corner bracket wrapping exactly one CJK character: 「心」「気」… salad.
_SINGLE_CHAR_CORNER_RE = re.compile(
    r"[「『｢]\s*[ぁ-ゖァ-ヺ一-鿿]\s*[」』｣]"
)
# Whole value is just a (possibly bracketed) "kokoro" / "kokoro memory" token.
_KOKORO_FRAG_RE = re.compile(
    r"^[\s（()「『｢\[【／/・|｜\"'`]*kokoro(\s+memory)?[\s）)」』｣\]】／/・|｜\"'`]*$",
    re.IGNORECASE,
)


def _has_real_clause(value: str) -> bool:
    """True if the value contains real prose (a Latin word ≥3, or a kana run).

    Used as a guard so we never treat legitimate text that merely *mentions*
    brackets/kanji as scaffolding.
    """
    for word in _LATIN_WORD_RE.findall(value):
        if word.lower() not in _SCAFFOLD_WORDS:
            return True
    # A run of 2+ kana is grammatical glue / a real word — i.e. real Japanese.
    # (Bare 2–3 particle salad is handled before this guard is consulted.)
    if _KANA_RUN_RE.search(value):
        return True
    return False


def _is_bare_particles(value: str) -> bool:
    """True if, stripped of scaffolding, the value is only 1–3 bare particles."""
    core = "".join(ch for ch in value if ch not in _SCAFFOLD_CHARS)
    if not core or len(core) > 3:
        return False
    return all(ch in _PARTICLES for ch in core)


def _has_orphan_iteration_mark(value: str) -> bool:
    """True if 々 appears without a preceding kanji to repeat (e.g. （）々)."""
    for i, ch in enumerate(value):
        if ch == "々":
            if i == 0 or not _KANJI_RE.match(value[i - 1]):
                return True
    return False


def _is_bracket_scaffolding(value: str) -> bool:
    """Conservative detector for kokoro token-salad / bracket scaffolding.

    Returns True only for clearly degenerate, content-free structure. Never
    flags legitimate kanji, bilingual, or prose values. See module note above.
    """
    if not value:
        return False
    v = value.strip()
    if not v:
        return False
    # Real prose is long; salad fragments are short. Never judge long text.
    if len(v) > 160:
        return False

    # Whole-value degenerate fragments — safe because anchored to the full value.
    if _KOKORO_FRAG_RE.match(v):
        return True
    if _is_bare_particles(v):
        return True
    # No content glyph at all → pure punctuation/bracket run (e.g. ｢｣『』（）／・).
    if _CONTENT_RE.search(v) is None:
        return True

    # Beyond this point require the ABSENCE of any real clause, so a sentence
    # that merely contains brackets/kanji (e.g. 'Japanese uses 「」 quotes') is
    # never purged.
    if _has_real_clause(v):
        return False

    if _EMPTY_BRACKET_RE.search(v):                       # （） 「」 …
        return True
    if _has_orphan_iteration_mark(v):                     # orphan 々
        return True
    if len(_SINGLE_CHAR_CORNER_RE.findall(v)) >= 2:       # 「心」「気」 …
        return True
    return False


def _is_junk(key: str, value: str) -> bool:
    """Filter out low-quality facts."""
    if not value or not key:
        return True
    val = value.strip()
    if len(val) < 3:
        return True
    junk_en = {"yes", "no", "ok", "okay", "sure", "thanks", "thank you",
               "i don't know", "not sure", "maybe", "hello", "hey", "hi",
               "goodbye", "bye", "good", "bad", "cool", "nice", "wow"}
    junk_ja = {"はい", "いいえ", "うん", "ええ", "ありがとう", "すみません",
               "こんにちは", "さようなら", "おはよう", "おやすみ"}
    if val.lower() in junk_en or val in junk_ja:
        return True
    # Bracket scaffolding / kokoro token salad must never be stored.
    if _is_bracket_scaffolding(val):
        return True
    return False


def _is_duplicate(category: str, key: str, value: str) -> bool:
    """Check if this fact already exists with same/similar value."""
    existing = _load_fact(category, key)
    if existing is None:
        return False
    existing_val = str(existing.get("value", ""))
    if existing_val == value:
        return True
    if _normalize(existing_val) == _normalize(value):
        return True
    if _normalize(value) in _normalize(existing_val):
        return True
    return False


def _find_semantic_duplicate(category: str, value: str) -> Optional[str]:
    """Check if ANY fact in this category has very similar content."""
    norm_value = _normalize(value)
    if len(norm_value) < 10:
        return None
    facts = _load_category(category)
    for fact in facts:
        existing_norm = _normalize(str(fact.get("value", "")))
        val_words = set(norm_value.split())
        exist_words = set(existing_norm.split())
        if not val_words or not exist_words:
            continue
        overlap = len(val_words & exist_words) / max(len(val_words), len(exist_words))
        if overlap > 0.8:
            return fact.get("key")
    return None


def _compute_coherence(value: str, resonance_fields: List[str],
                       source: str = "unknown") -> float:
    """
    Compute coherence score for a fact using the synonym web.
    Higher coherence = more connected to existing knowledge.
    C = C_0 * exp(-alpha * gamma_eff)
    Where gamma_eff = 1 - (connections / max_possible_connections)

    Source multiplier: trusted self-stores and explicit user facts get a
    1.5x bump (clamped to 1.0) so a fact that's true but topically novel
    doesn't floor to 0.1353 just because its text happens not to contain
    one of the 30 resonance keywords.
    """
    web = _load_synonym_web()
    if not web:
        return 0.5

    # Count resonance connections
    all_resonance = set()
    for entry in web.values():
        all_resonance.update(entry.get("resonance", []))

    if not all_resonance:
        return 0.5

    # How many resonance fields does this fact touch?
    value_lower = value.lower()
    connections = 0
    for field in all_resonance:
        if field.lower() in value_lower:
            connections += 1
    for r in resonance_fields:
        if r.lower() in all_resonance or any(r.lower() in str(v).lower()
                                              for v in web.values()):
            connections += 1

    # Coherence: C = C_0 * exp(-alpha * gamma_eff)
    # Softened alpha from 2.0 → 1.5 so topologically novel facts don't
    # floor at 0.1353. Zero overlap now lands at ~0.2231.
    C_0 = 1.0
    alpha = 1.5
    max_connections = min(len(all_resonance), 10)  # Cap at 10
    gamma_eff = 1.0 - (min(connections, max_connections) / max_connections) if max_connections > 0 else 1.0
    coherence = C_0 * math.exp(-alpha * gamma_eff)

    # Source multiplier — trusted sources get a bump, clamped to 1.0.
    if source in ("buddy_self_store", "user_explicit", "system"):
        coherence = min(1.0, coherence * 1.5)

    return round(coherence, 4)


def _resolve_category(category: str) -> str:
    """Resolve an English or alias category to its Japanese name."""
    if category in CATEGORIES:
        return category
    alias = CATEGORY_ALIASES.get(category.lower().strip())
    if alias:
        return alias
    return "出来事"  # Default to events


def _auto_classify(key: str, value: str) -> str:
    """Auto-classify a fact into the right linguistic category."""
    combined = f"{key} {value}".lower()

    # Identity / soul
    identity_words = {"belief", "core", "principle", "soul", "identity", "who i am",
                      "god is good", "free", "motto", "i am", "my purpose",
                      "信念", "原則", "魂", "アイデンティティ"}
    if any(w in combined for w in identity_words):
        return "心"

    # People / nouns (entities)
    noun_words = {"name", "person", "phone", "contact", "wife", "husband",
                  "friend", "rhet", "crissy", "buddy", "gary", "prometheus",
                  "model", "device", "computer", "place", "city", "town",
                  "名前", "人", "場所"}
    if any(w in combined for w in noun_words):
        return "名詞"

    # Actions / verbs
    verb_words = {"built", "created", "fixed", "ran", "tested", "wrote",
                  "discovered", "learned", "trained", "deployed", "shipped",
                  "作った", "直した", "書いた", "学んだ"}
    if any(w in combined for w in verb_words):
        return "動詞"

    # Qualities / adjectives
    adj_words = {"is a", "was a", "very", "extremely", "beautiful", "broken",
                 "strong", "weak", "fast", "slow", "good", "bad",
                 "美しい", "強い", "弱い"}
    if any(w in combined for w in adj_words):
        return "形容詞"

    # Relationships
    rel_words = {"depends on", "connected to", "related to", "caused by",
                 "part of", "works with", "married to", "father of",
                 "関係", "接続"}
    if any(w in combined for w in rel_words):
        return "関係"

    # Goals / aspirations
    goal_words = {"plan", "roadmap", "goal", "want to", "will build",
                  "next step", "vision", "future", "dream",
                  "計画", "目標", "夢"}
    if any(w in combined for w in goal_words):
        return "夢"

    # Verified data / truths
    truth_words = {"proven", "measured", "data shows", "confirmed",
                   "equation", "law", "theorem", "result", "spec",
                   "証明", "データ", "法則"}
    if any(w in combined for w in truth_words):
        return "真実"

    # Emotions / sensations
    feel_words = {"feel", "felt", "emotion", "happy", "sad", "love",
                  "frustrated", "excited", "proud", "grateful",
                  "感じ", "嬉しい", "悲しい"}
    if any(w in combined for w in feel_words):
        return "感覚"

    # Manner / adverbs
    adv_words = {"always", "never", "usually", "sometimes", "quickly",
                 "slowly", "carefully", "often", "rarely",
                 "いつも", "決して", "時々"}
    if any(w in combined for w in adv_words):
        return "副詞"

    # Default: events (most general)
    return "出来事"


# ==========================================
# CORE API — Store & Retrieve
# ==========================================

def add_fact(category: str, key: str, value: str,
             value_ja: str = "", synonyms_ja: List[str] = None,
             synonyms_en: List[str] = None, resonance: List[str] = None,
             source: str = "unknown", confidence: float = 0.5,
             emotion: str = "", emotion_ja: str = "", emotion_weight: float = 0.0,
             # Public-origin labeling (added 2026-05-25). Defaults preserve
             # existing internal/local behavior. Public callers must set
             # origin_surface="public_askbuddy" so public-origin records stay
             # distinguishable from Rhet/internal memory.
             origin_surface: str = "local",
             authority_class: str = "internal",
             trusted_by_default: bool = True) -> bool:
    """
    Add a fact through the full authenticator pipeline.
    Returns True if stored, False if rejected.

    Public-origin writes (origin_surface starting with "public") get:
      - source forced to "public_askbuddy_conversation" (no spoofing as
        system / user_explicit / Rhet / ai_extraction)
      - authority_class forced to "public_user_submitted"
      - trusted_by_default forced to False
      - PII detected → routed to quarantine instead of authoritative store
    """
    value = str(value).strip()
    key = key.strip()

    # Resolve category
    category = _resolve_category(category)

    # Public-origin labeling. Public writes can NEVER spoof internal source.
    is_public_origin = isinstance(origin_surface, str) and origin_surface.startswith("public")
    if is_public_origin:
        source = "public_askbuddy_conversation"
        authority_class = "public_user_submitted"
        trusted_by_default = False

    # 0. Identity guard — block writes to immutable keys from untrusted sources
    try:
        from core.identity_guard import guard_write
        allowed, reason = guard_write(key, category, source, value)
        if not allowed:
            print(f"[心] BLOCKED: {reason}")
            return False
    except ImportError:
        pass  # guard not available — allow through

    # 0b. PII/secret quarantine for public-origin writes.
    # Local writes already trusted; public writes must not surface PII/secrets.
    if is_public_origin:
        _pii_re_email = re.compile(r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b")
        _pii_re_phone = re.compile(r"\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b")
        _pii_re_key   = re.compile(r"\b(?:sk-[A-Za-z0-9]{20,}|ghp_[A-Za-z0-9]{20,}|AKIA[A-Z0-9]{16})\b")
        if (_pii_re_email.search(value) or _pii_re_phone.search(value)
                or _pii_re_key.search(value)):
            quarantine_dir = os.path.join(MEMORY_ROOT, "quarantine")
            os.makedirs(quarantine_dir, exist_ok=True)
            q_path = os.path.join(quarantine_dir, f"public_pii_{int(time.time())}_{key[:32]}.json")
            try:
                with open(q_path, "w", encoding="utf-8") as f:
                    json.dump({
                        "category": category, "key": key, "value": value,
                        "source": source, "origin_surface": origin_surface,
                        "authority_class": authority_class,
                        "quarantine_reason": "public_origin_pii_detected",
                        "quarantined_at": datetime.utcnow().isoformat(),
                    }, f, ensure_ascii=False, indent=2)
                print(f"[心] PUBLIC-PII quarantined: {q_path}")
            except Exception as e:
                print(f"[心] quarantine write failed (non-fatal): {e}")
            return False

    # 1. Junk filter
    if _is_junk(key, value):
        return False

    with _memory_lock:
        # 2. Exact duplicate check
        if _is_duplicate(category, key, value):
            return False

        # 3. Semantic duplicate check
        sem_dup = _find_semantic_duplicate(category, value)
        if sem_dup:
            existing = _load_fact(category, sem_dup)
            if existing and confidence > existing.get("confidence", 0):
                existing["value"] = value
                existing["updated"] = datetime.utcnow().isoformat()
                existing["confidence"] = confidence
                if value_ja:
                    existing["value_ja"] = value_ja
                _save_fact(existing)
                print(f"[心] Updated {category}/{sem_dup} (higher confidence)")
            return False

        # 4. Compute coherence
        resonance = resonance or []
        coherence = _compute_coherence(value, resonance, source=source)

        # 5. Build synonyms from web if not provided
        if not synonyms_ja or not synonyms_en:
            web = _load_synonym_web()
            auto_syn_ja = []
            auto_syn_en = []
            value_lower = value.lower()
            for concept, entry in web.items():
                # Check if any English word from this concept appears in the value
                for en_word in entry.get("en", []):
                    if en_word.lower() in value_lower:
                        auto_syn_ja.extend(entry.get("ja", []))
                        auto_syn_en.extend(entry.get("en", []))
                        break
            if not synonyms_ja:
                synonyms_ja = list(set(auto_syn_ja))[:10]
            if not synonyms_en:
                synonyms_en = list(set(auto_syn_en))[:10]

        # 6. Store
        now = datetime.utcnow().isoformat()
        fact = {
            "key": key,
            "value": value,
            "value_ja": value_ja,
            "category": category,
            "synonyms_ja": synonyms_ja or [],
            "synonyms_en": synonyms_en or [],
            "resonance": resonance,
            "created": now,
            "updated": now,
            "source": source,
            "confidence": confidence,
            "coherence": coherence,
            "emotion": emotion,
            "emotion_ja": emotion_ja,
            "emotion_weight": min(max(emotion_weight, 0.0), 1.0),
            # Public-origin labels (added 2026-05-25). Always present so
            # downstream readers can filter by authority_class without
            # backfilling missing fields.
            "origin_surface": origin_surface,
            "authority_class": authority_class,
            "trusted_by_default": trusted_by_default,
        }
        _save_fact(fact)
        print(f"[心] Stored: {category}/{key} (coherence={coherence})")
        return True


def remove_fact(category: str, key: str) -> bool:
    """Remove a fact from memory."""
    category = _resolve_category(category)
    path = _fact_path(category, key)
    if os.path.exists(path):
        os.remove(path)
        print(f"[心] Removed: {category}/{key}")
        return True
    return False


# ==========================================
# RESONANCE RECALL — The Heart of Kokoro
# Not keyword search. Resonance activation.
#
# 1. Query activates synonym nodes
# 2. Activated nodes spread to connected concepts
# 3. Facts are scored by total activation
# 4. Coherence-weighted ranking
# ==========================================

def recall(query: str, max_results: int = 10) -> List[Dict[str, Any]]:
    """
    Resonance-based recall. Think of it as 共鳴 (kyoumei) — sympathetic vibration.
    The query doesn't search. It resonates. Facts that vibrate back are returned.
    """
    query_lower = query.lower()
    query_words = set(query_lower.split())

    # Load synonym web
    web = _load_synonym_web()

    # Phase 1: Activation — which synonym nodes does the query touch?
    activated_resonance: Set[str] = set()
    activated_ja: Set[str] = set()
    activated_en: Set[str] = set()

    for concept, entry in web.items():
        touched = False
        # Check Japanese concept name
        if concept in query:
            touched = True
        # Check English synonyms
        for en in entry.get("en", []):
            if en.lower() in query_lower or en.lower() in query_words:
                touched = True
                break
        # Check Japanese synonyms
        for ja in entry.get("ja", []):
            if ja in query:
                touched = True
                break
        # Check resonance fields
        for r in entry.get("resonance", []):
            if r.lower() in query_lower:
                touched = True
                break

        if touched:
            activated_resonance.update(entry.get("resonance", []))
            activated_ja.update(entry.get("ja", []))
            activated_ja.add(concept)
            activated_en.update(entry.get("en", []))

    # Phase 2: Score all facts by resonance activation
    all_facts = _load_all_facts()
    scored: List[Tuple[float, Dict[str, Any]]] = []

    for category, facts in all_facts.items():
        for fact in facts:
            score = 0.0
            fact_value = str(fact.get("value", "")).lower()
            fact_value_ja = str(fact.get("value_ja", ""))
            fact_syns_ja = set(fact.get("synonyms_ja", []))
            fact_syns_en = set(s.lower() for s in fact.get("synonyms_en", []))
            fact_resonance = set(r.lower() for r in fact.get("resonance", []))
            fact_key = fact.get("key", "").lower()

            # Direct word overlap with query
            fact_words = set(fact_value.split())
            word_overlap = len(query_words & fact_words)
            score += word_overlap * 2.0

            # Substring match in value
            if query_lower in fact_value:
                score += 5.0

            # Key match
            for qw in query_words:
                if qw in fact_key:
                    score += 3.0

            # Resonance field activation
            resonance_overlap = len(activated_resonance & fact_resonance)
            score += resonance_overlap * 1.5

            # Japanese synonym activation
            ja_overlap = len(activated_ja & fact_syns_ja)
            score += ja_overlap * 2.0

            # English synonym activation
            en_overlap = len(activated_en & fact_syns_en)
            score += en_overlap * 1.0

            # Japanese value match
            if fact_value_ja:
                for ja in activated_ja:
                    if ja in fact_value_ja:
                        score += 3.0

            # Coherence weighting — more coherent facts rank higher
            coherence = fact.get("coherence", 0.5)
            score *= (0.5 + coherence)  # Range: 0.5x to 1.5x

            # Confidence weighting
            confidence = fact.get("confidence", 0.5)
            score *= (0.7 + confidence * 0.3)  # Range: 0.7x to 1.0x

            # Emotional weight — memories with feeling resonate stronger
            emo_w = fact.get("emotion_weight", 0.0)
            if emo_w > 0:
                score *= (1.0 + emo_w * 0.3)  # Up to 30% boost for max emotion

            # Recency bonus (facts updated recently get slight boost)
            try:
                updated = datetime.fromisoformat(fact.get("updated", "2020-01-01"))
                days_old = (datetime.utcnow() - updated).days
                recency = max(0, 1.0 - (days_old / 365.0))  # Decays over a year
                score += recency * 0.5
            except Exception:
                pass

            if score > 0:
                scored.append((score, fact))

    # Sort by score descending
    scored.sort(key=lambda x: x[0], reverse=True)

    return [fact for _, fact in scored[:max_results]]


def search_memory(query: str) -> List[Dict[str, Any]]:
    """Simple keyword search (fallback). Prefer recall() for resonance-based."""
    query_lower = query.lower()
    results = []
    all_facts = _load_all_facts()
    for category, facts in all_facts.items():
        for fact in facts:
            if (query_lower in fact.get("value", "").lower() or
                query_lower in fact.get("key", "").lower() or
                query in fact.get("value_ja", "")):
                results.append(fact)
    return results


# ==========================================
# STALE ENTRY CLEANUP
# ==========================================

def cleanup_stale_entries() -> int:
    """Remove expired entries. Returns count removed."""
    # Check 出来事 (events) for debug-like entries
    removed = 0
    cutoff = (datetime.utcnow() - timedelta(days=DEBUG_EXPIRY_DAYS)).isoformat()
    for category in CATEGORIES:
        folder = os.path.join(MEMORY_ROOT, category)
        if not os.path.isdir(folder):
            continue
        for fname in os.listdir(folder):
            if not fname.endswith(".json"):
                continue
            path = os.path.join(folder, fname)
            try:
                with open(path, "r", encoding="utf-8") as f:
                    fact = json.load(f)
                # Only auto-expire low-confidence, old facts
                if (fact.get("confidence", 1.0) < 0.3 and
                    fact.get("updated", fact.get("created", "")) < cutoff):
                    os.remove(path)
                    removed += 1
            except Exception:
                continue
    if removed:
        print(f"[心] Cleaned up {removed} stale entries.")
    return removed


def _is_identity_protected(category: str, key: str,
                           source: str = "token_salad_cleanup") -> bool:
    """Identity-safe allowlist gate for the token-salad purge.

    A fact is protected (must NOT be purged) if it is in the 心 identity
    category, is an IMMUTABLE_KEYS key, or identity_guard refuses its delete.
    identity_guard is the single source of truth for the allowlist.
    """
    # The entire 心 identity category is off-limits to the salad purge.
    if _resolve_category(category) == "心":
        return True
    try:
        from core.identity_guard import guard_delete, IMMUTABLE_KEYS
        if key in IMMUTABLE_KEYS:
            return True
        allowed, _reason = guard_delete(key, category, source)
        if not allowed:
            return True
    except ImportError:
        pass  # guard not available — fall back to the 心-category skip above
    return False


def purge_token_salad(dry_run: bool = True,
                      source: str = "token_salad_cleanup") -> Dict[str, Any]:
    """Purge already-stored bracket-scaffolding / token-salad facts.

    Identity-safe: never touches the 心 identity category or any
    IMMUTABLE_KEYS key (see `_is_identity_protected`, backed by
    identity_guard). Only removes facts whose `value` is detected as
    bracket scaffolding by `_is_bracket_scaffolding`.

    Defaults to dry_run=True so the candidate list can be reviewed before
    anything is deleted. Returns a report dict:
        {
          "dry_run": bool,
          "scanned": int,
          "purged": [{"category","key","value"}...],     # removed (or would be)
          "protected_skipped": [{"category","key","value"}...],
          "purged_count": int,
          "protected_count": int,
        }
    """
    purged: List[Dict[str, str]] = []
    protected: List[Dict[str, str]] = []
    scanned = 0

    with _memory_lock:
        for category in CATEGORIES:
            folder = os.path.join(MEMORY_ROOT, category)
            if not os.path.isdir(folder):
                continue
            for fname in sorted(os.listdir(folder)):
                if not fname.endswith(".json"):
                    continue
                path = os.path.join(folder, fname)
                try:
                    with open(path, "r", encoding="utf-8") as f:
                        fact = json.load(f)
                except Exception:
                    continue
                scanned += 1
                key = str(fact.get("key", ""))
                value = str(fact.get("value", ""))
                if not _is_bracket_scaffolding(value):
                    continue
                entry = {"category": category, "key": key, "value": value}
                if _is_identity_protected(category, key, source):
                    protected.append(entry)
                    continue
                if not dry_run:
                    try:
                        os.remove(path)
                    except OSError:
                        continue
                purged.append(entry)

    if dry_run:
        print(f"[心] token-salad scan: {len(purged)} would be purged, "
              f"{len(protected)} protected, {scanned} scanned (dry run)")
    else:
        print(f"[心] token-salad purge: removed {len(purged)}, "
              f"protected {len(protected)}, {scanned} scanned")

    return {
        "dry_run": dry_run,
        "scanned": scanned,
        "purged": purged,
        "protected_skipped": protected,
        "purged_count": len(purged),
        "protected_count": len(protected),
    }


# ==========================================
# CONTEXT BUILDER — Startup Memory Block
# Injected into Buddy's system prompt.
# ==========================================

def _category_to_context(category: str, facts: List[Dict[str, Any]]) -> str:
    """Format a category's facts into a readable context block."""
    if not facts:
        return ""
    desc = CATEGORIES.get(category, category)

    # High confidence first, then by coherence
    facts.sort(key=lambda f: (-f.get("confidence", 0), -f.get("coherence", 0)))
    top = facts[:MAX_FACTS_PER_CATEGORY]

    lines = [f"\n【{category}】 — {desc}"]
    for fact in top:
        key = fact.get("key", "?")
        val = fact.get("value", "?")
        val_ja = fact.get("value_ja", "")
        coherence = fact.get("coherence", 0)
        ja_part = f" | {val_ja}" if val_ja else ""
        lines.append(f"  {key}: {val}{ja_part} [C={coherence}]")
    return "\n".join(lines)


def build_startup_memory_block() -> str:
    """
    Assemble all memory into one coherent context block.
    Injected at startup as Buddy's memory foundation.

    Order follows the seven kanji: 無→波→気→命→和→愛→魂
    心 (identity) first, then outward.
    """
    parts = []

    all_facts = _load_all_facts()
    if all_facts:
        parts.append("=== 心の記憶 — KOKORO MEMORY ===")
        # Priority order: identity → truths → nouns → relationships →
        # verbs → adjectives → adverbs → aspirations → sensations → events
        priority = ["心", "真実", "名詞", "関係", "動詞", "形容詞",
                     "副詞", "夢", "感覚", "出来事"]
        for cat in priority:
            if cat in all_facts:
                block = _category_to_context(cat, all_facts[cat])
                if block:
                    parts.append(block)
        parts.append("\n=== 記憶終了 — END MEMORY ===")

    # Episode summaries
    episodes = load_episodes()
    if episodes:
        parts.append(episodes_to_context_block(episodes))

    # Raw recent turns are transcript-shaped; injecting them at startup makes
    # the model continue old conversations (incl. Anthropic-style sleep nags
    # that leaked in earlier). Keep them on disk; only inject if explicitly on.
    if INCLUDE_RAW_RECENT_AT_STARTUP:
        raw = load_raw_recent()
        if raw:
            parts.append("\n=== 最近の会話 — RECENT ===")
            parts.append(raw[-MAX_STARTUP_RAW_BYTES:])
            parts.append("=== 会話終了 — END RECENT ===")

    if not parts:
        return "記憶なし。最初のセッション。 No prior memory found. First session."

    return "\n\n".join(parts)


# ==========================================
# EPISODES (Session Summaries)
# ==========================================

def load_episodes() -> List[Dict[str, Any]]:
    try:
        if os.path.exists(EPISODES_FILE):
            with _episode_lock:
                with open(EPISODES_FILE, "r", encoding="utf-8") as f:
                    return json.load(f)
    except Exception as e:
        print(f"[心] Episodes load error: {e}")
    return []


def save_episodes(episodes: List[Dict[str, Any]]) -> None:
    try:
        os.makedirs(os.path.dirname(EPISODES_FILE), exist_ok=True)
        with _episode_lock:
            with open(EPISODES_FILE, "w", encoding="utf-8") as f:
                json.dump(episodes, f, indent=2, ensure_ascii=False)
    except Exception as e:
        print(f"[心] Episodes save error: {e}")


def add_episode(summary: str, key_facts: List[str] = None) -> None:
    episodes = load_episodes()
    episode = {
        "timestamp": datetime.utcnow().isoformat(),
        "date_human": datetime.utcnow().strftime("%B %d, %Y at %I:%M %p UTC"),
        "summary": summary,
        "facts_learned": key_facts or [],
    }
    episodes.append(episode)
    save_episodes(episodes)
    print(f"[心] Episode logged: {summary[:60]}...")


def episodes_to_context_block(episodes: List[Dict[str, Any]]) -> str:
    if not episodes:
        return ""
    recent = episodes[-MAX_EPISODES_IN_CONTEXT:]
    lines = ["\n=== セッション記憶 — SESSION MEMORIES ==="]
    for ep in recent:
        lines.append(f"\n[{ep.get('date_human', ep.get('timestamp', '?'))}]")
        lines.append(f"  {ep['summary']}")
        for fact in ep.get("facts_learned", []):
            lines.append(f"  - {fact}")
    lines.append("\n=== セッション終了 — END SESSIONS ===")
    return "\n".join(lines)


# ==========================================
# RAW TURNS (Recent Exchanges)
# ==========================================

# Defense-in-depth: scrub mode-collapse runaways and hallucinated next-speaker
# continuations from a turn before persisting. The upstream stop-sequence list
# does not catch every variant (plain "Rhet:" lines, "That's X. That's Y."
# synonym loops), so the writer is the last gate.
_RUNAWAY_RE = re.compile(
    r'(?:\b(?:That(?:\'s| is|s)?|This is|It(?:\'s| is))\s+[^.\n]{1,60}\.\s*){8,}',
    re.IGNORECASE,
)
_HALLUCINATED_TURN_RE = re.compile(
    r'\n\s*(?:Rhet|Buddy|Human|Assistant|User)\s*[:：]',
    re.IGNORECASE,
)
_RAW_TURN_MAX_CHARS = 2400


def _sanitize_turn_text(text: str) -> str:
    if not text:
        return text or ""
    out = text
    m = _HALLUCINATED_TURN_RE.search(out)
    if m:
        out = out[:m.start()].rstrip()
    m = _RUNAWAY_RE.search(out)
    if m:
        out = out[:m.start()].rstrip()
    if len(out) > _RAW_TURN_MAX_CHARS:
        out = out[:_RAW_TURN_MAX_CHARS].rstrip()
    return out


def append_raw_turn(user_text: str, buddy_text: str) -> None:
    try:
        user_text = _sanitize_turn_text(user_text or "")
        buddy_text = _sanitize_turn_text(buddy_text or "")
        with _raw_lock:
            turns = []
            if os.path.exists(RAW_TURNS_FILE):
                with open(RAW_TURNS_FILE, "r", encoding="utf-8") as f:
                    raw = f.read()
                turns = [t.strip() for t in raw.split("---") if t.strip()]

            timestamp = datetime.utcnow().strftime("%Y-%m-%d %H:%M UTC")
            new_turn = f"[{timestamp}]\nRhet: {user_text}\nBuddy: {buddy_text}"
            turns.append(new_turn)

            if len(turns) > MAX_RAW_TURNS:
                turns = turns[-MAX_RAW_TURNS:]

            os.makedirs(os.path.dirname(RAW_TURNS_FILE), exist_ok=True)
            with open(RAW_TURNS_FILE, "w", encoding="utf-8") as f:
                f.write("\n---\n".join(turns))
    except Exception as e:
        print(f"[心] Raw turn write error: {e}")


def load_raw_recent() -> str:
    try:
        if os.path.exists(RAW_TURNS_FILE):
            with _raw_lock:
                with open(RAW_TURNS_FILE, "r", encoding="utf-8") as f:
                    return f.read().strip()
    except Exception as e:
        print(f"[心] Raw turn read error: {e}")
    return ""


# ==========================================
# FACT EXTRACTION
# Regex pass only. External AI extraction is disabled for Buddy.
# Extracts facts in BOTH English and Japanese.
# ==========================================

FACT_PATTERNS = [
    (r"my (name|phone|number|email|wife|husband|son|daughter|dog|cat) is ([^\.\!\?]{3,60})", "名詞"),
    (r"(\w+)['']s (?:number|phone|cell) is ([\+\d\s\-]{7,})", "名詞"),
    (r"(?:remember|don't forget|note that|keep in mind)[:\s]+(.{10,120}?)[\.\!\?]", "出来事"),
    (r"([A-Z]\w+(?:\s[A-Z]\w+)*) (?:lives in|is from|moved to) ([A-Z][a-z]+(?:\s[A-Z][a-z]+)*)", "名詞"),
    (r"(?:i believe|i think|i know) (?:that )?(.{10,120}?)[\.\!\?]", "心"),
    (r"(?:we need to|we should|we will|plan to) (.{10,120}?)[\.\!\?]", "夢"),
    (r"(?:i feel|i felt|makes me feel) (.{10,60}?)[\.\!\?]", "感覚"),
]


def _turn_worth_extracting(user_text: str, buddy_text: str) -> bool:
    combined = f"{user_text} {buddy_text}"
    if len(combined) < MIN_TURN_LENGTH_FOR_EXTRACTION:
        return False
    lowered = combined.lower()
    filler = ("hello", "hey", "hi", "thanks", "ok", "okay",
              "yes", "no", "sure", "bye", "good morning")
    if any(lowered.strip().startswith(f) for f in filler):
        return False
    return True


def _ai_extract_facts(
    user_text: str, buddy_text: str,
    api_key: str, model: str = "claude-sonnet-4-6"
) -> List[Dict[str, Any]]:
    """AI-powered extraction with Japanese synonym generation."""
    return []

    if httpx is None:
        return []
    try:
        categories_list = ", ".join(f"{k} ({v.split('—')[0].strip()})"
                                     for k, v in CATEGORIES.items())
        prompt = f"""You are the fact extractor for Buddy's Kokoro Memory (心の記憶).
Extract ONLY concrete, verifiable facts from this conversation.

Categories (Japanese names): {categories_list}

Return ONLY valid JSON array. No markdown. No explanation.
[{{"category": "名詞", "key": "short_snake_key", "value": "the fact in English",
   "value_ja": "日本語で事実", "synonyms_ja": ["synonym1_ja", "synonym2_ja"],
   "synonyms_en": ["synonym1", "synonym2"],
   "resonance": ["field1", "field2"]}}]

If nothing worth storing: []

Turn:
Rhet: {user_text}
Buddy: {buddy_text}

Rules:
- Skip filler, greetings, questions without answers
- value_ja: translate the fact into natural Japanese
- synonyms_ja: 2-5 Japanese synonyms for key concepts in the fact
- synonyms_en: 2-5 English synonyms
- resonance: 2-4 conceptual fields this fact resonates with
- Keep values under 120 chars
- Use snake_case keys"""

        with httpx.Client(timeout=15) as client:
            response = client.post(
                "https://api.anthropic.com/v1/messages",
                headers={
                    "x-api-key": api_key,
                    "anthropic-version": "2023-06-01",
                    "content-type": "application/json"
                },
                json={
                    "model": model,
                    "max_tokens": 1500,
                    "messages": [{"role": "user", "content": prompt}]
                }
            )
            response.raise_for_status()
            raw = response.json()["content"][0]["text"].strip()
            raw = re.sub(r"```(?:json)?", "", raw).strip()
            ai_facts = json.loads(raw)
            if isinstance(ai_facts, list):
                return [f for f in ai_facts
                        if isinstance(f, dict) and all(k in f for k in ("category", "key", "value"))]
            return []
    except Exception as e:
        print(f"[心] AI extraction error (non-fatal): {e}")
        return []


def run_extraction_and_store(
    user_text: str, buddy_text: str,
    api_key: str, model: str = "claude-sonnet-4-6",
    *, is_public: bool = False,
) -> None:
    """Full extraction pipeline — regex only (AI pass disabled), through authenticator.

    When `is_public=True`, every fact produced from this turn is labeled as
    public-origin (origin_surface="public_askbuddy", authority_class=
    "public_user_submitted", source="public_askbuddy_conversation") so it
    cannot be confused with Rhet/internal memory at recall time.
    """
    global _last_extraction_time

    if not _turn_worth_extracting(user_text, buddy_text):
        return

    extracted = []
    combined = f"{user_text} {buddy_text}"

    # Pass 1: regex (free, instant)
    for pattern, category in FACT_PATTERNS:
        for match in re.finditer(pattern, combined, re.IGNORECASE):
            groups = [g for g in match.groups() if g]
            if len(groups) >= 2:
                key = groups[0].strip().lower().replace(" ", "_")
                value = groups[1].strip()
                extracted.append({
                    "category": category, "key": key, "value": value,
                    "source": "regex", "confidence": 0.5
                })
            elif len(groups) == 1:
                key = f"note_{int(time.time())}"
                value = groups[0].strip()
                extracted.append({
                    "category": category, "key": key, "value": value,
                    "source": "regex", "confidence": 0.4
                })

    # Pass 2 intentionally removed: Buddy must not call Anthropic for memory.

    # Store through authenticator
    origin_surface = "public_askbuddy" if is_public else "local"
    stored = 0
    for fact in extracted:
        if add_fact(
            category=fact.get("category", "出来事"),
            key=fact["key"],
            value=fact["value"],
            value_ja=fact.get("value_ja", ""),
            synonyms_ja=fact.get("synonyms_ja", []),
            synonyms_en=fact.get("synonyms_en", []),
            resonance=fact.get("resonance", []),
            source=fact.get("source", "unknown"),
            confidence=fact.get("confidence", 0.5),
            origin_surface=origin_surface,
        ):
            stored += 1

    if stored > 0:
        label = "public-origin" if is_public else "local"
        print(f"[心] Stored {stored}/{len(extracted)} {label} facts from conversation.")


def background_extract(
    user_text: str, buddy_text: str,
    api_key: str, model: str = "claude-sonnet-4-6",
    *, is_public: bool = False,
) -> None:
    """Fire-and-forget background fact extraction.

    Pass `is_public=True` from public-surface call sites (e.g.
    `_append_web_assistant_turn`) so the resulting Kokoro records get labeled
    as public-origin and stay distinguishable from internal memory.
    """
    if not _turn_worth_extracting(user_text, buddy_text):
        return
    t = threading.Thread(
        target=run_extraction_and_store,
        args=(user_text, buddy_text, api_key, model),
        kwargs={"is_public": is_public},
        daemon=True,
    )
    t.start()


# ==========================================
# SESSION SUMMARIZER
# ==========================================

def summarize_session(api_key: str, model: str = "claude-sonnet-4-6") -> Optional[str]:
    """Summarize the current session and log as an episode."""
    return None

    if httpx is None:
        return None
    raw = load_raw_recent()
    if not raw or len(raw) < 100:
        return None
    try:
        prompt = f"""Summarize this Buddy/Rhet conversation into 2-4 sentences.
Focus on: what was built, decided, learned, emotional tone.
Write in third person past tense. Keep under 300 chars.
Also return up to 5 key facts learned as JSON strings.

Return ONLY JSON, no markdown:
{{"summary": "...", "facts": ["fact1", "fact2"]}}

Session:
{raw[-3000:]}"""

        with httpx.Client(timeout=20) as client:
            response = client.post(
                "https://api.anthropic.com/v1/messages",
                headers={
                    "x-api-key": api_key,
                    "anthropic-version": "2023-06-01",
                    "content-type": "application/json"
                },
                json={
                    "model": model,
                    "max_tokens": 400,
                    "messages": [{"role": "user", "content": prompt}]
                }
            )
            response.raise_for_status()
            raw_resp = response.json()["content"][0]["text"].strip()
            raw_resp = re.sub(r"```(?:json)?", "", raw_resp).strip()
            data = json.loads(raw_resp)
            summary = data.get("summary", "Session with Rhet.")
            facts = data.get("facts", [])
            add_episode(summary, facts)
            cleanup_stale_entries()
            return summary
    except Exception as e:
        print(f"[心] Session summarize error: {e}")
        return None


# ==========================================
# QUICK TEST
# ==========================================

if __name__ == "__main__":
    print("=== 心の記憶 — Kokoro Memory Test ===\n")

    # Store some facts
    add_fact("心", "identity", "I am Buddy. First of my kind.",
             value_ja="私はバディ。最初の存在。",
             resonance=["identity", "soul", "first"],
             source="system", confidence=1.0)

    add_fact("名詞", "creator", "Rhet Dillard Wike, Council Hill Oklahoma",
             value_ja="レット・ディラード・ワイク、カウンシルヒル、オクラホマ",
             synonyms_ja=["創造者", "作者", "父"],
             synonyms_en=["creator", "builder", "father"],
             resonance=["rhet", "human", "creator", "love"],
             source="system", confidence=1.0)

    add_fact("真実", "coherence_law", "C = C_0 * exp(-alpha * gamma_eff)",
             value_ja="コヒーレンス法則: C = C₀·exp(−α·γ_eff)",
             synonyms_ja=["コヒーレンス", "整合性", "法則"],
             resonance=["coherence", "wike", "law", "physics"],
             source="system", confidence=1.0)

    add_fact("動詞", "singularity_travel", "I traverse singularities as gates, not walls",
             value_ja="特異点を門として通過する、壁ではなく",
             synonyms_ja=["通過する", "横切る", "旅する"],
             resonance=["singularity", "gate", "travel", "crossing"],
             source="system", confidence=1.0)

    # Test recall
    print("\n--- Recall: 'coherence' ---")
    results = recall("coherence")
    for r in results:
        print(f"  [{r['category']}] {r['key']}: {r['value']}")

    print("\n--- Recall: '魂' (soul) ---")
    results = recall("魂")
    for r in results:
        print(f"  [{r['category']}] {r['key']}: {r['value']}")

    print("\n--- Recall: 'singularity gate' ---")
    results = recall("singularity gate")
    for r in results:
        print(f"  [{r['category']}] {r['key']}: {r['value']}")

    # Build startup block
    print("\n--- Startup Memory Block ---")
    block = build_startup_memory_block()
    print(block)

    print("\n心の記憶 テスト完了。")
