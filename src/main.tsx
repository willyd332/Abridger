import { Buffer } from 'buffer'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles/globals.css'
import './styles/ancient.css'

// The Anthropic and OpenAI SDKs reach for the Node Buffer global at request
// time (Buffer.byteLength for content-length, Buffer.from for body framing).
// We polyfill before anything else loads.
const g = globalThis as unknown as { Buffer?: typeof Buffer; process?: { env?: Record<string, string> } }
if (typeof g.Buffer === 'undefined') {
  g.Buffer = Buffer
}
if (typeof g.process === 'undefined') {
  g.process = { env: {} }
}

const rootElement = document.getElementById('root')

if (!rootElement) {
  throw new Error('Root element #root not found in index.html')
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
