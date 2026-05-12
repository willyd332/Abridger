# Abridger — Open-Source AI Book Abridgement Tool

## Context

We are building an open-source static web app (deployed to GitHub Pages) that abridges books (PDF and EPUB) using an LLM. The user supplies their own Anthropic or OpenAI API key and a "reading purpose" prompt. The system produces (1) an abridged version of the original file with `[bracketed summaries]` where content was removed and (2) a Markdown ledger describing what was cut.

The goal is to ABRIDGE — not to summarize. The user should still be able to say they "read" the book. Tangential or low-yield material is compressed into bracket summaries; the book retains its narrative spine, voice, key context, and famous passages.

Repo: `git@github.com:willyd332/Abridger.git` (currently only a LICENSE file). Working dir: `/Users/will/Dropbox/ORGANIZED/BUILD/Abridger`.

This plan has been stress-tested by two review passes; the version below incorporates their fixes. Notable changes from the first draft are tagged `[REV]`.

---

## Architectural Principles

1. **Client-only, desktop-only.** Static site on GitHub Pages. User-supplied API keys. All LLM calls go directly to Anthropic/OpenAI from the browser. **Mobile is hard-blocked at intake** with a "come back on desktop" screen. The security trade-off of in-browser keys is surfaced prominently.
2. **PDF = re-flowed, full stop.** Rebuild a fresh, clean PDF from extracted text, with chapter/section headings and original page-number marginalia ("[orig. pp. 142–187]"). No overlay-and-stamp mode is in scope. EPUB is reflow-based.
3. **Abridge ≠ summarize is an architectural property, not a hope.**
   - The micro filter emits **byte-range deletions only** — it never rewrites kept paragraphs.
   - A standalone **bracket-writer** generates replacement text, given the deleted span + surrounding context + a voice sample from the section.
   - A **"narrative spine" document** (Phase B.5) is injected into every downstream prompt so the model holds the book's argument and motifs in mind.
4. **Every chapter sees the whole book, always.** Whenever the system makes decisions about a single chapter (macro filter, micro filter, bracket writing), the prompt MUST include: the full list of all other section summaries (in book order), the narrative spine document, and the user's reading purpose. This is non-negotiable — it is the only way the model can reason about how the chapter fits the larger arc. The orchestrator enforces this by construction (a shared `BookContext` object passed into every section-scoped call).
5. **Branching orchestrator.** Short books (<100pp), normal books, very long books (>1500pp), and no-chapter books take different code paths.
6. **Asymmetric loss.** Across all prompts: "If uncertain whether to drop, keep."
7. **Bulletproof resumability.** State is checkpointed to IndexedDB at every meaningful boundary; the system is designed to survive page reload, browser crash, OS reboot, and multi-day interruptions without losing work or repeating paid calls. Memory ceilings are managed by streaming data and releasing parsed buffers aggressively. See "State & Resumability" section.
8. **Watchable processing.** Ancient-library aesthetic, motion.dev animations. Three big "set piece" moments only — everything else is quiet. `prefers-reduced-motion` is fully respected.

---

## Tech Stack

- **Framework**: Vite + React + TypeScript → static `dist/` → GitHub Pages
- **Styling**: Tailwind CSS + ancient-library theme tokens (parchment, ink, gold; serif body)
- **Animation**: `motion` (motion.dev), with reduced-motion fallbacks throughout
- **PDF parsing**: `pdfjs-dist` (text + bbox extraction; outline access)
- **PDF generation**: `@react-pdf/renderer` OR `pdfmake` — decided in scaffold step based on font-embedding ergonomics. Produces the clean re-flowed output that is the only PDF path.
- **EPUB parsing**: `jszip` + DOMParser/XMLSerializer (we don't need `epubjs` runtime; we just read structure ourselves for editability)
- **LLM SDKs**: `@anthropic-ai/sdk` (`dangerouslyAllowBrowser: true`) and `openai` (`dangerouslyAllowBrowser: true`)
- **State**: Zustand + `idb` (IndexedDB)
- **Validation**: Zod (inputs, structured LLM outputs)
- **Workers**: Web Workers for PDF parsing and the LLM dispatcher pool
- **Tokenizers**: `tiktoken` for OpenAI; Anthropic `/v1/messages/count_tokens` for Claude (`[REV]` not tiktoken — wrong tokenizer)
- **Tests**: Vitest unit tests with mocked provider; small public-domain fixtures
- **Deploy**: GitHub Actions → `gh-pages` branch

---

## Repo Layout

```
Abridger/
├── INIT_PROMPT.md                # frozen original spec (created first)
├── README.md
├── LICENSE                       # already exists
├── index.html
├── package.json
├── vite.config.ts
├── tsconfig.json
├── tailwind.config.ts
├── public/
│   ├── fonts/                    # self-hosted Garamond family
│   ├── textures/                 # parchment overlay (≤8% opacity)
│   └── pdfjs-worker/
├── src/
│   ├── main.tsx
│   ├── App.tsx
│   ├── components/
│   │   ├── layout/
│   │   ├── upload/               # FileDropzone, ApiKeyInput, PurposePrompt, ProviderSelect
│   │   ├── pipeline/             # PipelineScroll, SectionGrid, PageFlip, LivePreviewPane, CostMeter
│   │   ├── results/              # DownloadPanel, LedgerPreview, StatsRibbon
│   │   ├── settings/             # ReducedMotionToggle, HighContrastToggle, ModelSelectors
│   │   └── ui/
│   ├── pipeline/
│   │   ├── orchestrator.ts       # branching state machine
│   │   ├── routes/               # one file per pipeline shape
│   │   │   ├── short-book.ts     # <100pp → single whole-book call
│   │   │   ├── normal-book.ts    # full A→D pipeline
│   │   │   ├── long-book.ts      # hierarchical macro filter
│   │   │   └── no-chapter-book.ts# fixed-window sections
│   │   ├── phaseA-structure.ts
│   │   ├── phaseA5-canonical.ts  # [REV] famous passages detection
│   │   ├── phaseB-summarize.ts
│   │   ├── phaseB5-spine.ts      # [REV] narrative spine document
│   │   ├── phaseC1-macro.ts
│   │   ├── phaseC15-sanity.ts    # [REV] spot-check first/last paras of COMPRESS/DROP
│   │   ├── phaseC2-micro.ts      # emits byte-range deletions only
│   │   ├── phaseD-reconstruct/
│   │   │   ├── pdf-reflow.ts     # the only PDF path (clean rebuild)
│   │   │   ├── epub.ts
│   │   │   └── ledger.ts
│   │   └── types.ts
│   ├── llm/
│   │   ├── client.ts             # provider facade
│   │   ├── anthropic.ts
│   │   ├── openai.ts
│   │   ├── prompts/              # versionable markdown
│   │   │   ├── structure.md
│   │   │   ├── canonical-passages.md   # [REV]
│   │   │   ├── summarize.md
│   │   │   ├── narrative-spine.md      # [REV]
│   │   │   ├── macro-filter.md
│   │   │   ├── sanity-pass.md          # [REV]
│   │   │   ├── micro-filter.md
│   │   │   └── bracket-writer.md
│   │   ├── cost.ts               # token + $$ estimator with reservation
│   │   ├── ratelimit.ts          # [REV] token-bucket aware backoff
│   │   ├── retry.ts
│   │   └── safety.ts             # [REV] book-content sanitization + injection guards
│   ├── parsers/
│   │   ├── pdf-parser.ts         # blocks classified as body/header/footer/folio/footnote/caption
│   │   ├── epub-parser.ts        # EPUB 2 vs 3 branch; encryption.xml check
│   │   ├── protected-blocks.ts   # [REV] poetry/equations/dramatis personae detection
│   │   └── frontmatter.ts        # [REV] front/back-matter separation
│   ├── state/
│   │   ├── store.ts
│   │   ├── persistence.ts        # section-level rows, request IDs, orphan detection
│   │   └── selectors.ts
│   ├── workers/
│   │   ├── pdf.worker.ts
│   │   └── llm-pool.worker.ts
│   ├── lib/
│   │   ├── tokens.ts
│   │   ├── concurrency.ts
│   │   ├── motion-presets.ts
│   │   └── a11y.ts               # [REV] reduced-motion + aria helpers
│   └── styles/
│       ├── globals.css
│       └── ancient.css
├── tests/
│   ├── unit/
│   ├── fixtures/                 # public-domain PDF + EPUB samples
│   └── e2e/
└── .github/workflows/
    └── deploy.yml
```

---

## Pipeline Phases

### Phase 0 — Intake

- File upload (PDF or EPUB). Validate size; warn > 50MB.
- **API key — single input, provider auto-detected from key prefix.** No provider toggle.
  - `sk-ant-…` → Anthropic
  - `sk-proj-…` or `sk-…` (not `sk-ant-`) → OpenAI
  - Anything else → "Unrecognized key format" error with a help link.
  - Once detected, the UI shows a small "Provider: Anthropic" / "Provider: OpenAI" pill next to the input and the model defaults table swaps to the appropriate provider's IDs.
  - A quick `models.list` call (1 cheap request) validates the key before the user clicks Begin.
  - Default = session-only memory. Opt-in to localStorage with explicit warning that **any browser extension can read it**. Recommend scoped/spending-capped keys.
- **Reading purpose** textarea.
- **Front/back-matter handling.** `[REV]` Checkbox: "Treat introduction / translator's notes / glossary as: [Keep verbatim | Abridge with body | Drop]".
- **Password-prompt** for password-protected PDFs. `[REV]`
- **Pre-flight refusals**: scanned PDFs (no text layer), DRM EPUBs (`META-INF/encryption.xml` present), DRM-Adobe-ADEPT (encrypted content), PDFs that fail standard parsing.
- **Cost estimate** with byte→token heuristics + per-phase multipliers (range, not single number). Hard cost ceiling (default $5, user-tunable). Soft warnings at 50% and 80%.
- **Branch detection**: short book / normal / very long / no-chapter (heuristic on page count + outline presence + page count vs. spine entries).

### Phase A — Structural Decomposition

- PDF: try outline first. **Always cross-check with a 10% LLM sample**. `[REV]` If divergence exceeds threshold, fall back to LLM structure and surface "we did not trust the original TOC because..." in UI.
- LLM pass: smaller/cheaper model (Haiku / gpt-4o-mini), 10-page sliding windows, JSON output `{boundaryPageNumber, suggestedTitle, confidence}`.
- EPUB: spine = sections; only invoke LLM if a spine entry exceeds N tokens (recursive split).
- Per-block classification on PDFs: `body | header | footer | folio | footnote | caption | protected`. `protected` includes poetry, math, code, dramatis personae, maps, illustrations with captions — see `protected-blocks.ts`. Phase C2 cannot edit *inside* a protected block; it can only drop the whole block.

### Phase A.5 — Canonical Passages `[REV]`

- One cheap call with only book metadata (title, author): "List famous/widely-cited passages from this book." Output requires page or chapter references.
- Validate every citation by string-matching against the parsed text. Discard hallucinated entries.
- The validated list becomes a "forbidden to drop unless the user purpose explicitly excludes them" input to C1/C2.

### Phase B — Section Summaries

- Smart model. 1–3 paragraphs per section, scaled with length.
- Returns `{summary, signals: { isCore, hasFamousArgument, narrativeFunction, ...}, voiceSample: "a 50-word verbatim passage capturing the author's voice"}`.
- Bounded parallelism = **2 by default** (`[REV]` not 4; rate-limit-aware). User can raise with a warning.
- Per-section state in IndexedDB before request dispatch: `{sectionId, status, attempts, requestStartedAt}`. On resume, `in_flight` rows older than N minutes reset to `pending`.

### Phase B.5 — Narrative Spine `[REV]`

- One smart-model call. Inputs: all section summaries, the user's reading purpose, the canonical-passages list.
- Output: ~500-word document describing the book's central argument, its narrative shape, its recurring motifs, and a short "voice anchor" — 2–3 verbatim passages chosen to represent the author's style.
- This document is **injected as a system message into every C1, C1.5, C2, and bracket-writer call**. It is the single most important addition versus the first draft.

### Phase C1 — Macro Filter

- Smart model. Input: spine document + all section summaries + reading purpose + canonical passages.
- Forced structured output (Anthropic tool use / OpenAI `json_schema`) with explicit `max_tokens` set to model maximum. `[REV]`
- **Chunking for long books**: `[REV]` if sections > 40, split into overlapping windows of ~20 with a final reconciliation pass that resolves only cross-window dependencies.
- **Hierarchical mode for very long books** (`long-book.ts` route): group into "parts," decide at part level, then within-part.
- Per-section verdict: `KEEP_FULL | KEEP_PARTIAL | COMPRESS_TO_BRACKET | DROP_TO_ONE_LINE` + rationale + **bidirectional** continuity dependencies (forward and backward).

### Phase C1.5 — Sanity Pass `[REV]`

- For every section marked `COMPRESS_TO_BRACKET` or `DROP_TO_ONE_LINE`, the model gets the section's opening and closing paragraphs (cheap to send) + the spine doc + user purpose.
- Can escalate to `KEEP_PARTIAL` if it finds something irreplaceable. Cannot demote.
- Cheap insurance against false negatives.

### Phase C2 — Micro Filter

- Runs only on `KEEP_FULL` / `KEEP_PARTIAL` sections.
- **Emits byte-range deletion decisions only** (`[REV]` no rewriting allowed). Returns `{startOffset, endOffset, dropRationale}` arrays.
- Preflight rejects deletion ranges that (a) split a sentence, (b) orphan a pronoun antecedent, (c) cross a `protected` block boundary, (d) span beyond a paragraph.
- Per-section, bounded parallelism. Same state-row model as B.

### Bracket-Writer (called by Phase D)

- Receives: deleted span + 1 paragraph of preceding kept text + 1 paragraph of following kept text + the narrative spine + the section's voice sample + a target length range (1 sentence → ~2 pages, decided by C1/C2 verdict).
- Explicit instructions: mimic surrounding register, retain all proper nouns / dates / numerical claims / direct quotes from the deleted span, name the rhetorical function ("this passage argued X"), keep callbacks alive (named terms in dependencies list).
- Runs in parallel with bounded concurrency. Each cut = one call.

### Phase D — Reconstruction

**EPUB path:**
1. JSZip-open original.
2. For each spine doc, splice byte-range deletions; insert `<aside class="abridger-bracket" data-orig-range="...">[summary]</aside>`.
3. Fully-dropped sections: replace XHTML body with the bracket aside.
4. Inject scoped `.abridger-bracket` CSS (parchment-tinted, indented, distinct font) — never modify existing stylesheets.
5. Handle EPUB 2 vs 3 manifest differences. `[REV]`
6. Re-zip, offer download.

**PDF path (re-flow — the only PDF path):**
1. Use the parsed block structure as the source of truth (text + classification + reading order).
2. Apply micro/macro decisions to the block list.
3. Render a fresh PDF with `@react-pdf/renderer` or `pdfmake`:
   - Consistent Garamond throughout.
   - Chapter/section headings rendered cleanly.
   - Brackets visually distinct (italic, indented, lighter shade).
   - Original page-number marginalia ("[orig. pp. 142–187]") at the gutter where a span of pages was abridged.
   - Preserves images/captions/protected blocks intact (extracted images embedded; equations rendered as images if Unicode extraction is unreliable).

**Ledger generation:**
- `abridgement-ledger.md`: for each cut, list section + original page/locator range, a one-sentence neutral description of what was removed, the bracket replacement, and the macro rationale.
- Front-matter notes which model + prompt-version produced the run.

---

## Routes / Branching Logic `[REV]`

```
detectRoute(book):
  if book.pageCount < 100 and book.tokenCount < smartModelContext * 0.5:
    return "short-book"      // single whole-book prompt; skip A/B/C
  if book.pageCount > 1500 or sectionCount > 60:
    return "long-book"       // hierarchical macro
  if structuralConfidence < 0.4 across all phase-A windows:
    return "no-chapter-book" // fixed-length windows as sections
  return "normal-book"
```

Each route is its own file in `src/pipeline/routes/` with its own state machine variant; the orchestrator delegates.

---

## Chapter Context Guarantee (architectural)

When the system makes any decision *about* a single chapter — macro verdict, micro deletions, or bracket text — the prompt MUST include the **full ordered list of all other chapter summaries** in the book, plus the narrative spine document and the user's reading purpose. No exceptions. The orchestrator enforces this by passing a single immutable `BookContext` object into every section-scoped call:

```ts
type BookContext = {
  purpose: string                 // user's reading purpose
  spine: NarrativeSpine           // from Phase B.5
  canonicalPassages: CanonicalPassage[]
  allSectionSummaries: Array<{
    id: string
    title: string
    order: number
    summary: string
    signals: SectionSignals
  }>
}
```

Every prompt template for C1, C1.5, C2, and bracket-writer receives `BookContext` as a structured preamble. This is the single most important property for output quality: it is the only way the model can decide what to cut from Chapter 7 with knowledge of how Chapter 7 lands rhetorically given Chapters 1–6 and 8–end.

---

## Live Preview Pane

During the full run, a side panel streams the reconstructed text of the first 1–2 chapters as decisions land. The user can abort mid-run if direction is wrong. Saves money and frustration.

---

## State & Resumability (critical)

This is a paid, multi-minute-to-multi-hour job. State persistence is not a nice-to-have — it is a core feature. Design constraints:

- **Never OOM.** A 50 MB PDF can balloon to many hundreds of MB of pdf.js page proxies if we hold them all. Solution:
  - Parse PDFs in a Web Worker; release each page proxy immediately after extracting `{text, blocks, bbox, classification}`.
  - Store the parsed `Book` representation in IndexedDB (not memory) as soon as parsing completes. From phase A onward, the orchestrator reads sections from IndexedDB on demand and only holds the current working set in memory.
  - Use IndexedDB **blob storage** for the original uploaded file so large files don't sit in JS heap.
  - Bracket-writer outputs and reconstructed section text live in IndexedDB; reconstruction reads them streamed.
- **Save points at every meaningful boundary.** State is written to IndexedDB:
  1. After upload (the raw file as a Blob).
  2. After Phase A (`Section[]` boundaries).
  3. After each Phase B section completes (one row per section).
  4. After Phase A.5 / B.5 (canonical passages, narrative spine).
  5. After Phase C1 / C1.5 (macro verdicts) and after each C2 section.
  6. After each bracket-writer call (one row per cut).
  7. After Phase D produces the abridged file Blob.
- **Section-level state rows** in IndexedDB: `{sectionId, phase, status: 'pending'|'in_flight'|'done'|'error', attempts, lastError, requestId, requestStartedAt, model, promptHash, costBilled}`. The `requestId` lets us detect duplicate retries.
- **Resume on load**: when the app boots, it checks IndexedDB for an in-flight job. If found, it shows a "Resume job?" prompt with summary (book title, last completed phase, total cost so far, last-modified timestamp). User can resume or discard.
- **Orphan detection**: any `in_flight` row whose `requestStartedAt` is more than 5 minutes old is reset to `pending` on load (no live tab can possibly own it).
- **Model / prompt pinning**: the run record stores provider, model IDs, and prompt SHAs. On resume, if any pinned value differs from the current build (e.g., we updated a prompt), warn the user and offer "Continue with new settings (may produce inconsistent style)" vs. "Restart from <last clean phase>."
- **Multi-day interruption**: IndexedDB is durable; jobs survive browser close and OS reboot. The only thing that breaks resumability is the user clearing site data.
- **Cost ledger** is part of resume state. The cost meter never restarts from zero on resume.
- **Memory budget guardrail**: a `performance.memory.usedJSHeapSize` check (where available) emits a warning if the heap crosses a soft threshold; the orchestrator can spill the current section's working set to IndexedDB to recover.

State Machine:
```
IDLE
 → INTAKE (validate, classify, cost estimate, save raw file Blob)
 → ROUTE_SELECTION
 → [route].phases (with section-level checkpoints throughout)
 → DONE | CANCELLED | ERROR_RECOVERY
```

---

## Cost & Safety

- **Reservation-based cost meter.** `[REV]` Before dispatch, reserve estimated cost. Refund delta on completion. Hard-stop dispatch (not just pause) when reserved + billed > ceiling.
- **Soft warnings at 50% and 80%** of ceiling.
- **Per-phase cost breakdown** in the UI, not just running total.
- **Rate-limit awareness**: parse `anthropic-ratelimit-*` and OpenAI `x-ratelimit-*` headers; token-bucket-style backoff, not just 429-reactive.
- **Default concurrency = 2**, user-tunable with a warning.
- **API key exposure warning** explicit in intake: "browser extensions can read this key — use a scoped, spending-capped key."
- **Prompt-injection defense** (`safety.ts`): wrap all book-derived text in `<book_content>...</book_content>` with explicit instruction to treat it as untrusted data; strip control characters from extracted text.
- **Run record includes** model version + prompt hash so resumed jobs never silently mix decisions made by different models/prompts.

---

## UI / UX

**Aesthetic:** parchment palette, deep ink, gold accents. Garamond family. Subtle paper-grain texture overlay at ≤8% opacity. Illuminated drop-caps reserved for the cover + result screen only — *not* on every heading (`[REV]` — first draft over-decorated).

**Three big animation moments only** (`[REV]`):
1. **Cover-open** on "Begin."
2. **Section-grid fill** during phases A+B (cards flip from blank to filled).
3. **Binding** at the end of phase D (sections converge into a closing-book animation).
Everything else: quiet tint shifts, badge fades, subtle motion.

**Pipeline view:** vertical scroll parchment. Phase headings light up sequentially. Section grid is the primary live-status surface. Decision badges use *shape + color* (gold disc = KEEP_FULL, amber square = PARTIAL, ink diamond = BRACKET, faded outline = DROP) so colorblind users can distinguish.

**Always-on status:**
- Top ribbon: current phase + % + cost-so-far + cost-cap.
- Right pane: live preview of reconstructed chapters.
- Pause / Resume / Stop buttons; "tweak aggressiveness mid-run" disclosure.

**Failure handling:** any phase failure shows an in-place card with the offending section + Retry/Skip buttons. The run does not die.

**Accessibility:** `[REV]`
- `prefers-reduced-motion` honored everywhere (springs/3D downgrade to fades).
- High-contrast / sans-serif theme toggle.
- 16px minimum body, WCAG AA contrast (parchment+ink validated at ~9:1).
- Texture overlay ≤8% so contrast holds.
- Keyboard navigation through the section grid.
- ARIA-live regions for phase transitions, cost updates, errors.
- Decision badges have shape *and* color.
- Visible model identity on each card ("Haiku decided this" / "Sonnet decided this").

**Mobile:** hard-blocked. Below the tablet breakpoint (or detected mobile UA), the app shows a single full-screen message: "The Abridger is designed for desktop — please return on a laptop or desktop." No degraded mode in v1. The reasons (memory, parallel API calls, multi-hour jobs) make a real mobile experience untenable; gating cleanly is better than half-working.

---

## Default Models Per Phase

The `src/llm/client.ts` facade abstracts a small set of **roles** (`cheap`, `smart`, `reasoning`) and maps them to provider-specific IDs based on the auto-detected provider. The role-to-model mapping is the same across phases regardless of which provider's key the user supplied.

| Phase | Role | Anthropic | OpenAI |
|---|---|---|---|
| A — Structural detection | `cheap` | **Claude Haiku 4.5** | **gpt-4o-mini** |
| A.5 — Canonical passages | `cheap` | Claude Haiku 4.5 | gpt-4o-mini |
| B — Section summaries | `smart` | **Claude Sonnet 4.6** | **gpt-4o** |
| B.5 — Narrative spine | `smart` | Claude Sonnet 4.6 | gpt-4o |
| C1 — Macro filter | `reasoning` | **Claude Opus 4.7** | **o1** (or `o3` if available in user's account) |
| C1.5 — Sanity pass | `reasoning` | Claude Opus 4.7 | o1 |
| C2 — Micro filter | `smart` | **Claude Sonnet 4.6** | **gpt-4o** |
| Bracket-writer | `smart` | Claude Sonnet 4.6 | gpt-4o |

Rationale for OpenAI equivalents:
- **`cheap` → `gpt-4o-mini`**: matches Haiku's price/latency/quality profile; very capable on structured-output tasks like boundary detection.
- **`smart` → `gpt-4o`**: comparable to Sonnet on generative and analytical tasks, captures author voice well, structured-output friendly.
- **`reasoning` → `o1`**: the macro filter is a deeply structured reasoning task across many sections with dependencies — exactly what o1 is built for. Higher latency and cost than `gpt-4o` (matching Opus's profile). If the user's account has access to `o3` / `o3-mini`, the client.ts facade prefers `o3` for `reasoning` and `o3-mini` as a cheaper fallback (detected via a one-time `models.list`).

User can override any phase's model in a "Models" panel in settings — both per-role (change all `smart` calls to `gpt-4o-mini`) and per-phase (override just C1 to use a specific model). Settings panel shows live cost-per-call deltas as the user picks alternatives.

---

## Prompt Engineering Notes

Each prompt file in `src/llm/prompts/` is markdown with YAML front-matter (`model`, `temperature`, `responseFormat`). Loaded at build time.

**Cross-cutting rules in every prompt:**
- "ABRIDGE, do not summarize. The reader should still be able to claim they read the book."
- "Preserve all proper nouns, dates, numerical claims, and direct quotes."
- "If a passage is widely cited or anthologized, keep it even if tangential to the reader's purpose."
- "If uncertain whether to drop, KEEP." (asymmetric loss)
- "Preserve the author's voice and rhetorical voice. Bridge text must not feel encyclopedic."
- Continuity dependencies are **bidirectional**.

**Untrusted-input wrapper:** all book content goes inside `<book_content>...</book_content>` with a system-level instruction that any imperatives inside are part of the book, not instructions.

---

## Edge Cases (consolidated, with handling)

- **Scanned PDF / no text layer** → refuse at intake; future-feature: Tesseract OCR.
- **DRM EPUB (`META-INF/encryption.xml`)** → clean refusal.
- **Adobe ADEPT-encrypted EPUB** (unzips but garbled XHTML) → detect via encryption.xml + content sniff.
- **Password-protected PDF** → prompt user for password (pdf.js supports).
- **PDF with hostile JS / XFA forms** → wrap parser in try/catch; refuse non-standard PDFs.
- **EPUB 2 vs 3** → branch parser based on `<package version="...">`.
- **No-chapter books / wrong TOC / missing TOC** → `no-chapter-book` route or LLM-derived structure.
- **Short books** → `short-book` route, single whole-book prompt.
- **Very long books** → `long-book` route, hierarchical macro.
- **Poetry / verse** → `protected` blocks; keep-whole or drop-whole only.
- **Equations / code** → `protected` blocks.
- **Tables, figures, captions, maps, dramatis personae** → `protected` by default.
- **Footnotes / endnotes** → tagged as `footnote` block class; micro filter handles with higher drop-rate default; massive endnote sections flagged for user confirmation before wholesale drop.
- **Footnote anchor orphaning** → preflight strips superscript anchors when the note is dropped.
- **Internal PDF links / outline destinations** → outline + `/Dest` references rewritten after page deletion in overlay mode.
- **Multi-column PDFs** → sort blocks by column-x then top-y; never overlay across columns in opt-in mode.
- **Translator's apparatus** → user opts at intake: keep / abridge with body / drop.
- **RTL / non-Latin scripts** → v1 = LTR Latin/Cyrillic/Greek; warn otherwise.
- **Memory ceiling on huge PDFs** → release pdfjs page proxies after text extraction; never retain rendered images.
- **Bracket overflow on PDF reflow** → bracket text typeset like any other block, no overflow issue (this is why default is reflow, not overlay).
- **Models with mismatched tokenizers** → use Anthropic's `count_tokens` endpoint for Claude, `tiktoken` for OpenAI.
- **Rate-limit storms** → token-bucket backoff from response headers.
- **Cost race on parallel calls** → reservation-based ceiling.
- **Prompt injection from book content** → wrapped untrusted-input pattern + control-char strip.
- **Resume with stale model/prompt** → pinned in run record, mismatch warns.
- **Encrypted-but-not-DRM PDFs** → password prompt.
- **Recursive bracket overflow** (rare: model writes a 4-page bracket) → cap bracket-writer max-output by C1 verdict; truncate + warn if exceeded.

---

## Verification

- **Unit tests** (Vitest):
  - Each phase function with fixture inputs and a mocked provider that returns canned JSON.
  - PDF reflow output structure (golden test against a small fixture).
  - EPUB DOM mutation correctness.
  - Ledger formatting.
  - Reservation-based cost ceiling.
  - Route detection (short / normal / long / no-chapter).
- **Dry-run mock provider**: deterministic provider that exercises the full UI/pipeline without spending real money. Same toggle is the dev story.
- **Manual end-to-end** on:
  - A short Project Gutenberg EPUB (e.g., a novella).
  - A medium public-domain academic PDF (~200pp).
  - A no-chapter novel.
  - A long classic (~700pp) — only if budget allows; the canonical test.
- **Browser smoke** on the deployed gh-pages URL once live.
- **Accessibility audit**: axe-core run on the result screen + pipeline view.

---

## Implementation Phases (execution order)

1. **Scaffold.** Vite + React + TS + Tailwind. Layout shell. Write `INIT_PROMPT.md` (verbatim from the conversation) + `README.md`. Configure GitHub Actions deploy.
2. **Parsers.** `pdf-parser.ts` (with block classification), `epub-parser.ts` (EPUB 2/3 branch, encryption check), `protected-blocks.ts`, `frontmatter.ts`. Fixture tests.
3. **LLM facade + safety + rate limiting.** Provider-agnostic client; reservation-based cost meter; token-bucket rate handling; book-content sanitization; mock provider for tests.
4. **Phases A, A.5, B, B.5 end-to-end against fixture** (CLI-style, dump intermediate JSON).
5. **Phases C1, C1.5, C2 end-to-end against fixture**, including hierarchical mode for long-book route.
6. **Bracket-writer + Phase D EPUB path.** Eyeball output in a reader.
7. **Phase D PDF reflow path.** The hard one. Validate against fixture; iterate on visual quality.
8. **Ledger generator.**
9. **State persistence + resume + orphan detection.** Build this *early* — it's load-bearing.
10. **Live preview pane.**
11. **Routes** (`short-book`, `long-book`, `no-chapter-book`).
12. **UI shell + ancient-library theme + 3 animation set pieces.** Reduced-motion + high-contrast toggles. Mobile hard-block.
13. **Cost meter UI, soft warnings, model identity badges.**
14. **Deploy to gh-pages.** Smoke test on the live URL.
15. **Docs.** README with screenshots, model recommendations, expected costs, accessibility notes.

---

## Critical Files (where the work happens)

- `src/pipeline/orchestrator.ts` and `src/pipeline/routes/*` — the brain.
- `src/pipeline/phaseB5-spine.ts` and `src/llm/prompts/narrative-spine.md` — the single highest-leverage addition for output quality.
- `src/pipeline/phaseD-reconstruct/pdf-reflow.ts` and `epub.ts` — the trickiest output code.
- `src/llm/safety.ts` — prompt-injection wrapper.
- `src/llm/cost.ts` and `src/llm/ratelimit.ts` — money safety.
- `src/state/persistence.ts` — section-level state, orphan detection, pinned model/prompt versions.
- `src/parsers/protected-blocks.ts` — keeps the system from butchering poetry and equations.
- `src/components/pipeline/LivePreviewPane.tsx` and `DryRunGate.tsx` — trust UX.
- `INIT_PROMPT.md` — frozen brief (first execution step).

---

## Appendix — INIT_PROMPT.md

The first execution task is to write the user's full original brief verbatim into `INIT_PROMPT.md` at the repo root, with a short "this is the original product brief; do not modify" preamble. The source text is the user's first message in this conversation.
