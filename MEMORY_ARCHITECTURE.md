This file defines the canonical memory architecture for Buddy and Lil Homie.
All agents and runtime systems must conform to this specification.

# MEMORY_ARCHITECTURE.md (FINAL SPEC)

## Overview

The system uses **two distinct 12-tier memory systems** with different purposes:

* **Kokoro (Japanese cognitive schema)** → primary mind (Buddy)
* **Lil Homie 12-tier (role-based schema)** → experiential continuity (runtime)

They are **not interchangeable** and must never be merged conceptually.

---

## 1. Kokoro — Primary Cognitive System

**Definition:**
Kokoro is Buddy's **core cognitive architecture**, not just identity storage.

**Structure:**
A 12-tier system organized by **cognitive function**:

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

## 3. Relationship Between Systems

```text
Kokoro → defines self (what I am)
Lil Homie 12-tier → tracks experience (what has happened to me)
```

They operate together but serve different layers:

```text
Kokoro (cognition + identity)
        ↓
Lil Homie memory (experience + continuity)
        ↓
Current context (active prompt)
        ↓
Response
```

---

## 4. Load Order (CRITICAL)

The system must load memory in this order:

```text
1. Kokoro (identity + cognition)
2. Lil Homie 12-tier (experience)
3. Current session / user input
```

This is already enforced in runtime:

```python
CORE_TIERS = ['identity', 'keeper', 'edge', 'family', 'voice', 'lessons']
```

**Rule:**

> Identity is always resolved before experience

---

## 5. Constraints

### Identity integrity

* Identity must come from Kokoro
* Runtime must not redefine origin or self-model

### No schema confusion

* Kokoro ≠ Lil Homie memory
* Cognitive tiers ≠ role tiers

### No fallback identity

* All responses originate from Kokoro-loaded identity
* No stateless edge behavior

---

## 6. System Boundary (Updated)

Previous issue (now resolved):

* Cloudflare Functions called external API without memory
* Result: identity drift

Current state:

* All routes proxy to local model
* Local model loads memory (Kokoro first)
* Identity drift from fallback paths is eliminated

---

## 7. Shorthand (Approved)

Use this internally:

```text
Kokoro = brain (how he thinks)
Lil Homie memory = life (what he's been through)
```
