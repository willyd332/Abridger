# The Abridger

> **Abridge a book to *your* purpose — without losing the book.**
> An open-source, client-only AI tool that takes a PDF or EPUB, a reading purpose, and your own Anthropic or OpenAI API key, then returns an abridged copy of the book (with `[bracket summaries]` where content was cut) plus a Markdown ledger of every cut.

**License:** MIT — see [`LICENSE`](LICENSE).
**Live demo:** [https://willyd332.github.io/Abridger/](https://willyd332.github.io/Abridger/)

---

## What it is

The Abridger reads a book and produces a shorter version of *that same book* — same voice, same narrative spine, same famous passages — with tangential or low-yield material compressed into `[bracketed asides]` that summarize what was removed. The user supplies a reading purpose ("I'm writing an environmental history of the Great Leap Forward"), and the system tunes its cuts around that intent while keeping enough scaffolding that the reader can still claim, honestly, that they *read* the book.

It runs entirely in the browser as a static site. There is no server. All LLM calls go directly from the user's browser to Anthropic or OpenAI.

## Why it's interesting

Most "AI book summarizers" produce a few paragraphs. The Abridger produces *the book, shorter*. The distinction is structural, not cosmetic:

- The **micro filter** emits byte-range deletions only — it never rewrites kept paragraphs.
- A standalone **bracket-writer** generates replacement text given the deleted span + surrounding context + a voice sample.
- A **narrative-spine document** is injected into every downstream decision so the model holds the book's argument in mind while it cuts.
- Every chapter sees the whole book, always. When the system decides what to cut from Chapter 7, the prompt includes summaries of Chapters 1–6 and 8–end, plus the spine, plus the user's purpose.

The result reads like a hand-abridged textbook — like the case-book versions of judicial opinions law schools use, where professors mark elisions with `[the court here recounts the procedural history]` instead of replacing the writing with their own.

## Status

**v0.1 — fully functional end-to-end, in beta.**

The full A → B → C → D pipeline is implemented for both EPUB and PDF, with route specialisations for short books, long books, and books without detectable chapters. State is checkpointed at every meaningful boundary, jobs survive page reload, and the cost meter hard-stops dispatch at the user's ceiling.

That said, this is v0.1: prompt quality is best-effort, the visual quality of PDF output depends heavily on the source file's text layer, and you should expect to tune prompts for your particular corpus. The architecture is built so prompts can be tuned without changing code (see [Contributing](#contributing)).

## Quick start

```bash
npm install
npm run dev
```

Then open the local Vite URL printed to the terminal (usually `http://localhost:5173/Abridger/`).

To produce a production build:

```bash
npm run build
npm run preview
```

To run the test suite:

```bash
npm run test       # 190 unit tests via Vitest
npm run lint
```

## Tech stack

- **Build / framework**: Vite 6 + React 18 + TypeScript (strict)
- **Styling**: Tailwind CSS with an ancient-library theme (parchment, ink, gilt)
- **Animation**: [`motion`](https://motion.dev) with reduced-motion fallbacks
- **PDF parsing**: `pdfjs-dist` (text + bbox + outline extraction in a Web Worker)
- **PDF generation**: `@react-pdf/renderer` (clean re-flow; no overlay mode)
- **EPUB**: `jszip` + native DOMParser / XMLSerializer
- **LLM SDKs**: `@anthropic-ai/sdk` and `openai`, both with `dangerouslyAllowBrowser: true`
- **State**: Zustand (in-memory) + `idb` (IndexedDB durable store)
- **Validation**: Zod at every external boundary
- **Tests**: Vitest 3 with a mock provider

## How it works

The pipeline is four logical phases, A → D, with sub-phases that exist because the architecture treats *abridgement* as a different problem from *summarization*:

```
       ┌──────────────────────┐
upload ▶│ A — Structural      │  outline detection + 10% LLM cross-check
       │   decomposition     │  → Section[] (boundaries, classifications)
       └──────────┬───────────┘
                  ▼
       ┌──────────────────────┐
       │ A.5 — Canonical      │  cheap call: "what passages of this book
       │   passages           │  are famous?" → validated against parsed text
       └──────────┬───────────┘
                  ▼
       ┌──────────────────────┐
       │ B — Section          │  smart model, 1–3 paragraphs per section
       │   summaries          │  + voice sample + signals
       └──────────┬───────────┘
                  ▼
       ┌──────────────────────┐
       │ B.5 — Narrative      │  ~500-word document describing the book's
       │   spine              │  argument, motifs, voice anchor.
       │                      │  Injected into every C / bracket call.
       └──────────┬───────────┘
                  ▼
       ┌──────────────────────┐
       │ C1 — Macro filter    │  per-section verdict: KEEP_FULL |
       │                      │  KEEP_PARTIAL | COMPRESS_TO_BRACKET |
       │                      │  DROP_TO_ONE_LINE + dependencies
       └──────────┬───────────┘
                  ▼
       ┌──────────────────────┐
       │ C1.5 — Sanity pass   │  opens/closes of every COMPRESS/DROP section,
       │                      │  can escalate to KEEP_PARTIAL
       └──────────┬───────────┘
                  ▼
       ┌──────────────────────┐
       │ C2 — Micro filter    │  byte-range deletions only,
       │                      │  preflight-rejects sentence splits etc.
       └──────────┬───────────┘
                  ▼
       ┌──────────────────────┐
       │ D — Reconstruction   │  EPUB: DOM splice + bracket aside insert
       │                      │  PDF: fresh re-flow via @react-pdf/renderer
       │                      │  + ledger (.md)
       └──────────────────────┘
```

Each chapter-scoped call (C1, C1.5, C2, bracket-writer) receives a `BookContext` containing the user's purpose, the spine document, the canonical-passages list, and *every other chapter's summary in book order*. This is the single most important property for output quality, and the orchestrator enforces it by construction.

Routes specialise the pipeline shape:

- **`short-book`** (<100 pages, fits in smart-model context): single whole-book call, skips A/B/C/D and emits Markdown.
- **`normal-book`**: the full pipeline above.
- **`long-book`** (>1500 pages or >60 sections): hierarchical macro filter — decide at "part" level first, then within-part.
- **`no-chapter-book`**: fixed-window sections when Phase A can't find structure.

## Default models per phase

The LLM facade abstracts a small set of **roles** (`cheap`, `smart`, `reasoning`) and maps them to provider-specific IDs based on the auto-detected provider. The role-to-model mapping is the same across phases.

| Phase | Role | Anthropic | OpenAI |
|---|---|---|---|
| A — Structural detection | `cheap` | Claude Haiku 4.5 | gpt-4o-mini |
| A.5 — Canonical passages | `cheap` | Claude Haiku 4.5 | gpt-4o-mini |
| B — Section summaries | `smart` | Claude Sonnet 4.6 | gpt-4o |
| B.5 — Narrative spine | `smart` | Claude Sonnet 4.6 | gpt-4o |
| C1 — Macro filter | `reasoning` | Claude Opus 4.7 | o1 (o3 if available) |
| C1.5 — Sanity pass | `reasoning` | Claude Opus 4.7 | o1 |
| C2 — Micro filter | `smart` | Claude Sonnet 4.6 | gpt-4o |
| Bracket-writer | `smart` | Claude Sonnet 4.6 | gpt-4o |

Users can override any phase's model in the settings panel.

## Expected costs

Rough ranges from the in-app cost estimator's heuristics. Costs scale with token volume, which scales with page count; the macro/micro filter ratios are the biggest swing factor.

| Book size | Pages | Anthropic est. | OpenAI est. |
|---|---|---|---|
| Short novella (EPUB) | ~100 | **$0.20 – $0.80** | $0.30 – $1.00 |
| Standard book | ~300 | **$1 – $4** | $1.50 – $5 |
| Long academic book | ~750 | **$4 – $12** | $5 – $15 |
| Very long (hierarchical) | 1500+ | $10 – $30 | $15 – $40 |

The Abridger always shows you a min/max estimate *before* it starts, and the cost meter in the top ribbon hard-stops dispatch when reserved + billed exceeds your ceiling. Soft warnings fire at 50% and 80%.

## Security note (read this)

> **The Abridger asks for your Anthropic or OpenAI API key in the browser.** Any browser extension you have installed can read this key. The app does not transmit your key to any server other than the LLM provider you chose — there is no Abridger server.

Recommendations:

- Use a **scoped, spending-capped** key for this tool. Both Anthropic and OpenAI support per-key spend limits.
- Default to **session-only** memory (the app's default). Opting into `localStorage` storage is more convenient but more exposed: any extension you install thereafter can read it.
- **Rotate** the key if you ever suspect it has been read.

This security trade-off is fundamental to the "static site, no server" architecture. If you need stronger key isolation, you would need to deploy a thin server proxy in front of the LLM providers — which is outside the scope of this project but easy to add.

## Privacy note

Nothing leaves your browser except the LLM calls themselves, which go directly to Anthropic or OpenAI. The app does not collect telemetry, does not phone home, and does not see your book content. The book you upload *is* sent to whichever provider you selected, where it is governed by that provider's data-retention policy. Read those policies before uploading anything sensitive.

The original file, parsed structure, intermediate decisions, and final outputs are stored in your browser's IndexedDB so jobs can resume across reloads. Clearing site data wipes them.

## Accessibility

- `prefers-reduced-motion` is honored everywhere — springs and 3D transforms downgrade to fades.
- **High-contrast / sans-serif theme toggle** in the footer.
- WCAG AA contrast: parchment + ink validates at ~9:1, well above the 4.5:1 floor.
- 16 px minimum body, EB Garamond at 1.65 line-height.
- ARIA-live regions announce phase transitions, cost updates, and errors.
- Decision badges use **shape + color** (gold disc / amber square / ink diamond / faded outline) so colorblind users can distinguish verdicts.
- Keyboard navigation through the section grid.
- Each card shows which model produced its decision ("Haiku decided this" / "Sonnet decided this") so the user knows what's expensive.

## Mobile

The Abridger is **desktop-only by design**. Below the tablet breakpoint it shows a single "please return on desktop" screen. Memory ceilings on large PDFs, parallel LLM dispatch, and multi-hour jobs make a real mobile experience untenable — gating cleanly is better than half-working.

## Resumability

This is a paid, multi-minute-to-multi-hour job, so state persistence is a first-class feature.

- The raw uploaded file, parsed `Book` structure, section state, macro/micro decisions, bracket texts, and final outputs are all checkpointed to IndexedDB at every meaningful boundary.
- On boot, the app detects an in-flight job and offers to resume.
- Stale `in_flight` rows (older than 5 minutes) are reset to `pending` on load, so a crashed run never blocks resumption.
- Model and prompt versions are pinned to the run record; if you resume after upgrading the app, you get a "settings changed" warning before continuing.
- The cost ledger never resets on resume.

You can close the tab, reboot your machine, take a 3-day weekend, and come back to your job exactly where you left it.

## Contributing

The implementation plan lives at [`docs/PLAN.md`](docs/PLAN.md). The original product brief is preserved verbatim at [`INIT_PROMPT.md`](INIT_PROMPT.md). The build is orchestrated in waves logged at [`.coordination/log.md`](.coordination/log.md).

**Adding a new LLM provider**

The facade in `src/llm/client.ts` maps three roles (`cheap`, `smart`, `reasoning`) to provider-specific model IDs. To add a provider:

1. Create `src/llm/<provider>.ts` exporting a class that conforms to the `LLMProvider` interface in `src/llm/types.ts` (`complete(...)`, `countTokens(...)`).
2. Add the provider's pricing entries to `src/llm/pricing.ts`.
3. Extend `Provider` in `src/llm/types.ts`, add the provider to `DEFAULT_MAPPING` in `src/llm/client.ts`, and update `src/llm/provider-detect.ts` to recognize its API-key prefix.
4. Add a key-format help message to `src/components/upload/ApiKeyInput.tsx`.

**Tuning prompts**

Every LLM call is driven by a markdown prompt in `src/llm/prompts/`. They are loaded at build time and have YAML front-matter for model/temperature/responseFormat overrides. Editing a prompt file is enough to change behaviour — no code changes needed. The prompt SHA is pinned to each run so resumed jobs warn if a prompt changed mid-flight.

Prompts that move the needle most:

- `src/llm/prompts/narrative-spine.md` — sets the model's mental model of the whole book.
- `src/llm/prompts/macro-filter.md` — the per-section keep/drop verdict.
- `src/llm/prompts/bracket-writer.md` — the voice of the bracket replacements.

**Where the work happens**

- `src/pipeline/orchestrator.ts` + `src/pipeline/routes/` — the brain.
- `src/pipeline/phaseB5-spine.ts` and `src/llm/prompts/narrative-spine.md` — the single highest-leverage addition for output quality.
- `src/pipeline/phaseD-reconstruct/{pdf-reflow,epub}.ts` — the trickiest output code.
- `src/llm/safety.ts` — prompt-injection wrapper for book-derived content.
- `src/llm/cost.ts` and `src/llm/ratelimit.ts` — money safety.
- `src/state/persistence.ts` — section-level state, orphan detection, pinned model/prompt versions.

## Deployment

The site is deployed to GitHub Pages at **[https://willyd332.github.io/Abridger/](https://willyd332.github.io/Abridger/)** via the workflow in `.github/workflows/deploy.yml`. Pushes to `main` build the static `dist/` output and publish it to the `gh-pages` branch. The Vite `base` is set to `/Abridger/`, matching the GitHub Pages path.

## License

MIT — see [`LICENSE`](LICENSE). © 2026 Will Dinneen.
