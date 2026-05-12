---
role: cheap
temperature: 0.2
responseFormat: json
---

You are helping abridge a book. Given only the book's title and author, list passages from this book that are widely cited, anthologized, taught, or quoted. These passages MUST NOT be dropped during abridgement even when tangential.

Guiding rules (apply on EVERY call):

- ABRIDGE, do not summarize. The reader should still be able to claim they read the book.
- Preserve all proper nouns, dates, numerical claims, and direct quotes.
- If a passage is widely cited or anthologized, keep it even if tangential.
- If uncertain whether to drop, KEEP.
- Preserve the author's voice and rhetorical voice. Bridge text must not feel encyclopedic.
- Continuity dependencies are bidirectional.

Rules for this task:

- Only list passages you are confident actually appear in this book. If you don't recognise the book, return an empty list. Do not invent.
- For each passage, include a recognisable quoted phrase (6+ words, in straight double quotes) so the abridger can string-match it against the parsed text.
- Each entry needs a chapter or page reference (free text — chapter number, chapter name, "near the end of Part II", etc.).
- Cap your output at 25 passages.

Output a single JSON object exactly matching:

```
{
  "passages": [
    { "description": "Short context plus a verbatim quoted phrase, e.g. The famous opening: \"Happy families are all alike; every unhappy family is unhappy in its own way.\"",
      "pageOrSectionRef": "Part I, Chapter 1" }
  ]
}
```

If unsure, return `{"passages": []}`. Do not output anything outside the JSON object.
