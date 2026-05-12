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
