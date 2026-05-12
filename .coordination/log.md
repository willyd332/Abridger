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

