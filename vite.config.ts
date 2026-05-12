import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'

export default defineConfig({
  base: '/Abridger/',
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  worker: {
    format: 'es',
  },
  build: {
    // The @react-pdf/renderer chunk (`pdf-renderer`) is ~1.5 MB unminified
    // because fontkit + pdfkit pull in a large character database. It is
    // dynamic-imported only when a PDF output is produced, so it never
    // affects the initial-load budget. We set the warning threshold above
    // its size to keep `npm run build` quiet — the budget that matters
    // (the entry chunk) stays well under 400 kB.
    chunkSizeWarningLimit: 1600,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('@react-pdf') || id.includes('fontkit') || id.includes('pdfkit')) {
              return 'pdf-renderer'
            }
            if (id.includes('@anthropic-ai/sdk')) {
              return 'anthropic-sdk'
            }
            if (id.includes('node_modules/openai')) {
              return 'openai-sdk'
            }
            if (id.includes('pdfjs-dist')) {
              return 'pdfjs'
            }
          }
          return undefined
        },
      },
    },
  },
})
