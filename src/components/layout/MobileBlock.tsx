export function MobileBlock() {
  return (
    <aside
      className="mobile-block md:hidden"
      role="alert"
      aria-live="assertive"
    >
      <h1 className="mobile-block__title">The Abridger</h1>
      <p className="mobile-block__body">
        The Abridger is designed for desktop. A run can take many minutes,
        hundreds of megabytes of memory, and parallel API requests &mdash; a
        phone cannot do this honestly.
      </p>
      <p className="mobile-block__body" style={{ marginTop: '1rem' }}>
        Please return on a laptop or desktop computer.
      </p>
    </aside>
  )
}
