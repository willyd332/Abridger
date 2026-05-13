import type { ReactNode } from 'react'
import { ThemeToggle } from '@/components/ui/ThemeToggle'
import { OPEN_WELCOME_EVENT } from '@/components/layout/WelcomeOverlay'
import { OPEN_PAST_RUNS_EVENT } from '@/components/layout/PastRunsOverlay'
import { ariaLiveProps } from '@/lib/a11y'

interface AncientLibraryShellProps {
  children: ReactNode
  statusMessage?: string
  onHome?: () => void
}

export function AncientLibraryShell({
  children,
  statusMessage,
  onHome,
}: AncientLibraryShellProps) {
  return (
    <div className="shell-page">
      <div className="shell-texture" aria-hidden="true" />
      <div className="shell-content">
        <header className="shell-header">
          <button
            type="button"
            className="shell-header__brand"
            onClick={() => onHome?.()}
            aria-label="Return to intake"
          >
            <span className="shell-header__title">The Abridger</span>
            <span className="shell-header__subtitle">
              A careful machine for the abridgement of books
            </span>
          </button>
          <div className="shell-header__meta">
            <button
              type="button"
              className="shell-header__pill"
              onClick={() => window.dispatchEvent(new CustomEvent(OPEN_PAST_RUNS_EVENT))}
              aria-label="See past runs"
              title="Past runs"
            >
              Past runs
            </button>
            <button
              type="button"
              className="shell-header__info"
              aria-label="About The Abridger"
              title="About The Abridger"
              onClick={() => window.dispatchEvent(new CustomEvent(OPEN_WELCOME_EVENT))}
            >
              ?
            </button>
          </div>
        </header>

        <main className="shell-main">
          <div {...ariaLiveProps('polite')} className="sr-only-live" aria-hidden={!statusMessage}>
            {statusMessage ?? ''}
          </div>
          {children}
        </main>

        <footer className="shell-footer">
          <p className="shell-footer__note">
            Your API key never leaves your browser. The Abridger is a
            client-only site; calls go directly from this tab to your chosen
            provider. Browser extensions can read anything on this page, so
            prefer a scoped, spending-capped key.
          </p>
          <ThemeToggle />
        </footer>
      </div>
    </div>
  )
}
