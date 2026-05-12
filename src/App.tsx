function App() {
  return (
    <>
      <main className="hidden min-h-screen w-full flex-col items-center justify-center bg-parchment-100 text-ink-900 md:flex">
        <div className="max-w-3xl px-8 py-16 text-center">
          <h1 className="font-serif text-6xl tracking-wide text-ink-900">
            The Abridger
          </h1>
          <p className="mt-6 font-serif text-lg italic text-ink-500">
            An open-source AI tool for the careful abridgement of books.
          </p>
          <p className="mt-2 font-serif text-sm text-ink-400">
            Under construction. The scaffold builds; the press is not yet warm.
          </p>
        </div>
      </main>

      <aside className="flex min-h-screen w-full flex-col items-center justify-center bg-parchment-100 px-6 text-center text-ink-900 md:hidden">
        <h1 className="font-serif text-4xl text-ink-900">The Abridger</h1>
        <p className="mt-6 max-w-sm font-serif text-base text-ink-500">
          The Abridger is designed for desktop. Please return on a laptop or
          desktop computer.
        </p>
      </aside>
    </>
  )
}

export default App
