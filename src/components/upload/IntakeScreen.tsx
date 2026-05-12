import { useCallback, useMemo, useState } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Pill } from '@/components/ui/Pill'
import { ApiKeyInput } from '@/components/upload/ApiKeyInput'
import type { ProviderId } from '@/lib/provider-detect'
import { FileDropzone } from '@/components/upload/FileDropzone'
import { PurposePrompt } from '@/components/upload/PurposePrompt'
import {
  fadeInTransition,
  fadeInVariants,
  intakeStaggerTransition,
} from '@/lib/motion-presets'

export interface IntakeParams {
  file: File
  key: string
  provider: 'anthropic' | 'openai'
  purpose: string
  storeKeyLocally: boolean
}

interface IntakeScreenProps {
  onBegin: (params: IntakeParams) => void
}

const MIN_PURPOSE_CHARS = 12

export function IntakeScreen({ onBegin }: IntakeScreenProps) {
  const [file, setFile] = useState<File | null>(null)
  const [apiKey, setApiKey] = useState('')
  const [provider, setProvider] = useState<ProviderId>('unknown')
  const [storeKeyLocally, setStoreKeyLocally] = useState(false)
  const [purpose, setPurpose] = useState('')
  const reduced = useReducedMotion()

  const purposeValid = purpose.trim().length >= MIN_PURPOSE_CHARS
  const keyValid = provider === 'anthropic' || provider === 'openai'
  const fileValid = file !== null
  const allValid = purposeValid && keyValid && fileValid

  const missingHints = useMemo(() => {
    const items: string[] = []
    if (!fileValid) items.push('a book')
    if (!keyValid) items.push('a recognized API key')
    if (!purposeValid) items.push('a reading purpose')
    return items
  }, [fileValid, keyValid, purposeValid])

  const handleBegin = useCallback(() => {
    if (!allValid || !file) return
    if (provider !== 'anthropic' && provider !== 'openai') return
    onBegin({
      file,
      key: apiKey.trim(),
      provider,
      purpose: purpose.trim(),
      storeKeyLocally,
    })
  }, [allValid, apiKey, file, onBegin, provider, purpose, storeKeyLocally])

  return (
    <motion.div
      initial={reduced ? false : 'hidden'}
      animate="visible"
      transition={intakeStaggerTransition}
      style={{ display: 'flex', flexDirection: 'column' }}
    >
      <motion.header
        variants={fadeInVariants}
        transition={fadeInTransition}
        style={{ marginBottom: '0.25rem' }}
      >
        <h2
          style={{
            fontSize: '1.6rem',
            fontWeight: 600,
            letterSpacing: '0.03em',
            color: 'var(--shell-ink)',
            margin: 0,
          }}
        >
          The triptych
        </h2>
        <p
          style={{
            fontStyle: 'italic',
            color: 'var(--shell-ink-soft)',
            marginTop: '0.35rem',
            maxWidth: '38rem',
          }}
        >
          Three pieces and the press is ready: the book, the key, and the
          purpose for which you are reading.
        </p>
      </motion.header>

      <motion.div className="triptych" variants={fadeInVariants} transition={fadeInTransition}>
        <Card title="The book" hint="PDF or EPUB. We never upload it anywhere.">
          <FileDropzone file={file} onFile={setFile} />
        </Card>

        <Card title="The key" hint="Anthropic or OpenAI. Provider is auto-detected.">
          <ApiKeyInput
            apiKey={apiKey}
            storeLocally={storeKeyLocally}
            onApiKeyChange={setApiKey}
            onStoreLocallyChange={setStoreKeyLocally}
            onProviderChange={setProvider}
          />
        </Card>

        <Card title="The purpose" hint="Tell the Abridger why you are reading.">
          <PurposePrompt value={purpose} onChange={setPurpose} />
        </Card>
      </motion.div>

      <motion.div
        variants={fadeInVariants}
        transition={fadeInTransition}
        style={{
          marginTop: '1.75rem',
          display: 'flex',
          flexWrap: 'wrap',
          gap: '1rem',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <div
          aria-live="polite"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.6rem',
            flexWrap: 'wrap',
          }}
        >
          <Pill tone="muted">Estimated cost: $—</Pill>
          <span
            style={{
              fontSize: '0.85rem',
              fontStyle: 'italic',
              color: 'var(--shell-ink-faint)',
            }}
          >
            A real estimate appears once the press warms.
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.9rem' }}>
          {missingHints.length > 0 ? (
            <span
              role="status"
              aria-live="polite"
              style={{
                fontSize: '0.85rem',
                fontStyle: 'italic',
                color: 'var(--shell-ink-faint)',
              }}
            >
              Still needed: {missingHints.join(', ')}.
            </span>
          ) : null}
          <Button
            onClick={handleBegin}
            disabled={!allValid}
            glow={allValid}
            flicker={allValid}
            aria-label="Begin the abridgement"
          >
            Begin Abridgement
          </Button>
        </div>
      </motion.div>
    </motion.div>
  )
}
