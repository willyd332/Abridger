import { useEffect, useState } from 'react'
import { motion, AnimatePresence, useReducedMotion } from 'motion/react'

const STORAGE_KEY = 'abridger.welcomed.v1'
export const OPEN_WELCOME_EVENT = 'abridger:open-welcome'
const REPO_URL = 'https://github.com/willyd332/Abridger'

function hasBeenWelcomed(): boolean {
  if (typeof window === 'undefined') return true
  try {
    return window.localStorage.getItem(STORAGE_KEY) === '1'
  } catch {
    return true
  }
}

function markWelcomed(): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(STORAGE_KEY, '1')
  } catch {
    // localStorage may be unavailable (private mode, etc.); silent.
  }
}

export function WelcomeOverlay() {
  const reduced = useReducedMotion()
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!hasBeenWelcomed()) setOpen(true)
  }, [])

  useEffect(() => {
    const handler = () => setOpen(true)
    window.addEventListener(OPEN_WELCOME_EVENT, handler)
    return () => window.removeEventListener(OPEN_WELCOME_EVENT, handler)
  }, [])

  const dismiss = () => {
    markWelcomed()
    setOpen(false)
  }

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          className="welcome-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="welcome-title"
          initial={reduced ? { opacity: 0 } : { opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reduced ? 0.15 : 0.35, ease: 'easeOut' }}
          onClick={dismiss}
        >
          <motion.section
            className="welcome-overlay__card parchment-card"
            initial={reduced ? { opacity: 0 } : { opacity: 0, y: 16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.99 }}
            transition={{ duration: reduced ? 0.15 : 0.4, ease: 'easeOut' }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="welcome-title" className="welcome-overlay__title">The Abridger</h2>
            <p className="welcome-overlay__body">
              The Abridger turns long books into shorter ones using your own
              Anthropic or OpenAI API key. Upload a PDF or EPUB, tell it what
              you are trying to get out of the book, and it produces an
              abridged version. Editorial brackets stand in for what was cut,
              the way some legal textbooks compress passages they expect you
              to skim. The narrative voice, the famous arguments, and the
              spine of the reasoning all stay. You can still say you read
              the book.
            </p>
            <p className="welcome-overlay__body">
              Nothing leaves your browser except the API calls to your chosen
              provider. The book itself, your key, and the finished
              abridgement all live locally. A three-hundred-page book
              typically takes a few minutes and costs roughly one to four
              dollars, depending on the models you pick.
            </p>
            <p className="welcome-overlay__body">
              The Abridger is open source. Read the code, file an issue, or
              fork it at{' '}
              <a
                className="welcome-overlay__link"
                href={REPO_URL}
                target="_blank"
                rel="noreferrer noopener"
              >
                github.com/willyd332/Abridger
              </a>
              .
            </p>
            <div className="welcome-overlay__actions">
              <button
                type="button"
                className="gilt-button gilt-button--primary"
                onClick={dismiss}
                autoFocus
              >
                Begin
              </button>
            </div>
          </motion.section>
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}
