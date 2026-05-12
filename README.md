# The Abridger

An open-source AI tool that abridges PDFs and EPUBs to a reader's stated purpose while preserving the book's narrative spine, voice, famous passages, and key context. The user supplies their own Anthropic or OpenAI API key, uploads a file, and explains what they want out of the book. The system produces (1) an abridged version of the original file with `[bracketed summaries]` where content was removed and (2) a Markdown ledger describing what was cut. The goal is to *abridge*, not to summarize — the reader should still be able to say they "read" the book.

The app is client-only and runs entirely in the browser as a static site. There is no server. All LLM calls go directly from the user's browser to Anthropic or OpenAI.

## Status

**Under active construction.** The repo currently contains the project scaffold; the pipeline, parsers, LLM facade, and UI shell land in subsequent build waves.

The full implementation plan lives at [`docs/PLAN.md`](docs/PLAN.md). The original product brief is preserved verbatim at [`INIT_PROMPT.md`](INIT_PROMPT.md).

## Quick Start

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

## Tech Stack

- **Build / framework**: Vite + React + TypeScript
- **Styling**: Tailwind CSS with an ancient-library theme (parchment, ink, gilt)
- **Animation**: [`motion`](https://motion.dev) (motion.dev)
- **PDF parsing**: `pdfjs-dist`
- **PDF generation**: `@react-pdf/renderer` (plus `pdf-lib` utilities)
- **EPUB**: `jszip` + DOM parsing
- **LLM SDKs**: `@anthropic-ai/sdk` and `openai`, both with `dangerouslyAllowBrowser: true`
- **State**: Zustand + IndexedDB (`idb`)
- **Validation**: Zod
- **Tests**: Vitest

## Deployment

The site is deployed to GitHub Pages at **https://willyd332.github.io/Abridger/** via the workflow in `.github/workflows/deploy.yml`. Pushes to `main` build the static `dist/` output and publish it to the `gh-pages` branch.

The Vite `base` is set to `/Abridger/`, matching the GitHub Pages path.

## API Key Security

The Abridger asks for your Anthropic or OpenAI API key in the browser. **Any browser extension you have installed can read this key.** We strongly recommend:

- Use a **scoped, spending-capped** key for this tool.
- Default to **session-only** memory (the app's setting). Opting into `localStorage` storage is more convenient but more exposed.
- Rotate the key if you ever suspect it's been seen.

There is no Abridger server. Your key never touches our infrastructure, because we don't have any.

## Mobile

The Abridger is **desktop-only by design**. Memory ceilings on large PDFs, parallel LLM dispatch, and multi-hour jobs make a real mobile experience untenable. Below the tablet breakpoint the app shows a single "please return on desktop" screen.

## License

MIT — see [`LICENSE`](LICENSE).
