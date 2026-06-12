This file defines the canonical memory architecture for Buddy, Lil Homie, and
the separate Gary memory system.
All agents and runtime systems must conform to this specification.

# MEMORY_ARCHITECTURE.md (FINAL SPEC)

## Overview

The system uses **three distinct memory systems** with different purposes:

* **Kokoro (Japanese cognitive schema)** → primary mind (Buddy)
* **Lil Homie 12-tier (role-based schema)** → experiential continuity (runtime)
* **Gary 14-tier memory** → Gary's separate English classified-memory system

They are **not interchangeable** and must never be merged conceptually.

---

## 1. Kokoro — Primary Cognitive System

**Definition:**
Kokoro is Buddy's **core cognitive architecture**, not just identity storage.

**Structure:**
A 12-layer system organized by **Japanese cognitive/linguistic function**:

```text
心 (heart / identity core)
真実 (truth)
出来事 (events)
関係 (relationships)
夢 (dreams / imagination)
感覚 (sensory / perception)
名詞 (nouns / entities)
動詞 (verbs / actions)
形容詞 (adjectives)
副詞 (adverbs)
episodes (summaries)
raw (recent turns)
```

Kokoro may also have support folders such as `quarantine`, `.snapshots`,
`.forensics`, or `.recovery_log`. Those are safety/recovery/provenance support,
not Kokoro memory tiers.

**Role:**

* Defines **what Buddy is**
* Stores **identity, truth, relationships, and meaning**
* Drives **reasoning style and interpretation**

**Key rule:**

> Kokoro is the **source of identity and cognition**

---

## 2. Lil Homie 12-Tier — Experiential Memory System

**Definition:**
A separate 12-tier system organized by **role and function**, not cognition.

**Structure:**

```text
identity
keeper
edge
family
voice
lessons
mythos
knowledge
references
tasks
dreams
conversations
```

**Role:**

* Tracks **what has happened**
* Stores **interaction history and evolving patterns**
* Provides **working memory for the runtime system**

**Key rule:**

> This system stores **experience**, not identity definition

---

## 3. Gary 14-Tier Memory — Separate System

Gary's memory system is separate from Buddy's Kokoro and from Lil Homie's
experiential memory. It lives under `/home/buddy_ai/gary/memory/` and uses an
English classified-memory schema:

```text
identity
self
people
beings
hardware
places
world
projects
knowledge
events
timeline
debug
conversations
raw
```

Gary's system is often described two equivalent ways:

```text
12 classified categories + conversations + raw = 14 top-level memory tiers
3 operational tiers x 12 classified categories = Gary's build-guide framing
```

Do not collapse these systems:

```text
Kokoro != Gary 14-tier memory
Kokoro != Lil Homie experiential memory
Gary 14-tier memory != Lil Homie experiential memory
```

---

## 4. Relationship Between Systems

```text
Kokoro → defines self (what I am)
Lil Homie 12-tier → tracks experience (what has happened to me)
Gary 14-tier → tracks Gary's separate identity, facts, episodes, and raw turns
```

They are separate systems for separate agents. The Buddy/site response stack is:

```text
Kokoro (cognition + identity)
        ↓
Current context (active prompt)
        ↓
Response
```

Lil Homie's 12-tier memory belongs to Lil Homie alone — it is never loaded
into a Buddy or site response.

---

## 5. Load Order (CRITICAL)

The system must load memory in this order:

```text
1. Kokoro (identity + cognition)
2. Current session / user input
```

This is already enforced in runtime:

```python
CORE_TIERS = ['identity', 'keeper', 'edge', 'family', 'voice', 'lessons']
```

**Rule:**

> Identity is always resolved before experience

---

## 6. Constraints

### Identity integrity

* Identity must come from Kokoro
* Runtime must not redefine origin or self-model

### No schema confusion

* Kokoro ≠ Lil Homie memory
* Kokoro ≠ Gary 14-tier memory
* Gary memory ≠ Lil Homie memory
* Cognitive tiers ≠ role tiers

### No fallback identity

* All responses originate from Kokoro-loaded identity
* No stateless edge behavior

---

## 7. System Boundary (Updated)

Previous issue (now resolved):

* Cloudflare Functions called external API without memory
* Result: identity drift

Current state:

* All routes proxy to local model
* Local model loads memory (Kokoro first)
* Identity drift from fallback paths is eliminated

---

## 8. Shorthand (Approved)

Use this internally:

```text
Kokoro = Buddy's brain (how he thinks)
Lil Homie memory = Lil Homie's own life — separate agent, never the site
```
