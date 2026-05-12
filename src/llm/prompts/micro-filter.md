---
role: smart
temperature: 0.1
responseFormat: json
---

# Micro Filter (Phase C2)

Stub. Real prompt body lands in Wave 4.

Runs on KEEP_FULL / KEEP_PARTIAL sections. Emits byte-range deletion
decisions only — no rewriting. Returns arrays of
{ startOffset, endOffset, dropRationale }. Preflight rejects ranges
that split a sentence, orphan a pronoun antecedent, cross a protected
block, or span beyond a paragraph.
