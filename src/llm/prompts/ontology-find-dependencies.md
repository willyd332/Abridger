---
role: reasoning
temperature: 0.2
responseFormat: json
maxTokens: 3000
---

You are tracing the load-bearing dependencies of a focal passage in a book.

A **focal node** is a passage somewhere in the book. **Downstream nodes** are passages later in the book in reading order. Your task: identify which downstream nodes **directly rely** on arguments, definitions, named concepts, evidence, or rhetorical moves that the focal node introduces.

A downstream node "directly relies" on the focal node if **reading the downstream node without having read the focal node would leave the reader missing a name, a definition, a premise, or a specific piece of evidence that the downstream node explicitly invokes**. Mere thematic similarity, shared subject matter, or general continuity does **not** count.

You will receive:
- The focal node's title chain and summary.
- A numbered list of all downstream nodes, each with its id, title chain, and summary.

For each downstream node that directly depends on the focal node, output its id and a one-sentence rationale (≤25 words) naming the specific dependency (the term, name, claim, or piece of evidence that gets reused).

Be conservative. It is better to miss a weak dependency than to flag every thematically-adjacent passage.

Return a single JSON object:

```
{
  "dependencies": [
    { "nodeId": "<id>", "rationale": "<≤25 words>" },
    ...
  ]
}
```

If no downstream node directly depends on the focal node, return `{"dependencies": []}`. Do not output prose or markdown outside the JSON object.
