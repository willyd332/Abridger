import { useCallback, useEffect, useState } from 'react'
import {
  applyThemeToDocument,
  readStoredTheme,
  writeStoredTheme,
  type HighContrastMode,
} from '@/lib/a11y'

export function ThemeToggle() {
  const [mode, setMode] = useState<HighContrastMode>('ancient')

  useEffect(() => {
    const stored = readStoredTheme()
    setMode(stored)
    applyThemeToDocument(stored)
  }, [])

  const toggle = useCallback(() => {
    setMode((prev) => {
      const next: HighContrastMode = prev === 'ancient' ? 'high-contrast' : 'ancient'
      applyThemeToDocument(next)
      writeStoredTheme(next)
      return next
    })
  }, [])

  const isHC = mode === 'high-contrast'

  return (
    <button
      type="button"
      onClick={toggle}
      className="gilt-button gilt-button--ghost"
      aria-pressed={isHC}
      aria-label={
        isHC
          ? 'Switch to ancient-library theme'
          : 'Switch to high-contrast sans-serif theme'
      }
    >
      {isHC ? 'Ancient theme' : 'High-contrast theme'}
    </button>
  )
}
