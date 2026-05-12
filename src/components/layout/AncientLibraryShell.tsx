import type { ReactNode } from 'react'
import { ThemeToggle } from '@/components/ui/ThemeToggle'
import { ariaLiveProps } from '@/lib/a11y'

interface AncientLibraryShellProps {
  children: ReactNode
  statusMessage?: string
}

export function AncientLibraryShell({
  children,
  statusMessage,
}: AncientLibraryShellProps) {
  return (
    <div className="shell-page">
      <div className="shell-texture" aria-hidden="true" />
      <div className="shell-content">
        <header className="shell-header">
          <div>
            <div className="shell-header__title">The Abridger</div>
            <div className="shell-header__subtitle">
              A careful machine for the abridgement of books
            </div>
          </div>
          <div aria-hidden="true" style={{ fontSize: '0.85rem', letterSpacing: '0.08em' }}>
            EST. MMXXVI
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
            Your API key never leaves your browser. The Abridger is a client-only
            site &mdash; calls go directly from this tab to your chosen provider.
            Browser extensions can read anything on this page, so prefer a scoped,
            spending-capped key.
          </p>
          <ThemeToggle />
        </footer>
      </div>
    </div>
  )
}
