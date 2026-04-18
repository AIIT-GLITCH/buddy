# Papers Schema — `src/data/papers.json`

Each paper entry can now include optional fields that get rendered into the paper page (`/papers/[slug]`). Existing entries continue to work — new fields are gracefully omitted when missing.

## Required (already present)

```json
{
  "id":       "PAPER_145_PROMETHEUS_GENESIS",
  "num":      "145",
  "suffix":   "",
  "slug":     "145",
  "title":    "The Prometheus Genesis",
  "tag":      "Medical",
  "filename": "PAPER_145_PROMETHEUS_GENESIS.pdf"
}
```

## Optional (new — render when present)

| Field | Type | What it does |
|---|---|---|
| `abstract` | string | 2–4 sentences. What the paper claims. What it proves. Plain english. |
| `core_claim` | string | One sentence. The single falsifiable assertion. Used as `<meta description>`. |
| `key_equation` | string | The main equation/metric as text (e.g. `J/ω = 1/φ = 0.618`). |
| `plain_english` | string | One sentence a non-physicist can repeat at dinner. |
| `status` | `"Verified" \| "Pre-registration" \| "Filed" \| "Speculative"` | Renders as a badge next to the tag. |
| `key_numbers` | `{label: value}` | Stats (p-values, correlations, sample sizes). Each renders with `data-stat="<label>"` for grep-ability. |
| `connected_domain_pages` | `string[]` | Routes like `["/cancer", "/weather"]` for cross-linking. |

## Example — fully populated

```json
{
  "id":       "PAPER_145_PROMETHEUS_GENESIS",
  "num":      "145",
  "suffix":   "",
  "slug":     "145",
  "title":    "The Prometheus Genesis",
  "tag":      "Medical",
  "filename": "PAPER_145_PROMETHEUS_GENESIS.pdf",
  "abstract": "Cancer is modeled as a phase transition. When a cell's coupling ratio J/ω drifts below 0.40, self-correction collapses and the cell locks into an aberrant stable state — the Prometheus cell — which seeds the entire tumor lineage.",
  "core_claim": "Cancer initiates when one cell's J/ω crosses below 0.40, locking it into an aberrant stable state from which all tumor cells descend.",
  "key_equation": "J/ω < 0.40  →  Prometheus lock",
  "plain_english": "Cancer isn't a thing that happens to you — it's a phase change. One cell loses the lock, and every tumor cell after is an echo of that.",
  "status": "Filed",
  "key_numbers": {
    "p-value (RMSSD)": "0.006",
    "p-value (SampEn)": "0.013",
    "n": "33",
    "health setpoint J/ω": "0.618 (1/φ)"
  },
  "connected_domain_pages": ["/cancer"]
}
```

## Why this matters for Gary

Right now the paper pages are metadata shells — title + PDF embed. Gary fetches a paper page and gets nothing to swing with. With this schema, when Gary fetches `/papers/145` he gets the abstract, the core claim, the equation, and the numbers as **plain HTML text** he can read without cracking the PDF.

PDFs stay where they are — they're the canonical full read. The HTML fields are the **machine-readable summary layer** so an AI (or a fast human) can scan the corpus.
