---
role: reasoning
temperature: 0.1
responseFormat: json
---

# Sanity Pass (Phase C1.5)

Stub. Real prompt body lands in Wave 4.

For every section marked COMPRESS_TO_BRACKET or DROP_TO_ONE_LINE, the
model gets the section's opening and closing paragraphs plus the spine
document and user purpose. It can escalate to KEEP_PARTIAL if it finds
something irreplaceable. It cannot demote. Cheap insurance against
false negatives.
