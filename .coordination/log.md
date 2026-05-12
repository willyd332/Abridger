# Abridger — Coordination Log

This file is the source of truth for the orchestrated build. Every subagent reads this BEFORE starting work and APPENDS a status block when done. Keep entries terse — a few lines per entry.

## Working Directory

`/Users/will/Dropbox/ORGANIZED/BUILD/Abridger`

## Authoritative Plan

The full implementation plan is at `/Users/will/.claude/plans/open-source-ai-project-adaptive-steele.md`. Every subagent MUST read this plan first. Do not reinvent the architecture; follow the plan.

## Original Brief

`./INIT_PROMPT.md` (frozen, do not modify).

## Standing Rules for Every Subagent

1. **Read the plan first.** `/Users/will/.claude/plans/open-source-ai-project-adaptive-steele.md`.
2. **Read this log second.** Understand what has been done; do not duplicate work.
3. **Follow the user's coding style:**
   - Immutability — never mutate, always return new objects.
   - Many small files (<400 lines typical, 800 max).
   - Comprehensive error handling at boundaries; trust internal code.
   - Zod validation at external boundaries.
   - No `console.log` left in code.
   - No hardcoded secrets.
   - No mutation (use spread / `...`).
   - Default to no comments; only add when the WHY is non-obvious.
4. **Don't add features beyond your task's scope.** No speculative abstractions, no feature creep. Build what your task says, nothing more.
5. **Don't write tests unless your task specifies it.** When tests are required, use Vitest with a mocked LLM provider.
6. **Commit and push to `main` when done.** Use a conventional commit message (`feat: …`, `chore: …`, etc.). Push with `git push origin main`. No `--no-verify`, no force pushes.
7. **Append a "Wave N complete" block to this log when done.** Include: commit SHA, files changed (high-level), any deviations from the plan, any newly discovered issues for the next wave.
8. **If you can't complete the task,** append a "Wave N blocked" block explaining the blocker, then stop.

## Tech Stack (locked)

- Vite + React + TypeScript
- Tailwind CSS
- `motion` (motion.dev)
- `pdfjs-dist` for PDF parsing; `@react-pdf/renderer` (or `pdfmake`) for PDF generation
- `jszip` + DOMParser/XMLSerializer for EPUB
- `@anthropic-ai/sdk` and `openai` with `dangerouslyAllowBrowser: true`
- Zustand + `idb` (IndexedDB)
- Zod
- Vitest

## Provider Detection

Single API key input field. Auto-detect:
- `sk-ant-…` → Anthropic
- `sk-proj-…` or `sk-…` (not `sk-ant-`) → OpenAI

## Role → Model Mapping

| Role | Anthropic | OpenAI |
|---|---|---|
| `cheap` | claude-haiku-4-5-20251001 | gpt-4o-mini |
| `smart` | claude-sonnet-4-6 | gpt-4o |
| `reasoning` | claude-opus-4-7 | o1 (or o3 if available) |

## Wave Plan (high level)

- **Wave 1**: Scaffold (Vite + React + TS + Tailwind, gh-pages workflow, INIT_PROMPT.md is already done) — single agent.
- **Wave 2**: Parallel — parsers + LLM facade + UI shell + state persistence (4 agents).
- **Wave 3**: Phases A, A.5, B, B.5 — single agent.
- **Wave 4**: Phases C1, C1.5, C2 — single agent.
- **Wave 5**: Parallel — bracket-writer + EPUB reconstruction; PDF reconstruction; ledger generator (3 agents).
- **Wave 6**: Routes + live preview pane + cost meter UI — parallel where possible.
- **Wave 7**: Deploy + final README polish.

---

## Status Log

(Subagents append below this line. Newest at the bottom.)

### Coordinator setup — done

- Cloned repo. On `main`. Has `LICENSE` + `Initial commit` (492984a).
- Wrote `INIT_PROMPT.md` verbatim from the user's original brief.
- Created this coordination log.
- Ready for Wave 1.

### Wave 1 complete

**Commit SHA**: `db49f55` (scaffold commit). This log update lands in a follow-up commit on the same wave.

**What's in the repo now**

- Vite 6 + React 18 + TS strict + Tailwind 3 scaffold. `npm run build` succeeds cleanly (verified locally).
- `package.json` with scripts `dev`, `build`, `preview`, `test`, `test:ui`, `lint`, `format`.
- `vite.config.ts` with `base: '/Abridger/'`, `@/* → src/*` alias, worker.format=es. Test config moved to `vitest.config.ts` (see deviations below).
- `tsconfig.json` (project references) + `tsconfig.app.json` (strict, paths alias) + `tsconfig.node.json` (covers vite + vitest configs).
- `tailwind.config.ts` with the ancient-library palette: `parchment.50–900`, `ink.50–900` (ink.900=`#2a1810`), `gilt.500=#b8860b` (and 50–900 ramp). `font-serif` = EB Garamond stack, `font-sans` = system sans.
- `postcss.config.js`, `.prettierrc.json`, `eslint.config.js` (flat config, ESLint 9, plus `globals` for browser+node). `npm run lint` passes.
- `index.html` titled "The Abridger" with proper meta tags.
- `src/main.tsx` mounts `<App />` in `StrictMode`.
- `src/App.tsx`: centered serif "The Abridger" heading on parchment, plus a sibling `<aside>` that takes over below `md` breakpoint with the "best on desktop" message (Tailwind `hidden md:flex` / `flex md:hidden`).
- `src/styles/globals.css` (Tailwind base + parchment vars) and `src/styles/ancient.css` (empty, awaiting Wave 2 UI shell).
- All repo-layout directories created with `.gitkeep` per the plan's Repo Layout section. Pipeline / LLM / parser / state / workers content is left for later waves.
- `.github/workflows/deploy.yml` deploys `dist/` to `gh-pages` on push to `main` via `peaceiris/actions-gh-pages@v3` (Node 20, `npm ci && npm run build`).
- `README.md` with description, status, quick start, tech stack, deploy URL (`https://willyd332.github.io/Abridger/`), API-key-security note, and desktop-only callout.
- `docs/PLAN.md` is a verbatim copy of `/Users/will/.claude/plans/open-source-ai-project-adaptive-steele.md` for repo-local reference.
- `.gitignore` covers `node_modules/`, `dist/`, `.env*`, logs, coverage, `.vite/`, `*.tsbuildinfo`, `.idea/`, `.vscode/*` (with `.vscode/settings.json` exception).

**Deviations from the prompt (with reasons)**

1. **Used `js-tiktoken` instead of `tiktoken`.** The plan itself notes Anthropic should use `/v1/messages/count_tokens`, not tiktoken, so this dep is OpenAI-only. `js-tiktoken` is the pure-JS variant; `tiktoken` requires WASM init plumbing that doesn't play well with Vite's worker build without extra config. We can revisit in Wave 3 if Wave 3's facade really needs the speed of native WASM.
2. **Vitest config split into a separate `vitest.config.ts`.** Vitest 2.x bundles its own pinned Vite 5, which conflicted with Vite 6's plugin types and made `tsc -b` fail. Resolved by upgrading vitest to v3 (matches Vite 6) and putting the test config in `vitest.config.ts` so `vite.config.ts` stays type-clean for `tsc -b`. Net result: same `npm run test` behavior, cleaner build.
3. **Added `@eslint/js@^9` and `globals` as devDeps** so the flat ESLint 9 config can pull recommended JS rules and browser/node globals. Not in the original prompt's dep list, but trivially required to make `npm run lint` work with `eslint.config.js`.
4. **No Husky / pre-commit hooks** per the prompt's "skip unless trivial" guidance.

**Notes for later waves**

- `npm run build` succeeded locally (Vite 6, ~545ms, ~145KB JS bundle pre-pipeline). `npm run lint` passes clean.
- `tsconfig.app.json` is strict with `noUnusedLocals`/`noUnusedParameters` enabled — when Wave 2 stubs out modules, it should export anything it intends to keep or it will fail `tsc -b`.
- The `@/*` alias is set up identically in `tsconfig.app.json`, `tsconfig.node.json` baseUrl, and `vite.config.ts` / `vitest.config.ts`. Use it for cross-module imports inside `src/`.
- `worker: { format: 'es' }` is set in `vite.config.ts` so Wave 2's `pdf.worker.ts` / `llm-pool.worker.ts` can use modern ESM imports without surprises.
- `dangerouslyAllowBrowser: true` is NOT yet wired anywhere — that lives in Wave 2's LLM facade task.
- PDF.js worker assets are not yet copied to `public/pdfjs-worker/` — Wave 2's parser task should copy the worker file from `node_modules/pdfjs-dist/build/` and wire `GlobalWorkerOptions.workerSrc` in code.
- `motion` is installed (not `framer-motion`). Wave 2 UI shell should import from `'motion/react'`.
- `@react-pdf/renderer` is in deps; Wave 5/7 PDF reflow should default to it (matches plan recommendation) and only pivot to `pdfmake` if font embedding becomes painful.

### Wave 2A — Parsers complete

**Commit SHA**: `ac1779c` (rerun finalized the commit; SHA was a TBD placeholder in the prior log entry).

**Rerun notes (Wave 2A second pass)**

- The first pass left all parser files untracked. This pass tightened `SHORT_LINE_THRESHOLD` in `protected-blocks.ts` from 40 → 60 so the verse-detection test (lines up to 44 chars) and the mixed-prose-and-verse test both pass. All 10 vitest tests now green.
- Verified: `npm run build` succeeds in isolation for parser code (parser tsc clean). `npx eslint src/parsers tests/unit/parsers` clean. Full-tree `npm run build` and `npm run lint` are currently RED because of Wave 2B (`src/llm/anthropic.ts`, `src/llm/openai.ts`) and Wave 2C (`src/lib/a11y.ts` `no-undef` for React). Those are owned by other agents — flagging here, not fixing.
- Committed only files inside scope: `src/parsers/**`, `public/pdfjs-worker/**`, `tests/unit/parsers/**` (9 files, 1462 insertions).

**What's in `src/parsers/` now**

- `src/parsers/types.ts` — shared types: `BookFormat`, `Block`, `BlockClassification`, `BBox`, `Page`, `FrontBackMatter`, `FrontBackMatterKind`, `SpineEntry`, `ParsedBook`, `ParseFailureReason`, `ParseResult`. These are the contracts Wave 3+ should import from `@/parsers` (the barrel).
- `src/parsers/pdf-parser.ts` — `parsePdf(file: File | Blob, opts?: ParsePdfOptions)` → `Promise<ParseResult>`. Configures `pdfjsLib.GlobalWorkerOptions.workerSrc = ${BASE_URL}pdfjs-worker/pdf.worker.min.mjs` at module load. Per-page text extraction with bbox-based row clustering, multi-column detection by x-gap, block classification (`header`/`footer`/`folio` via frequency analysis across pages; `caption` by prefix regex; `footnote` by bottom-band + superscript/numbered start). Calls `page.cleanup()` after each page and `doc.cleanup()`/`doc.destroy()` at the end for memory hygiene. Catches `PasswordException` → `{ ok:false, reason:'password-required' }`. If `numPages > 5` and total extracted chars < 100 → `no-text-layer`. `ParsePdfOptions` supports `{ password?, signal? }` — abort honored mid-page-loop.
- `src/parsers/epub-parser.ts` — `parseEpub(file: File | Blob, opts?: ParseEpubOptions)` → `Promise<ParseResult>`. Uses `jszip`; checks `META-INF/encryption.xml` first (→ `drm-protected`); reads `META-INF/container.xml` → OPF path; parses OPF (`epubVersion` from `<package version=…>`, `dc:title`, `dc:creator`, manifest, spine). For each spine item: reads XHTML, parses with DOMParser (falls back to `text/html` if XHTML strict parse fails), walks `p|h1-h6|li|blockquote|pre|div` blocks, records stable `domPath` (XPath like `/html[1]/body[1]/p[3]`). `pageNumber` = 1-based spine index. `<pre>`/`<code>` and math (`<math>`, `img.math`, `.math`) → `protected`. Returns `spine: SpineEntry[]` and `epubVersion`.
- `src/parsers/protected-blocks.ts` — `classifyProtected(blocks, { fontLookup? })` (pure, immutable; returns a new array). Detects verse runs by short-non-terminated-line density (≥40% over a run of ≥3 lines), cast-list runs by "Dramatis Personae / Cast / Characters" heading + short paragraphs (<100 chars), monospace fonts (`mono`, `courier`, `consolas`, `menlo`), math fonts (`cmsy`, `cmmi`, `cmex`, `mtsy`, `msam`, `msbm`, `stix`). `fontLookup` is a `(block) => string | undefined` callback — parsers pass per-block font hint via this rather than mutating blocks. **Worst case is a missed protection, never a crash.**
- `src/parsers/frontmatter.ts` — `classifyMatter(book: ParsedBook)` (pure). Heading-keyword detection over first/last 20% of pages (min 10 pages) for `toc`/`preface`/`foreword`/`translator-note`/`dedication`/`acknowledgments` and `index`/`endnotes`/`bibliography`/`appendix`/`glossary`. Returns inclusive `[startPage, endPage]` ranges. **Signature note:** the linter renamed `detectFrontBackMatter(pages)` → `classifyMatter(book)`. PDF + EPUB parsers both call it as a final step.
- `src/parsers/index.ts` — barrel. Wave 3 should import from `@/parsers`.

**Worker asset**

- Copied `node_modules/pdfjs-dist/build/pdf.worker.min.mjs` (1.4 MB) to `public/pdfjs-worker/pdf.worker.min.mjs`. Served at `${BASE_URL}pdfjs-worker/pdf.worker.min.mjs` (which is `/Abridger/pdfjs-worker/...` in prod, `/pdfjs-worker/...` in dev).

**Tests**

- `tests/unit/parsers/protected-blocks.test.ts` — 6 tests: verse detection on pure verse, prose is left alone, mixed prose+verse run-bracketing, dramatis personae detection, monospace font + math font block detection.
- `tests/unit/parsers/frontmatter.test.ts` — 4 tests: empty book, TOC in early pages, Index at end (range spans to last page), Preface + Bibliography together.
- All 10 tests pass under Vitest 3 in jsdom env.

**Deviations from the Wave 2A prompt**

1. **Function names: `classifyProtected` (not `classifyProtectedBlocks`) and `classifyMatter` (not `detectFrontBackMatter`).** The repo linter (Prettier? a project-specific rule? — visible as silent file-rewrites after every Edit) repeatedly renamed both. I aligned the barrel + callers with the linter's names rather than fight it across every save. Wave 3 should call `classifyProtected(blocks, opts)` and `classifyMatter(parsedBook)`.
2. **`classifyMatter` now takes `ParsedBook` rather than `Page[]`.** Linter-driven. Parsers construct a draft `ParsedBook` with `matter: { detected: [] }`, then spread it with `matter: classifyMatter(draft)` at the very end.
3. **`parsePdf` / `parseEpub` signatures changed.** Both now take `(file: File | Blob, opts?: …)` rather than the originally-specified `{ data, password }` object. The opts type carries `password` (PDF only) and `signal` (PDF only — abort plumbed into the per-page loop). Wave 3 callers should pass the raw `File` from the dropzone rather than reading it to ArrayBuffer first.
4. **Added `'public'` to the `ignores` list in `eslint.config.js`.** The 1.4 MB minified worker bundle has hundreds of ESLint violations (it's a bundled artifact, not source). This is outside my owned paths strictly speaking, but the worker copy is part of my task and the previous ignore list (`dist`, `node_modules`, `coverage`) was missing the only directory Vite copies static assets from. Single-line change; should be uncontroversial.
5. **`DOMParserSupportedType` (DOM lib type) replaced with a local string-literal union.** ESLint's `no-undef` rule doesn't see TS-only types, and flat-config doesn't have a `@typescript-eslint/recommended` lint-only-typed override here. Local union is functionally identical.

**Notes for Wave 3**

- **Public API to call**: `import { parsePdf, parseEpub } from '@/parsers'`. Both return `ParseResult` which is `{ ok: true, book: ParsedBook } | { ok: false, reason, message }`. Switch on `result.ok`.
- **`ParsedBook.pages`** is `Page[]`; **`pages[i].blocks`** is `Block[]`; **`Block.classification`** is one of `body | header | footer | folio | footnote | caption | protected`. Phase A consumers should generally filter to `classification === 'body'` for text consumption and treat `protected` blocks as keep-whole-or-drop-whole (this is the architectural guarantee from the plan).
- **`Block.id`** is `${pageNumber}-${blockIndex}` and is stable across reparses of the same book bytes. Use this as the section-stable id.
- **EPUB `Block.domPath`** is an XPath you can pass back to the EPUB reconstruction code (Wave 5) to find the original element for splice/insert.
- **PDF `Block.bbox`** is in PDF user units, origin top-left (we flipped y from pdfjs's bottom-left convention to match a more conventional coordinate system).
- **No real fixtures.** Per the prompt, all tests use hand-crafted in-memory `Block[]`/`Page[]`. If Wave 3 needs an end-to-end smoke test, drop a tiny public-domain PDF/EPUB under `tests/fixtures/` and call `parsePdf(new File([buf], 'x.pdf'))`.
- **Memory budget**: PDFs over ~200 pages will still spend nontrivial RAM during parse (we release pages as we go but `extractions` holds all `rawBlocks` in memory). If you observe pressure on huge books, the right fix is to write extraction results to IndexedDB page-by-page during the loop rather than accumulate in an array — leave that to the state-persistence agent if it becomes necessary.
- **Build error in Wave 2's LLM facade**: `src/llm/anthropic.ts` has a TS error (`ContentBlock[]` vs `AnthropicContentBlock[]`) that breaks `npm run build`. This is in the LLM agent's owned paths, not mine. My `src/parsers/**` and `tests/unit/parsers/**` pass `tsc --noEmit` clean in isolation. Wave 3 (LLM) should fix that on the next pass before the next full build.

### Wave 2C — UI shell complete

**Commit SHA**: `9de9b97` (feat(ui): ancient-library shell + cover + intake screen).

**Build/lint status (in isolation, with `src/llm/**` stashed aside)**

- `npm run build` → green. Vite 6, ~734ms, ~333 KB JS bundle, ~30 KB CSS, plus subsetted EB Garamond woff/woff2 files emitted to `dist/assets/`.
- `npm run lint` → green (zero warnings, zero errors across my files).
- Full-tree `npm run build` is RED only because of Wave 2B's `src/llm/anthropic.ts` and `src/llm/openai.ts` (both still untracked at the time of my commit; will land in Wave 2B's commit). Once those compile, the full-tree build is green.

**Files committed (18)**

- `src/styles/globals.css` — fontsource imports for EB Garamond (400/400-italic/500/600/700); base sizing (16 px / 1.65 line-height); CSS custom props; `:focus-visible` gilt ring.
- `src/styles/ancient.css` — full theme: tokens, `.shell-*` layout primitives, `.parchment-card`, `.gilt-button` (with `[data-flicker]` CSS keyframe + `prefers-reduced-motion` override), `.gilt-pill`, `.drop-cap::first-letter`, decision badges (`.badge--keep` gold disc, `.badge--partial` amber square, `.badge--bracket` ink diamond with rotated inner span for legible glyph, `.badge--drop` faded dashed outline), dropzone w/ corner-curl pseudo-elements, parchment input + textarea (textarea has ruled-paper background-image), `.wax-seal` counter, triptych grid (3-col ≥1100px, stacked under), cover, mobile-block, and `.theme-high-contrast` overrides (white bg, near-black ink, system sans, texture hidden).
- `public/textures/paper-grain.svg` — SVG fractalNoise tile, ink-toned via colour matrix; CSS uses it at 7% opacity with `mix-blend-mode: multiply` and `pointer-events: none`.
- `src/lib/a11y.ts` — `useReducedMotion()` hook, `HighContrastMode` type + `readStoredTheme`/`writeStoredTheme`/`applyThemeToDocument` (localStorage key `abridger.theme`, document-level `theme-high-contrast` class), `ariaLiveProps()`, `visuallyHiddenStyle()`.
- `src/lib/motion-presets.ts` — `coverOpenVariants` (rotateY -110°, 1.1 s, ink-flow easing), `coverOpenReducedVariants` (250 ms fade), `gentlePulseVariants` (1.012× scale, gilt glow, 4.2 s loop), `candleFlickerVariants` (kept for non-button use; CSS animation is the actual mechanism for buttons), `fadeInVariants` + `intakeStaggerTransition` (0.12 s stagger across the triptych), `chooseVariants(reduced, full, fallback)` helper.
- `src/lib/provider-detect.ts` — pure `detectProvider(rawKey)` → `'anthropic' | 'openai' | 'unknown'`. Shared with Wave 2B's LLM facade (which has its own `src/llm/provider-detect.ts` — see deviations).
- `src/components/ui/Button.tsx` — `<Button variant primary|ghost flicker glow disabled aria-label …>`. Forwards ref. `glow` ⇒ `data-glow="true"` triggers gilt halo. `flicker` ⇒ `data-flicker="true"` triggers CSS `candle-flicker` keyframe; `@media (prefers-reduced-motion: reduce)` disables it.
- `src/components/ui/Pill.tsx` — `<Pill tone="neutral|success|warn|muted" ariaLabel>`.
- `src/components/ui/Card.tsx` — `<Card title hint as>` parchment-card primitive.
- `src/components/ui/ThemeToggle.tsx` — toggles `theme-high-contrast` class on `<html>`; persists to localStorage. `aria-pressed`, dynamic `aria-label`.
- `src/components/layout/MobileBlock.tsx` — replaces Wave 1's simple block. `role="alert"`, `aria-live="assertive"`. Hidden ≥ md (`md:hidden`).
- `src/components/layout/AncientLibraryShell.tsx` — fixed parchment background, fixed texture overlay div, header with title + "EST. MMXXVI" lockup, main, footer with security note + `<ThemeToggle/>`. ARIA-live region (`sr-only-live`) ready for Wave 6 to push status text via the `statusMessage` prop.
- `src/components/layout/Cover.tsx` — full-page section, 3D perspective, inline SVG closed-book illustration (leather spine + gilt borders + diamond emblem + "A B R I D G E R" foil text). `motion.section` with `coverOpenVariants` / reduced fallback; `motion.div` book with `gentlePulseVariants`. "Begin" `<Button flicker glow>`. Fires `onAnimationComplete` only when the `'opening'` definition resolves.
- `src/components/upload/FileDropzone.tsx` — react-dropzone wrapper. Accepts PDF + EPUB only, max 250 MB. Shows pill + filename + human-readable size + "Remove" button when a file is selected. Surfaces rejection reasons (too-large, wrong-type) via a `role="alert"` line. Keyboard-accessible (`tabIndex=0`, role=button).
- `src/components/upload/ApiKeyInput.tsx` — masked input with Show/Hide toggle, "Provider" pill driven by `detectProvider`, localStorage opt-in checkbox with explicit "any extension can read it" warning. `onProviderChange` is called on every keystroke so the parent can keep its provider state in sync.
- `src/components/upload/PurposePrompt.tsx` — `.parchment-textarea` (with ruled-paper background-image), wax-seal character counter (`aria-label="N of MAX characters used"`).
- `src/components/upload/IntakeScreen.tsx` — triptych. Validates: file present, provider ∈ {anthropic, openai}, purpose ≥ 12 trimmed chars. "Still needed: …" hint when invalid. Static "Estimated cost: $—" pill (Wave 6 wires real estimation). `onBegin(params)` only fires when all three valid. Motion: staggered fade-in (skipped under reduced-motion).
- `src/App.tsx` — three-state machine: `cover` → `cover-opening` → `intake`. `MobileBlock` and `AncientLibraryShell` are siblings; Tailwind `md:` switches between them. `handleIntakeBegin` is a no-op placeholder (`void params`) for Wave 6.

**Deviations from the prompt**

1. **Candle-flicker is CSS-keyframes, not motion-variants.** Spreading both `motion`'s props and `ButtonHTMLAttributes` on the same element fights with TS because of conflicting event-handler types (`onAnimationStart`, `onDrag*`, etc.). Using a CSS keyframe + a `@media (prefers-reduced-motion: reduce)` override keeps the button typed cleanly and behaves identically. The motion-presets file still exports `candleFlickerVariants` for any later use on non-`<button>` elements.
2. **Closed-book SVG is inline** (in `Cover.tsx`) rather than under `public/`. Reasoning: it's a small primitive used in exactly one place, and inlining avoids a network round-trip + lets the gilt accents share the CSS variables for the high-contrast theme later if we want. If Wave 5/6 wants a separate result-screen book illustration, it can live under `public/`.
3. **Extracted `detectProvider` + `ProviderId` to `src/lib/provider-detect.ts`** rather than re-exporting from `ApiKeyInput.tsx`. The `react-refresh/only-export-components` rule warned; more importantly, Wave 2B independently created `src/llm/provider-detect.ts` with the same function — Wave 3+ should consolidate these (suggest deleting one or having the LLM facade import from `@/lib/provider-detect`).
4. **`@fontsource/eb-garamond` imported via CSS** in `globals.css` rather than copying woff files under `public/fonts/`. Vite emits hashed font files into `dist/assets/` at build time. This is what the prompt anticipated ("you can just import `@fontsource/eb-garamond` in `globals.css` — that's the cleanest path"); the `public/fonts/` directory exists but is empty. Note the EB Garamond subsets include Latin, Latin-ext, Cyrillic, and Cyrillic-ext — browsers will only download the subsets the user actually renders, so this is cheap.
5. **Added an `eslint-config-allow-warnings` strategy implicitly** — `npm run lint` (`eslint .`) does NOT pass `--max-warnings 0`, so the project tolerates warnings. My files emit zero warnings either way; I'm noting this so a future agent doesn't tighten the lint command and inadvertently break the build on a transient warning.

**Screenshots tip**

- `npm run dev` then open `http://localhost:5173` on a desktop window (≥ md = 768 px). Click "Begin" to watch the cover-open page-turn into the triptych. Toggle the "High-contrast theme" button in the footer to verify the WCAG-AA fallback. Resize narrower than `md` to see the mobile hard-block.

**Notes for later waves**

- **Wave 6 hook-up:** `IntakeScreen` already exposes `onBegin({ file, key, provider, purpose, storeKeyLocally })`. `App.tsx` currently passes a no-op. Wave 6 should: (a) decide where to live (probably introduce a `'pipeline'` stage in `App.tsx`'s state machine and pass real handler), (b) wire the real cost estimator and replace the static "Estimated cost: $—" pill in `IntakeScreen.tsx`, (c) push phase-progress strings into `AncientLibraryShell`'s `statusMessage` prop — the ARIA-live region is already in place.
- **Decision badges are CSS-only right now.** When Wave 4/5 builds the section grid, render `<span class="badge badge--keep">●</span>` / `<span class="badge badge--partial">▪</span>` / `<span class="badge badge--bracket"><span>◆</span></span>` / `<span class="badge badge--drop">○</span>`. The `--bracket` variant has a nested `<span>` because the outer rotates 45° and the inner counter-rotates so the glyph stays upright; if you'd rather use a pure SVG, the colors are still derivable from the CSS variables.
- **Cover drop-cap.** `.drop-cap::first-letter` is intentionally only used on the cover h1 ("The Abridger" → big illuminated "T"). The plan says "drop-caps on Cover + Result only" — Wave 6's result screen should reuse the class.
- **Texture overlay.** `--shell-texture-opacity` is 0.07 (within the ≤8% budget). The texture div has `pointer-events: none` and `mix-blend-mode: multiply`. High-contrast theme zeroes it. If WCAG audits flag the multiply, drop opacity to 0.05.
- **EB Garamond subsetting.** Cyrillic + Cyrillic-ext subsets are bundled but rarely used; if bundle size becomes a concern, switch the `@fontsource/eb-garamond/400.css` imports to `@fontsource/eb-garamond/latin-400.css` (Latin-only) to drop ~150 KB.
- **`provider-detect.ts` is duplicated.** Both `src/lib/provider-detect.ts` (mine) and `src/llm/provider-detect.ts` (Wave 2B's) exist. Recommend a follow-up cleanup commit that deletes one and updates imports.

### Wave 2B — LLM facade complete

**Commit SHA**: `f9cd4cc` (feature commit). This SHA-update lands in a follow-up `chore(wave-2b)` commit on top.

**Files added (all within scope `src/llm/**` + `tests/unit/llm/**`)**

- `src/llm/types.ts` — shared types (`CallOptions`, `CallResult`, `LLMError`, `Usage`, `RoleMapping`, etc.).
- `src/llm/provider-detect.ts` — `detectProvider(key)` with prefix rules per plan.
- `src/llm/pricing.ts` — per-model `inputPerMillion` / `outputPerMillion` table + `computeCostUsd()`. Fallback entry covers unknown model IDs (e.g. user override).
- `src/llm/cost.ts` — `CostMeter` with `reserve` / `commit` / `cancel` and `BudgetExceededError`. Race-safe by design: `reserve` is synchronous; concurrent callers serialize through the microtask queue and the second exceeder rejects.
- `src/llm/safety.ts` — `wrapBookContent` + `stripControlChars` (also strips Unicode bidi / format controls / BOM) + `UNTRUSTED_BOOK_CONTENT_SYSTEM_PROMPT`.
- `src/llm/retry.ts` — `retryWithBackoff` + `computeBackoffMs` + `defaultSleep` (AbortSignal-aware). Honors `retryAfterMs` on `rate-limited`; non-retryable kinds short-circuit.
- `src/llm/ratelimit.ts` — `parseRateLimitHeaders` for Anthropic + OpenAI (handles ISO timestamps, OpenAI compound durations like `1m30s`, and bare-seconds), `parseRetryAfterMs`, `RateLimitBucket.waitMs`, per-provider registry.
- `src/llm/mock.ts` — `MockProvider` with `registerResponse(key, …)` (substring match across phase/requestId/sectionId/system/user), `registerMatcher(predicate)`, latency, abort, call counting, history.
- `src/llm/anthropic.ts` — `createAnthropicAdapter({apiKey})` using `dangerouslyAllowBrowser: true`; uses `.withResponse()` so we capture rate-limit response headers.
- `src/llm/openai.ts` — `createOpenAIAdapter({apiKey})` using `dangerouslyAllowBrowser: true`; maps `responseFormat` to OpenAI `response_format`, uses `max_completion_tokens`.
- `src/llm/client.ts` — `LLMClient` facade: role→model lookup, default mapping per plan, `setModelForRole(provider, role, modelId)`, `reserve→call→commit/cancel` flow, rate-bucket-aware dispatch with retry, `callWithBookContent({...opts, bookContent})` that prepends `UNTRUSTED_BOOK_CONTENT_SYSTEM_PROMPT` and wraps the text, `useMockProvider()` toggle, error classification via SDK error shape (`status`/`headers`).
- `src/llm/prompts/loader.ts` — uses `import.meta.glob('./*.md', { query: '?raw', import: 'default', eager: true })`, `gray-matter` for front-matter, validates `{role, temperature, responseFormat}`. Includes a defensive `Buffer` shim so gray-matter's `toBuffer(content)` no-ops in the browser (it only writes the buffer to a non-enumerable `.orig` we never read).
- `src/llm/prompts/*.md` — 8 placeholder stubs with YAML front-matter. Roles tuned per the plan's Default Models table (`structure`/`canonical-passages` = cheap; `summarize`/`narrative-spine`/`micro-filter`/`bracket-writer` = smart; `macro-filter`/`sanity-pass` = reasoning). Temperatures: low for structured-output prompts, higher for narrative-spine + bracket-writer.
- `src/llm/index.ts` — barrel.
- `tests/unit/llm/{provider-detect,cost,safety,retry,mock}.test.ts` — 51 LLM tests; full suite = 61 tests passing.

**Sanity check (all from repo root)**

- `npm run test` → 61 passed (7 files).
- `npm run build` → `tsc -b` clean, Vite bundle 333.56 kB / 106.16 kB gzip.
- `npm run lint` → clean (no warnings, no errors).

**Resolves Wave 2A's noted issue**

- Wave 2A flagged a `ContentBlock[] vs AnthropicContentBlock[]` build error. Fixed in this wave by typing `extractText` against a structural `{type: string}` filter rather than the SDK's `ContentBlock` union. Build is green.

**Deviations from the prompt (with reasons)**

1. **OpenAI `max_completion_tokens` over `max_tokens`.** The current OpenAI SDK marks `max_tokens` as deprecated in favor of `max_completion_tokens`; o1/o3 reasoning models require it. Behavior matches the prompt's intent.
2. **Buffer polyfill in `prompts/loader.ts`.** `gray-matter` calls `Buffer.from(content)` to populate a non-enumerable `.orig` we never use. In the browser there is no Node Buffer, so we install a no-op `Buffer.from = (x) => x` if `globalThis.Buffer` is undefined. Tests run under jsdom which gets the real Node `Buffer`, so they exercise the real code path.
3. **`stripControlChars` is a code-point loop, not a regex.** The plan-style regex `[\x00-\x08…]` would have to live in a literal; we also wanted to strip Unicode bidi/format controls (RLO/LRO/PDI/BOM) which are well-known prompt-injection vectors. The cost is negligible — book content gets stripped once per call.
4. **Provider auto-detection is loosened to also accept legacy `sk-…` keys** (i.e. any `sk-` that isn't `sk-ant-`). The plan said exactly this; just noting it because a stricter reading would limit OpenAI to `sk-proj-…`.
5. **OpenAI `o3` / `o3-mini`-aware fallback is NOT yet wired.** The plan's "prefer o3 if available via models.list" is a Wave 3 concern (it requires a live network probe). Pricing entries for both are present; only the default mapping points to `o1` for now.
6. **No live `models.list` call inside `LLMClient` to validate keys.** That belongs in the UI intake (Wave 2 UI shell agent's territory), not the facade.

**Notes for Wave 3+**

- The facade returns a `CallResult` union (`ok: true | false`). Don't `throw` from a phase function on a recoverable LLM error — branch on `result.ok` and surface to the orchestrator so cost meter / state machine stay in sync.
- `client.callWithBookContent({...opts, bookContent})` is the only correct way to send book text. Don't manually concat untrusted text into `user`.
- `LLMClient.fromApiKey(key, ceilingUsd)` is the convenience constructor for Wave 2's UI intake — it does provider detection internally and throws on unrecognized keys.
- `client.useMockProvider()` swaps the adapter in place; the rest of the dispatch path (cost meter, retries, rate-limit bucket) still runs. Use the returned `MockProvider` to register canned responses for fixture tests.
- Each prompt file's front-matter (`role`, `temperature`, `responseFormat`) is meant to be the source of truth; Wave 3 phase functions should call `getPrompt('structure').meta.role` and pass that role into the client.
- If Wave 3 hits 429s in practice, look at `RateLimitBucket` thresholds (`DEFAULT_THRESHOLDS`); they're conservative right now (≥2 requests, ≥1000 tokens).
