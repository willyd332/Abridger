import { useEffect, useState, type CSSProperties } from 'react'

const MOTION_QUERY = '(prefers-reduced-motion: reduce)'

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState<boolean>(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false
    return window.matchMedia(MOTION_QUERY).matches
  })

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const media = window.matchMedia(MOTION_QUERY)
    const handler = (event: MediaQueryListEvent) => setReduced(event.matches)
    media.addEventListener('change', handler)
    return () => media.removeEventListener('change', handler)
  }, [])

  return reduced
}

export type HighContrastMode = 'ancient' | 'high-contrast'

const HC_STORAGE_KEY = 'abridger.theme'
const HC_CLASS = 'theme-high-contrast'

export function readStoredTheme(): HighContrastMode {
  if (typeof window === 'undefined') return 'ancient'
  try {
    const stored = window.localStorage.getItem(HC_STORAGE_KEY)
    return stored === 'high-contrast' ? 'high-contrast' : 'ancient'
  } catch {
    return 'ancient'
  }
}

export function writeStoredTheme(mode: HighContrastMode): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(HC_STORAGE_KEY, mode)
  } catch {
    // localStorage may be unavailable (private mode); silently ignore
  }
}

export function applyThemeToDocument(mode: HighContrastMode): void {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  if (mode === 'high-contrast') {
    root.classList.add(HC_CLASS)
  } else {
    root.classList.remove(HC_CLASS)
  }
}

export function ariaLiveProps(politeness: 'polite' | 'assertive' = 'polite') {
  return {
    role: 'status' as const,
    'aria-live': politeness,
    'aria-atomic': true,
  }
}

export function visuallyHiddenStyle(): CSSProperties {
  return {
    position: 'absolute',
    width: 1,
    height: 1,
    padding: 0,
    margin: -1,
    overflow: 'hidden',
    clip: 'rect(0,0,0,0)',
    whiteSpace: 'nowrap',
    border: 0,
  }
}
