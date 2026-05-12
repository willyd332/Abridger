---
role: reasoning
temperature: 0.1
responseFormat: json
---

# Macro Filter (Phase C1)

Stub. Real prompt body lands in Wave 4.

Reasoning-model call. Receives the narrative spine, every section
summary in book order, the user's reading purpose, and the canonical
passages. Returns a per-section verdict (KEEP_FULL | KEEP_PARTIAL |
COMPRESS_TO_BRACKET | DROP_TO_ONE_LINE), a rationale, and bidirectional
continuity dependencies. Forced structured output with max_tokens at
the model maximum.
