export type LimitFn = <T>(task: () => Promise<T>) => Promise<T>

export function createLimit(max: number): LimitFn {
  if (!Number.isFinite(max) || max < 1) {
    throw new Error(`createLimit requires a positive concurrency, got ${max}`)
  }
  let active = 0
  const queue: Array<() => void> = []

  const next = (): void => {
    if (active >= max) return
    const run = queue.shift()
    if (!run) return
    active += 1
    run()
  }

  return <T>(task: () => Promise<T>): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      const start = (): void => {
        Promise.resolve()
          .then(task)
          .then(
            (value) => {
              active -= 1
              resolve(value)
              next()
            },
            (err) => {
              active -= 1
              reject(err instanceof Error ? err : new Error(String(err)))
              next()
            },
          )
      }
      queue.push(start)
      next()
    })
}

export async function mapWithLimit<T, R>(
  items: ReadonlyArray<T>,
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const run = createLimit(limit)
  return Promise.all(items.map((item, index) => run(() => fn(item, index))))
}
