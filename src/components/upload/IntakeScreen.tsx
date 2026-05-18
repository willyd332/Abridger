import { useCallback, useMemo, useState } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import { Button } from '@/components/ui/Button'
import { ApiKeyInput } from '@/components/upload/ApiKeyInput'
import type { Provider } from '@/llm/types'
import { FileDropzone } from '@/components/upload/FileDropzone'

export interface IntakeParams {
  file: File
  key: string
  provider: 'anthropic' | 'openai'
  storeKeyLocally: boolean
  costCeiling: number
  // PDF only — the first page of the actual book content. Pages 1..(startPage-1)
  // of the uploaded PDF are treated as preamble (front matter, copyright,
  // dedication, etc.): excluded from analysis but re-attached verbatim at the
  // start of the exported PDF. Defaults to 1 (analyze everything).
  startPage?: number
}

interface IntakeScreenProps {
  onBegin: (params: IntakeParams) => void
}

const DEFAULT_CEILING = 5

export function IntakeScreen({ onBegin }: IntakeScreenProps) {
  const [file, setFile] = useState<File | null>(null)
  const [apiKey, setApiKey] = useState('')
  const [provider, setProvider] = useState<Provider | null>(null)
  const [storeKeyLocally, setStoreKeyLocally] = useState(false)
  const [ceilingText, setCeilingText] = useState(String(DEFAULT_CEILING))
  const [startPageText, setStartPageText] = useState('1')
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const reduced = useReducedMotion()

  const ceiling = Number.parseFloat(ceilingText)
  const ceilingValid = Number.isFinite(ceiling) && ceiling > 0
  const keyValid = provider === 'anthropic' || provider === 'openai'
  const fileValid = file !== null
  const isPdf =
    file !== null &&
    (file.name.toLowerCase().endsWith('.pdf') || file.type.includes('pdf'))
  const startPage = Number.parseInt(startPageText, 10)
  const startPageValid =
    !isPdf || (Number.isFinite(startPage) && startPage >= 1)
  const allValid = keyValid && fileValid && ceilingValid && startPageValid

  const missingHint = useMemo(() => {
    if (!fileValid) return 'add a book'
    if (!keyValid) return 'add an API key'
    if (!ceilingValid) return 'set a positive ceiling'
    if (!startPageValid) return 'start page must be ≥ 1'
    return null
  }, [fileValid, keyValid, ceilingValid, startPageValid])

  const handleBegin = useCallback(() => {
    if (!allValid || !file) return
    if (provider !== 'anthropic' && provider !== 'openai') return
    onBegin({
      file,
      key: apiKey.trim(),
      provider,
      storeKeyLocally,
      costCeiling: ceiling,
      startPage: isPdf ? Math.max(1, startPage) : undefined,
    })
  }, [
    allValid,
    apiKey,
    ceiling,
    file,
    isPdf,
    onBegin,
    provider,
    startPage,
    storeKeyLocally,
  ])

  return (
    <motion.div
      className="intake"
      initial={reduced ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: 'easeOut' }}
    >
      <div className="intake__field">
        <FileDropzone file={file} onFile={setFile} />
      </div>

      <div className="intake__field">
        <ApiKeyInput
          apiKey={apiKey}
          storeLocally={storeKeyLocally}
          onApiKeyChange={setApiKey}
          onStoreLocallyChange={setStoreKeyLocally}
          onProviderChange={setProvider}
        />
      </div>

      <details
        className="intake__advanced"
        open={advancedOpen}
        onToggle={(e) => setAdvancedOpen((e.target as HTMLDetailsElement).open)}
      >
        <summary>Advanced</summary>
        <label className="intake__ceiling">
          <span>Spending ceiling (USD)</span>
          <input
            type="number"
            min="0"
            step="0.5"
            value={ceilingText}
            onChange={(e) => setCeilingText(e.target.value)}
            className="parchment-input"
            aria-label="Spending ceiling in US dollars"
          />
        </label>
        {isPdf ? (
          <label className="intake__ceiling">
            <span title="PDF page that should be treated as page 1 of the book. Pages before this are preamble: excluded from analysis but re-attached verbatim at the start of the exported PDF.">
              Start page (PDF)
            </span>
            <input
              type="number"
              min="1"
              step="1"
              value={startPageText}
              onChange={(e) => setStartPageText(e.target.value)}
              className="parchment-input"
              aria-label="First PDF page treated as page 1 of the book"
            />
          </label>
        ) : null}
      </details>

      <div className="intake__actions">
        {missingHint ? (
          <span className="intake__hint" role="status" aria-live="polite">
            {missingHint}
          </span>
        ) : (
          <span />
        )}
        <Button
          onClick={handleBegin}
          disabled={!allValid}
          glow={allValid}
          flicker={allValid}
          aria-label="Begin building the ontology"
        >
          Build ontology
        </Button>
      </div>
    </motion.div>
  )
}
