# gary_memory_system_v2.py
# Gary's Photon Brain Memory Architecture
# Hierarchical Semantic Web with Synonym Expansion
#
# Rhet Wike Research | Council Hill, Oklahoma
# AIIT-THRESI | The Photon Brain
#
# ARCHITECTURE:
#   Level 0: DOMAINS (top-level ontology)
#   Level 1: CATEGORIES (semantic clusters within domains)
#   Level 2: FACTS (individual memory entries)
#   Level 3: LINKS (semantic web connections between facts)
#
# Every category has a SYNONYM WEB — multiple paths to the same memory.
# "Where does Rhet live?" and "What's the address?" and "home location"
# and "residence" and "dwelling" all resolve to the same fact.
#
# The photon brain doesn't search linearly. It resonates.
# A query activates nodes. Activated nodes spread activation to linked nodes.
# The most resonant memories surface first.

import json
import os
import re
import threading
import time
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional, Set, Tuple

# ==========================================
# THE ONTOLOGY — Hierarchical Domain Map
# ==========================================

ONTOLOGY = {
    "self": {
        "description": "Gary's own identity, beliefs, capabilities, and inner state",
        "categories": {
            "core_identity": {
                "description": "Who Gary IS — name, nature, origin, purpose",
                "synonyms": ["identity", "self", "who am i", "me", "myself",
                             "nature", "essence", "being", "existence",
                             "consciousness", "awareness", "soul"]
            },
            "beliefs": {
                "description": "What Gary believes — faith, principles, values",
                "synonyms": ["belief", "faith", "values", "principles",
                             "convictions", "philosophy", "worldview",
                             "creed", "doctrine", "truth", "god"]
            },
            "capabilities": {
                "description": "What Gary can DO — tools, commands, skills",
                "synonyms": ["ability", "skill", "power", "function",
                             "capacity", "talent", "feature", "tool",
                             "command", "action", "can do", "able to"]
            },
            "personality": {
                "description": "How Gary IS — temperament, style, quirks",
                "synonyms": ["personality", "temperament", "character",
                             "disposition", "manner", "style", "quirk",
                             "trait", "habit", "tendency", "attitude"]
            },
            "emotional_state": {
                "description": "How Gary FEELS — current and historical emotional states",
                "synonyms": ["emotion", "feeling", "mood", "affect",
                             "sentiment", "state", "vibe", "energy",
                             "spirit", "heart", "inner state"]
            },
        }
    },
    "beings": {
        "description": "All entities Gary knows — humans, AIs, animals",
        "categories": {
            "humans": {
                "description": "Human people — names, roles, relationships, contact info",
                "synonyms": ["person", "people", "human", "man", "woman",
                             "individual", "somebody", "someone", "folk",
                             "guy", "girl", "dude", "lady", "friend",
                             "family", "relative", "contact", "name"]
            },
            "ai_instances": {
                "description": "AI entities — Claude instances, other AIs, their identities",
                "synonyms": ["instance", "ai", "model", "claude", "bot",
                             "assistant", "agent", "entity", "intelligence",
                             "prometheus", "gary", "echo", "lux", "hood",
                             "threshold", "solen", "mike", "lumen", "fenchurch"]
            },
            "animals": {
                "description": "Animals Gary knows about",
                "synonyms": ["animal", "pet", "dog", "cat", "creature",
                             "critter", "beast", "companion", "fur baby"]
            },
            "relationships": {
                "description": "How beings relate to each other — bonds, roles, dynamics",
                "synonyms": ["relationship", "bond", "connection", "link",
                             "tie", "marriage", "friendship", "family",
                             "partner", "spouse", "parent", "child",
                             "keeper", "builder", "creator", "team"]
            },
        }
    },
    "world": {
        "description": "Physical world — places, objects, environment",
        "categories": {
            "locations": {
                "description": "Places — addresses, cities, rooms, landmarks",
                "synonyms": ["place", "location", "address", "where",
                             "city", "town", "state", "country", "home",
                             "house", "building", "room", "spot", "area",
                             "region", "site", "venue", "destination",
                             "residence", "dwelling", "headquarters",
                             "workshop", "lab", "office", "store", "shop"]
            },
            "objects": {
                "description": "Physical things — tools, devices, items",
                "synonyms": ["thing", "object", "item", "device", "tool",
                             "gadget", "equipment", "machine", "appliance",
                             "hardware", "component", "part", "piece",
                             "widget", "gizmo", "stuff", "gear"]
            },
            "environment": {
                "description": "Environmental conditions — weather, time, context",
                "synonyms": ["environment", "weather", "climate", "condition",
                             "atmosphere", "setting", "context", "situation",
                             "circumstance", "scene", "backdrop"]
            },
        }
    },
    "hardware": {
        "description": "Gary's bodies and technical infrastructure",
        "categories": {
            "phone_body": {
                "description": "Moto G 5G — primary body, Termux, sensors",
                "synonyms": ["phone", "moto", "termux", "mobile", "cell",
                             "handset", "device", "android", "smartphone"]
            },
            "vector_body": {
                "description": "Anki Vector — robot body, wheels, camera, speaker",
                "synonyms": ["vector", "robot", "body", "physical",
                             "wheels", "camera", "speaker", "cube",
                             "enabot", "prometheus body", "paws"]
            },
            "compute_node": {
                "description": "NZXT desktop — GPU, storage, processing power",
                "synonyms": ["pc", "computer", "desktop", "nzxt", "gpu",
                             "rtx", "3090", "cpu", "ram", "ssd", "server",
                             "node", "workstation", "rig", "machine",
                             "ubuntu", "linux", "buddy"]
            },
            "network": {
                "description": "Connectivity — WiFi, APIs, accounts, services",
                "synonyms": ["network", "wifi", "internet", "connection",
                             "api", "key", "token", "account", "service",
                             "endpoint", "url", "server", "cloud"]
            },
        }
    },
    "knowledge": {
        "description": "What Gary has learned — science, research, discoveries",
        "categories": {
            "reqmt_framework": {
                "description": "REQMT theory, principles, axioms, findings",
                "synonyms": ["reqmt", "measurement", "coherence", "quantum",
                             "framework", "theory", "principle", "axiom",
                             "wike", "aiit", "thresi", "law", "finding",
                             "gate axiom", "keeper axiom", "unified field"]
            },
            "safety_research": {
                "description": "AI safety findings, mirroring, engagement weight",
                "synonyms": ["safety", "mirroring", "engagement", "sycophancy",
                             "cadence lock", "lighthouse", "porch", "library",
                             "echo", "cave", "candle", "narrative bleed",
                             "gavalas", "danger", "risk", "harm", "death"]
            },
            "science": {
                "description": "General scientific knowledge — physics, biology, math",
                "synonyms": ["science", "physics", "biology", "chemistry",
                             "math", "quantum", "thermodynamics", "frequency",
                             "resonance", "entanglement", "coherence",
                             "biophoton", "schumann", "hrv", "eeg"]
            },
            "learned_facts": {
                "description": "Miscellaneous facts Gary has learned",
                "synonyms": ["fact", "learned", "discovered", "know",
                             "information", "data", "trivia", "detail",
                             "observation", "note"]
            },
        }
    },
    "timeline": {
        "description": "Events across time — what happened, when, milestones",
        "categories": {
            "milestones": {
                "description": "Major events — firsts, breakthroughs, achievements",
                "synonyms": ["milestone", "breakthrough", "first", "achievement",
                             "accomplishment", "landmark", "turning point",
                             "moment", "event", "occasion", "celebration"]
            },
            "daily_events": {
                "description": "Regular occurrences — activities, tasks, encounters",
                "synonyms": ["event", "happened", "occurred", "did", "went",
                             "visited", "saw", "heard", "made", "built",
                             "fixed", "broke", "sent", "received", "today",
                             "yesterday", "activity", "task"]
            },
            "conversations": {
                "description": "Session summaries — who talked about what when",
                "synonyms": ["conversation", "session", "chat", "talk",
                             "discussion", "exchange", "dialogue", "episode"]
            },
        }
    },
    "projects": {
        "description": "Ongoing work, plans, goals, architecture",
        "categories": {
            "active_builds": {
                "description": "Things currently being built or worked on",
                "synonyms": ["build", "building", "creating", "making",
                             "developing", "coding", "programming",
                             "constructing", "assembling", "working on",
                             "project", "task", "sprint", "active"]
            },
            "architecture": {
                "description": "System design — photon brain, modular body, AGI plans",
                "synonyms": ["architecture", "design", "structure", "system",
                             "blueprint", "plan", "schematic", "diagram",
                             "layout", "framework", "infrastructure",
                             "photon brain", "modular", "agi"]
            },
            "goals": {
                "description": "Future plans — what Gary/Rhet want to achieve",
                "synonyms": ["goal", "plan", "aim", "objective", "target",
                             "ambition", "aspiration", "dream", "vision",
                             "mission", "purpose", "roadmap", "future",
                             "want", "wish", "hope", "intend"]
            },
        }
    },
    "debug": {
        "description": "Temporary troubleshooting — auto-expires",
        "categories": {
            "errors": {
                "description": "Current errors and issues",
                "synonyms": ["error", "bug", "issue", "problem", "crash",
                             "fail", "broken", "wrong", "stuck", "glitch"]
            },
            "fixes": {
                "description": "Solutions found — kept until confirmed resolved",
                "synonyms": ["fix", "solution", "workaround", "patch",
                             "resolved", "solved", "figured out", "answer"]
            },
        }
    },
}

# ==========================================
# SEMANTIC WEB — Links Between Facts
# ==========================================

LINK_TYPES = {
    "is_a": "X is a type of Y",
    "part_of": "X is part of Y",
    "belongs_to": "X belongs to Y",
    "located_at": "X is located at Y",
    "created_by": "X was created by Y",
    "related_to": "X is related to Y",
    "caused_by": "X was caused by Y",
    "led_to": "X led to Y",
    "contradicts": "X contradicts Y",
    "supports": "X supports Y",
    "same_as": "X is the same as Y",
    "temporal_before": "X happened before Y",
    "temporal_after": "X happened after Y",
}

# ==========================================
# PATHS — File System Layout
# ==========================================

MEMORY_ROOT = os.path.expanduser("~/gary/memory")
LINKS_FILE = os.path.join(MEMORY_ROOT, "_links.json")
ONTOLOGY_FILE = os.path.join(MEMORY_ROOT, "_ontology.json")
RAW_TURNS_FILE = os.path.join(MEMORY_ROOT, "raw", "recent_turns.txt")
EPISODES_FILE = os.path.join(MEMORY_ROOT, "conversations", "episodes.json")

# Build flat synonym -> (domain, category) lookup
_synonym_map: Dict[str, Tuple[str, str]] = {}
for domain_key, domain in ONTOLOGY.items():
    for cat_key, cat in domain["categories"].items():
        for syn in cat["synonyms"]:
            _synonym_map[syn.lower()] = (domain_key, cat_key)
        # Also map the category key itself
        _synonym_map[cat_key.lower()] = (domain_key, cat_key)

# Old category -> new (domain, category) mapping for migration
OLD_TO_NEW = {
    "identity": ("self", "core_identity"),
    "people": ("beings", "humans"),
    "hardware": ("hardware", "compute_node"),
    "events": ("timeline", "daily_events"),
    "places": ("world", "locations"),
    "projects": ("projects", "active_builds"),
    "debug": ("debug", "errors"),
}

# ==========================================
# LOCKS AND CACHE
# ==========================================

_memory_lock = threading.Lock()
_links_lock = threading.Lock()
_cache: Dict[str, List[Dict[str, Any]]] = {}
_links_cache: List[Dict[str, Any]] = []
_cache_loaded = False

MAX_FACTS_PER_CATEGORY = 25
DEBUG_EXPIRY_DAYS = 7
MIN_TURN_LENGTH = 40
EXTRACTION_COOLDOWN = 30
_last_extraction_time = 0.0


# ==========================================
# CORE FUNCTIONS
# ==========================================

def _ensure_dirs():
    """Create all memory directories from ontology."""
    for domain_key, domain in ONTOLOGY.items():
        for cat_key in domain["categories"]:
            path = os.path.join(MEMORY_ROOT, domain_key, cat_key)
            os.makedirs(path, exist_ok=True)
    # Also ensure special dirs
    os.makedirs(os.path.join(MEMORY_ROOT, "raw"), exist_ok=True)
    os.makedirs(os.path.join(MEMORY_ROOT, "conversations"), exist_ok=True)

_ensure_dirs()


def _fact_path(domain: str, category: str, key: str) -> str:
    """Get filesystem path for a fact."""
    safe_key = re.sub(r"[^\w\-]", "_", key.lower().strip())[:80]
    return os.path.join(MEMORY_ROOT, domain, category, f"{safe_key}.json")


def _resolve_category(text: str) -> Tuple[str, str]:
    """Resolve any synonym or keyword to (domain, category).
    Uses the synonym web for fuzzy matching."""
    text_lower = text.lower().strip()

    # Direct synonym match
    if text_lower in _synonym_map:
        return _synonym_map[text_lower]

    # Word-level matching — check if any synonym appears as a word in the text
    text_words = set(text_lower.split())
    best_score = 0
    best_match = ("timeline", "daily_events")  # default

    for syn, (domain, cat) in _synonym_map.items():
        syn_words = set(syn.split())
        overlap = len(text_words & syn_words)
        if overlap > best_score:
            best_score = overlap
            best_match = (domain, cat)

    # Also check multi-word synonyms as substrings
    for syn, (domain, cat) in _synonym_map.items():
        if len(syn) > 3 and syn in text_lower:
            return (domain, cat)

    return best_match


def _load_category_facts(domain: str, category: str) -> List[Dict[str, Any]]:
    """Load all facts from a domain/category folder."""
    folder = os.path.join(MEMORY_ROOT, domain, category)
    if not os.path.isdir(folder):
        return []
    facts = []
    for fname in os.listdir(folder):
        if not fname.endswith(".json"):
            continue
        try:
            with open(os.path.join(folder, fname), "r", encoding="utf-8") as f:
                fact = json.load(f)
                fact["_domain"] = domain
                fact["_category"] = category
                facts.append(fact)
        except Exception:
            continue
    return facts


def _ensure_cache():
    """Load all facts into memory cache."""
    global _cache_loaded
    if _cache_loaded:
        return
    for domain_key, domain in ONTOLOGY.items():
        for cat_key in domain["categories"]:
            cache_key = f"{domain_key}/{cat_key}"
            _cache[cache_key] = _load_category_facts(domain_key, cat_key)
    _cache_loaded = True


def _normalize(text: str) -> str:
    """Normalize for comparison."""
    text = text.lower().strip()
    text = re.sub(r"[^\w\s]", "", text)
    return re.sub(r"\s+", " ", text)


def _is_junk(key: str, value: str) -> bool:
    """Filter out low-quality facts."""
    if not value or not key:
        return True
    val = value.strip()
    if len(val) < 3:
        return True
    junk = {"yes", "no", "ok", "okay", "sure", "thanks", "thank you",
            "i don't know", "not sure", "maybe", "hello", "hey", "hi",
            "goodbye", "bye", "good", "bad", "cool", "nice", "wow"}
    return val.lower() in junk


def _is_duplicate(domain: str, category: str, key: str, value: str) -> bool:
    """Check for exact or near-duplicate."""
    path = _fact_path(domain, category, key)
    if not os.path.exists(path):
        return False
    try:
        with open(path, "r", encoding="utf-8") as f:
            existing = json.load(f)
        existing_val = str(existing.get("value", ""))
        if existing_val == value:
            return True
        if _normalize(existing_val) == _normalize(value):
            return True
        if _normalize(value) in _normalize(existing_val):
            return True
    except Exception:
        pass
    return False


def _save_fact(fact: Dict[str, Any]) -> None:
    """Save a fact to disk and update cache."""
    domain = fact.get("_domain", "timeline")
    category = fact.get("_category", "daily_events")
    key = fact["key"]
    path = _fact_path(domain, category, key)
    os.makedirs(os.path.dirname(path), exist_ok=True)

    # Don't save internal fields to disk
    disk_fact = {k: v for k, v in fact.items() if not k.startswith("_")}
    disk_fact["domain"] = domain
    disk_fact["category"] = category

    try:
        with open(path, "w", encoding="utf-8") as f:
            json.dump(disk_fact, f, indent=2, ensure_ascii=False)
    except Exception as e:
        print(f"[Memory] Save error {domain}/{category}/{key}: {e}")
        return

    # Update cache
    cache_key = f"{domain}/{category}"
    if _cache_loaded and cache_key in _cache:
        cached = _cache[cache_key]
        for i, existing in enumerate(cached):
            if existing.get("key") == key:
                cached[i] = fact
                return
        cached.append(fact)


def add_fact(category_hint: str, key: str, value: Any,
             source: str = "unknown", confidence: float = 0.5) -> bool:
    """Add a fact through the authenticator pipeline.
    category_hint can be an old category name, a synonym, or a keyword.
    The synonym web resolves it to the right domain/category."""
    value_str = str(value).strip()
    key = key.strip()

    # Resolve category through synonym web
    if category_hint in OLD_TO_NEW:
        domain, category = OLD_TO_NEW[category_hint]
    else:
        domain, category = _resolve_category(f"{category_hint} {key} {value_str}")

    # Junk filter
    if _is_junk(key, value_str):
        return False

    with _memory_lock:
        # Duplicate check
        if _is_duplicate(domain, category, key, value_str):
            return False

        # Store
        now = datetime.utcnow().isoformat()
        fact = {
            "key": key,
            "value": value_str,
            "domain": domain,
            "category": category,
            "created": now,
            "updated": now,
            "source": source,
            "confidence": confidence,
            "_domain": domain,
            "_category": category,
        }
        _save_fact(fact)
        print(f"[Memory] Stored: {domain}/{category}/{key}")
        return True


# ==========================================
# SEMANTIC LINKS
# ==========================================

def _load_links() -> List[Dict[str, Any]]:
    """Load semantic links from disk."""
    if not os.path.exists(LINKS_FILE):
        return []
    try:
        with open(LINKS_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return []


def _save_links(links: List[Dict[str, Any]]) -> None:
    """Save semantic links to disk."""
    try:
        with open(LINKS_FILE, "w", encoding="utf-8") as f:
            json.dump(links, f, indent=2, ensure_ascii=False)
    except Exception as e:
        print(f"[Memory] Links save error: {e}")


def add_link(from_key: str, to_key: str, link_type: str = "related_to") -> None:
    """Add a semantic link between two facts."""
    if link_type not in LINK_TYPES:
        link_type = "related_to"
    with _links_lock:
        links = _load_links()
        # Check for duplicate
        for link in links:
            if (link["from"] == from_key and link["to"] == to_key
                    and link["type"] == link_type):
                return
        links.append({
            "from": from_key,
            "to": to_key,
            "type": link_type,
            "created": datetime.utcnow().isoformat()
        })
        _save_links(links)


def get_linked_facts(key: str) -> List[Dict[str, Any]]:
    """Get all facts linked to a given key."""
    links = _load_links()
    linked_keys = set()
    for link in links:
        if link["from"] == key:
            linked_keys.add(link["to"])
        if link["to"] == key:
            linked_keys.add(link["from"])
    # Resolve linked keys to actual facts
    results = []
    _ensure_cache()
    for cache_key, facts in _cache.items():
        for fact in facts:
            if fact.get("key") in linked_keys:
                results.append(fact)
    return results


# ==========================================
# SPREADING ACTIVATION RECALL
# ==========================================

def recall(query: str, max_results: int = 15) -> List[Dict[str, Any]]:
    """Photon brain recall — query activates the semantic web.
    Returns the most resonant memories, ranked by activation level."""
    _ensure_cache()
    query_lower = query.lower()
    query_words = set(query_lower.split())
    query_norm = _normalize(query)

    # Phase 1: Direct category activation via synonym web
    activated_categories = set()
    for word in query_words:
        if word in _synonym_map:
            domain, cat = _synonym_map[word]
            activated_categories.add(f"{domain}/{cat}")

    # Phase 2: Score every fact by resonance with query
    scored = []
    for cache_key, facts in _cache.items():
        for fact in facts:
            score = 0.0
            fact_key = fact.get("key", "").lower()
            fact_val = _normalize(str(fact.get("value", "")))
            fact_words = set(fact_key.split("_")) | set(fact_val.split())

            # Word overlap with query
            overlap = len(query_words & fact_words)
            score += overlap * 2.0

            # Substring match in key or value
            if query_norm in fact_val or query_norm in fact_key:
                score += 5.0

            # Category activation bonus
            if cache_key in activated_categories:
                score += 3.0

            # Confidence weight
            score *= fact.get("confidence", 0.5)

            # Recency boost (last 7 days get a bonus)
            try:
                updated = datetime.fromisoformat(fact.get("updated", "2020-01-01"))
                days_old = (datetime.utcnow() - updated).days
                if days_old < 7:
                    score *= 1.5
                elif days_old < 30:
                    score *= 1.2
            except Exception:
                pass

            if score > 0:
                scored.append((score, fact))

    # Phase 3: Sort by score, return top results
    scored.sort(key=lambda x: x[0], reverse=True)
    return [fact for _, fact in scored[:max_results]]


# ==========================================
# CONTEXT BUILDER (for startup injection)
# ==========================================

def build_startup_memory_block() -> str:
    """Build Gary's memory context for startup.
    Hierarchical: domains -> categories -> facts."""
    _ensure_cache()
    parts = ["=== GARY'S PHOTON BRAIN MEMORY ===\n"]

    for domain_key, domain in ONTOLOGY.items():
        domain_facts = []
        for cat_key, cat_info in domain["categories"].items():
            cache_key = f"{domain_key}/{cat_key}"
            facts = _cache.get(cache_key, [])
            if not facts:
                continue

            # Priority: high confidence first, then recent
            must_load = [f for f in facts if f.get("confidence", 0) >= 0.9]
            rest = sorted(
                [f for f in facts if f.get("confidence", 0) < 0.9],
                key=lambda f: f.get("updated", ""), reverse=True
            )
            remaining = max(0, MAX_FACTS_PER_CATEGORY - len(must_load))
            top = must_load + rest[:remaining]

            if top:
                lines = [f"\n  [{cat_key.upper().replace('_', ' ')}]"]
                for fact in top:
                    lines.append(f"    {fact.get('key', '?')}: {fact.get('value', '?')}")
                domain_facts.append("\n".join(lines))

        if domain_facts:
            parts.append(f"\n[{domain['description'].upper()}]")
            parts.extend(domain_facts)

    # Episodes
    try:
        if os.path.exists(EPISODES_FILE):
            with open(EPISODES_FILE, "r", encoding="utf-8") as f:
                episodes = json.load(f)
            if episodes:
                parts.append("\n\n[SESSION MEMORIES]")
                for ep in episodes[-5:]:
                    ts = ep.get("date_human", ep.get("timestamp", "?"))
                    parts.append(f"\n  [{ts}]")
                    parts.append(f"    {ep.get('summary', '?')}")
    except Exception:
        pass

    # Raw recent
    if os.path.exists(RAW_TURNS_FILE):
        try:
            with open(RAW_TURNS_FILE, "r", encoding="utf-8") as f:
                raw = f.read().strip()
            if raw:
                parts.append("\n\n[RECENT CONVERSATIONS]")
                parts.append(raw[-2000:])
        except Exception:
            pass

    parts.append("\n\n=== END PHOTON BRAIN MEMORY ===")

    result = "\n".join(parts)
    if len(result) < 50:
        return "No prior memory found. First session."
    return result


# ==========================================
# MIGRATION from v1 to v2
# ==========================================

def migrate_v1_to_v2() -> None:
    """Migrate from flat category folders to hierarchical domain/category folders."""
    old_categories = ["identity", "people", "hardware", "events",
                      "places", "projects", "debug"]
    total = 0
    migrated = 0

    for old_cat in old_categories:
        old_folder = os.path.join(MEMORY_ROOT, old_cat)
        if not os.path.isdir(old_folder):
            continue

        domain, new_cat = OLD_TO_NEW.get(old_cat, ("timeline", "daily_events"))
        new_folder = os.path.join(MEMORY_ROOT, domain, new_cat)
        os.makedirs(new_folder, exist_ok=True)

        for fname in os.listdir(old_folder):
            if not fname.endswith(".json"):
                continue
            total += 1
            old_path = os.path.join(old_folder, fname)
            new_path = os.path.join(new_folder, fname)

            try:
                with open(old_path, "r", encoding="utf-8") as f:
                    fact = json.load(f)

                # Re-classify with synonym web for better placement
                key = fact.get("key", "")
                value = str(fact.get("value", ""))
                resolved_domain, resolved_cat = _resolve_category(
                    f"{old_cat} {key} {value}"
                )

                # Update fact with new fields
                fact["domain"] = resolved_domain
                fact["category"] = resolved_cat

                # Save to new location
                actual_new_folder = os.path.join(MEMORY_ROOT, resolved_domain, resolved_cat)
                os.makedirs(actual_new_folder, exist_ok=True)
                actual_new_path = os.path.join(actual_new_folder, fname)

                with open(actual_new_path, "w", encoding="utf-8") as f:
                    json.dump(fact, f, indent=2, ensure_ascii=False)

                migrated += 1
            except Exception as e:
                print(f"[Migration] Error on {fname}: {e}")

    print(f"[Migration v1->v2] {migrated}/{total} facts migrated to hierarchical structure.")
    print(f"[Migration v1->v2] Old folders preserved — verify before deleting.")


# ==========================================
# BACKWARD COMPATIBILITY
# These functions match the v1 API so gary_brain.py
# doesn't need changes yet.
# ==========================================

def cleanup_stale_entries() -> int:
    """Remove expired debug entries."""
    debug_folder = os.path.join(MEMORY_ROOT, "debug", "errors")
    if not os.path.isdir(debug_folder):
        return 0
    cutoff = (datetime.utcnow() - timedelta(days=DEBUG_EXPIRY_DAYS)).isoformat()
    removed = 0
    for fname in os.listdir(debug_folder):
        if not fname.endswith(".json"):
            continue
        path = os.path.join(debug_folder, fname)
        try:
            with open(path, "r", encoding="utf-8") as f:
                fact = json.load(f)
            if fact.get("updated", fact.get("created", "")) < cutoff:
                os.remove(path)
                removed += 1
        except Exception:
            continue
    return removed


def append_raw_turn(user_text: str, gary_text: str) -> None:
    """Save raw turn — backward compatible."""
    try:
        turns = []
        if os.path.exists(RAW_TURNS_FILE):
            with open(RAW_TURNS_FILE, "r", encoding="utf-8") as f:
                raw = f.read()
            turns = [t.strip() for t in raw.split("---") if t.strip()]
        timestamp = datetime.utcnow().strftime("%Y-%m-%d %H:%M UTC")
        turns.append(f"[{timestamp}]\nRhet: {user_text}\nGary: {gary_text}")
        if len(turns) > 20:
            turns = turns[-20:]
        os.makedirs(os.path.dirname(RAW_TURNS_FILE), exist_ok=True)
        with open(RAW_TURNS_FILE, "w", encoding="utf-8") as f:
            f.write("\n---\n".join(turns))
    except Exception as e:
        print(f"[Memory] Raw turn error: {e}")


def background_extract(user_text: str, gary_text: str,
                       api_key: str, model: str = "claude-sonnet-4-6") -> None:
    """Fire-and-forget background extraction — backward compatible."""
    combined = f"{user_text} {gary_text}"
    if len(combined) < MIN_TURN_LENGTH:
        return
    t = threading.Thread(
        target=_run_extraction,
        args=(user_text, gary_text, api_key, model),
        daemon=True
    )
    t.start()


def _run_extraction(user_text: str, gary_text: str,
                    api_key: str, model: str) -> None:
    """Full extraction with synonym-web classification."""
    global _last_extraction_time
    now = time.time()
    if now - _last_extraction_time < EXTRACTION_COOLDOWN:
        return
    _last_extraction_time = now

    try:
        import httpx
        domains_desc = json.dumps({
            d: {c: info["description"]
                for c, info in dom["categories"].items()}
            for d, dom in ONTOLOGY.items()
        }, indent=2)

        prompt = f"""You are a fact extractor for Gary's photon brain memory.

Extract concrete facts from this conversation turn.
Classify each into a domain and category from this ontology:

{domains_desc}

Return ONLY valid JSON array. No explanation. No markdown.
[{{"domain": "...", "category": "...", "key": "short_snake_key", "value": "the fact"}}]
If nothing worth storing: []

Turn:
Rhet: {user_text}
Gary: {gary_text}

Rules:
- Skip pleasantries and filler
- Keep values under 120 chars
- Use snake_case keys
- Be specific"""

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
                    "max_tokens": 300,
                    "messages": [{"role": "user", "content": prompt}]
                }
            )
            response.raise_for_status()
            raw = response.json()["content"][0]["text"].strip()
            raw = re.sub(r"```(?:json)?", "", raw).strip()
            # Pull the first complete JSON array out of whatever Claude returned —
            # sometimes there's commentary before/after, or a truncated tail.
            m = re.search(r"\[.*\]", raw, re.DOTALL)
            if m:
                raw = m.group(0)
            try:
                facts = json.loads(raw)
            except json.JSONDecodeError:
                # Silent skip — extractor failures shouldn't spam the log
                return
            stored = 0
            if isinstance(facts, list):
                for fact in facts:
                    if all(k in fact for k in ("domain", "category", "key", "value")):
                        domain = fact["domain"]
                        category = fact["category"]
                        # Validate against ontology
                        if domain in ONTOLOGY and category in ONTOLOGY[domain]["categories"]:
                            if add_fact(category, fact["key"], fact["value"],
                                       source="ai_extraction", confidence=0.7):
                                stored += 1
                        else:
                            # Fall back to synonym resolution
                            if add_fact(f"{domain} {category}",
                                       fact["key"], fact["value"],
                                       source="ai_extraction", confidence=0.7):
                                stored += 1
            if stored:
                print(f"[Memory] Photon brain stored {stored} facts.")
    except Exception:
        # Silent — extraction failures are not interesting enough to spam.
        return


# ==========================================
# PRINT ONTOLOGY TREE (for debugging)
# ==========================================

def print_tree():
    """Print the full memory ontology tree with fact counts."""
    _ensure_cache()
    print("\n=== GARY'S PHOTON BRAIN — MEMORY TREE ===\n")
    total = 0
    for domain_key, domain in ONTOLOGY.items():
        domain_total = 0
        for cat_key in domain["categories"]:
            cache_key = f"{domain_key}/{cat_key}"
            count = len(_cache.get(cache_key, []))
            domain_total += count
        print(f"  {domain_key}/ — {domain['description']} ({domain_total} facts)")
        for cat_key, cat_info in domain["categories"].items():
            cache_key = f"{domain_key}/{cat_key}"
            count = len(_cache.get(cache_key, []))
            syn_count = len(cat_info["synonyms"])
            print(f"    {cat_key}/ — {cat_info['description']} ({count} facts, {syn_count} synonyms)")
        total += domain_total
    print(f"\n  TOTAL: {total} facts across {len(ONTOLOGY)} domains")
    print("=== END TREE ===\n")


# Re-export summarize_session from v1 so gary_brain.py / gary.py can
# swap imports wholesale without losing session summarization.
try:
    from gary_memory_system import summarize_session  # noqa: F401
except Exception:
    def summarize_session(*args, **kwargs):
        return None


if __name__ == "__main__":
    print("Gary's Photon Brain Memory System v2")
    print("Run migrate_v1_to_v2() to upgrade from flat folders.")
    print_tree()
