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
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('pdf-lib')) {
              return 'pdf-lib'
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
