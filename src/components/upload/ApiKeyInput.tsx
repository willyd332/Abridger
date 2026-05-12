import { useId, useMemo, useState } from 'react'
import { Pill } from '@/components/ui/Pill'
import { detectProvider, type ProviderId } from '@/lib/provider-detect'

interface ApiKeyInputProps {
  apiKey: string
  storeLocally: boolean
  onApiKeyChange: (key: string) => void
  onStoreLocallyChange: (store: boolean) => void
  onProviderChange: (provider: ProviderId) => void
}

function providerLabel(provider: ProviderId): string {
  if (provider === 'anthropic') return 'Anthropic'
  if (provider === 'openai') return 'OpenAI'
  return 'Unrecognized'
}

export function ApiKeyInput({
  apiKey,
  storeLocally,
  onApiKeyChange,
  onStoreLocallyChange,
  onProviderChange,
}: ApiKeyInputProps) {
  const [reveal, setReveal] = useState(false)
  const inputId = useId()
  const storeId = useId()

  const provider = useMemo(() => detectProvider(apiKey), [apiKey])

  const handleChange = (value: string) => {
    onApiKeyChange(value)
    onProviderChange(detectProvider(value))
  }

  const pillTone =
    provider === 'unknown' ? 'muted' : provider === 'anthropic' ? 'success' : 'success'

  return (
    <div>
      <label
        htmlFor={inputId}
        style={{
          display: 'block',
          fontSize: '0.85rem',
          color: 'var(--shell-ink-soft)',
          marginBottom: '0.4rem',
        }}
      >
        API key
      </label>
      <div style={{ position: 'relative' }}>
        <input
          id={inputId}
          className="parchment-input"
          type={reveal ? 'text' : 'password'}
          autoComplete="off"
          spellCheck={false}
          inputMode="text"
          value={apiKey}
          placeholder="sk-ant-… or sk-…"
          onChange={(event) => handleChange(event.target.value)}
          aria-describedby={`${inputId}-help`}
          style={{ paddingRight: '4.5rem' }}
        />
        <button
          type="button"
          onClick={() => setReveal((current) => !current)}
          className="gilt-button gilt-button--ghost"
          style={{
            position: 'absolute',
            top: '50%',
            right: '0.35rem',
            transform: 'translateY(-50%)',
            padding: '0.25rem 0.55rem',
            fontSize: '0.78rem',
          }}
          aria-label={reveal ? 'Hide API key' : 'Show API key'}
        >
          {reveal ? 'Hide' : 'Show'}
        </button>
      </div>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.55rem',
          marginTop: '0.55rem',
        }}
      >
        <Pill tone={pillTone}>{providerLabel(provider)}</Pill>
        <span
          id={`${inputId}-help`}
          style={{
            fontSize: '0.82rem',
            color: 'var(--shell-ink-faint)',
            fontStyle: 'italic',
          }}
        >
          {provider === 'unknown' && apiKey.length > 0
            ? 'That prefix is unrecognized. Use an Anthropic (sk-ant-…) or OpenAI (sk-…) key.'
            : 'Detected from the key prefix.'}
        </span>
      </div>

      <div style={{ marginTop: '0.9rem', display: 'flex', alignItems: 'flex-start', gap: '0.55rem' }}>
        <input
          id={storeId}
          type="checkbox"
          checked={storeLocally}
          onChange={(event) => onStoreLocallyChange(event.target.checked)}
          aria-describedby={`${storeId}-warn`}
          style={{ marginTop: '0.25rem' }}
        />
        <label
          htmlFor={storeId}
          style={{ fontSize: '0.9rem', color: 'var(--shell-ink-soft)', lineHeight: 1.45 }}
        >
          Remember this key in localStorage for resumed jobs.
          <span
            id={`${storeId}-warn`}
            style={{
              display: 'block',
              fontStyle: 'italic',
              fontSize: '0.82rem',
              color: 'var(--shell-ink-faint)',
              marginTop: '0.2rem',
            }}
          >
            Any browser extension on this page can read localStorage. Prefer a
            scoped, spending-capped key.
          </span>
        </label>
      </div>
    </div>
  )
}
