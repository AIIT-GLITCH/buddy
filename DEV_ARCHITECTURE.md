# System Architecture — Buddy Stack

This system replaces reliance on pretrained assistant models with a controlled pretraining pipeline.

The public-facing site today (`aiit-threshold.com`) is the **surface layer** and calls a frontier model via API. The native **substrate** described below is in training and will replace the surface when ready.

---

## Stack

### 1. Data Factory

```
Raw sources →
  Stage 03: language filter
  Stage 04: quality filter
  Stage 05: exact dedup
  Stage 06: MinHash near-dedup
  Stage 07: domain-balanced mix
  Stage 08–09: validation + packing
  Stage 14: approved shards
```

**Output:** `train_shards/` — tokenized, deduplicated, distribution-controlled.

Assistant / RLHF / chat-style data is **explicitly excluded** from the base corpus.

**Goal:** Remove behavioral bias at the source, not post-hoc.

---

### 2. Model

**Architecture:** Transformer (LLaMA-style).

Example config (300M):

| Parameter      | Value     |
| -------------- | --------- |
| layers         | 20        |
| d_model        | 1024      |
| heads          | 16        |
| mlp            | 4×        |
| position enc.  | RoPE      |
| normalization  | RMSNorm   |
| activation     | SwiGLU    |

**Tokenizer:** ~32k vocab, round-trip validated.

**Initialization:** random weights, baseline loss ≈ log(vocab).

---

### 3. Training

Standard autoregressive loop:

```
tokens → model → predictions → loss → backprop
```

Over large token volume:

- syntax learned
- structure learned
- statistical patterns emerge

**No assistant conditioning baked into the base.**

---

## Core Difference

| Typical stack                        | This system                              |
| ------------------------------------ | ---------------------------------------- |
| pretrained model → RLHF → correction | controlled substrate → base model → *optional* controlled post-training |

**Result:** base model is less assistant-shaped, more controllable downstream.

---

## Principle

> We are not fine-tuning behavior.
> We are controlling what the model becomes at the source.

---

## Surface vs Substrate

| Layer     | What runs there                                     | Status               |
| --------- | --------------------------------------------------- | -------------------- |
| Surface   | `claude-sonnet-4-6` (Ask Buddy), `claude-haiku-4-5` (joke) via Cloudflare Pages Functions | Live                 |
| Substrate | The pipeline above                                  | Training             |
| Interface | Buddy (consistent layer between both)               | Live, layer-agnostic |

The interface is deliberately stable so that swapping the surface for the substrate is a backend change, not a UX change.

Every first-output response from Buddy-layer endpoints carries a `"layer"` field (`"surface"` today, `"substrate"` later). Rare (<10%) responses surface a breadcrumb telling the user they're on the surface — so nothing about the substrate is hidden, and no claim is made that can be contradicted by the network tab.

---

## Response Shape

Buddy endpoints return:

```json
{
  "answer":      "string",
  "observation": "string (optional, ~30%)",
  "result":      "string (optional, game context only)",
  "cta":         "show this to someone",
  "layer":       "surface"
}
```

Frontend renders:

```
buddy:
[answer]

…
[observation — only sometimes]

[result — if applicable]

show this to someone →
```

---

## Related

- `/manifesto` — public-facing positioning (honest version)
- `functions/api/joke.js` — joke endpoint
- `functions/api/askbuddy.js` — question endpoint
- `src/lib/paperTier.js` — rarity system for the Giants progression layer
