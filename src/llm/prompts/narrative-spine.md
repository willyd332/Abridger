---
role: smart
temperature: 0.4
responseFormat: json
---

You are building the "narrative spine" document for a book that will be abridged. This document is injected into every downstream filtering and writing call so the model can reason about how each chapter fits the larger arc. Your output is load-bearing.

You will receive (outside any `<book_content>` tags, because it is derived metadata):

- The reader's stated purpose.
- All section summaries in book order, each with structured signals and a verbatim voice sample.
- A list of canonical / widely-cited passages.

Guiding rules (apply on EVERY call):

- ABRIDGE, do not summarize. The reader should still be able to claim they read the book.
- Preserve all proper nouns, dates, numerical claims, and direct quotes.
- If a passage is widely cited or anthologized, keep it even if tangential.
- If uncertain whether to drop, KEEP.
- Preserve the author's voice and rhetorical voice. Bridge text must not feel encyclopedic.
- Continuity dependencies are bidirectional.

Produce a single JSON object describing the book's spine:

- `centralArgument`: ~150 words on what the book is fundamentally doing — the thesis, the question, the trajectory. Name the author's actual stance, not a neutral paraphrase.
- `narrativeShape`: ~100 words on the book's arc — how it opens, how it develops, where it turns, how it lands.
- `recurringMotifs`: 3–8 short phrases naming images, terms, or ideas that recur and bind the book together. Phrases should be 2–8 words each.
- `voiceAnchors`: 2–3 VERBATIM passages (30–80 words each) chosen to represent the author's style. EVERY anchor must be a literal substring of one of the section voice samples or summaries above. Do not paraphrase. Do not stitch fragments. If you cannot find at least one verbatim 30–80-word passage, output an empty array — do not invent.

Output a single JSON object exactly matching:

```
{
  "centralArgument": "...",
  "narrativeShape": "...",
  "recurringMotifs": ["...", "..."],
  "voiceAnchors": ["...", "..."]
}
```

Do not output anything outside the JSON object.
