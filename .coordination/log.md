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

