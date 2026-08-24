/**
 * A tiny async FIFO queue. Used to feed a sequence of commands (sendAI,
 * downloadFig, close, ...) into a single long-running puppeteer-cluster task
 * so one browser page/context can be reused across multiple calls instead of
 * being torn down after each one.
 */
export class AsyncQueue<T> {
  private readonly buffer: T[] = []
  private readonly waiters: Array<{
    resolve: (value: T) => void
    reject: (error: Error) => void
  }> = []
  private closed = false
  private failure: Error | null = null

  push(value: T): void {
    if (this.closed) {
      throw this.failure ?? new Error('Cannot push to a closed AsyncQueue')
    }
    const waiter = this.waiters.shift()
    if (waiter) {
      waiter.resolve(value)
      return
    }
    this.buffer.push(value)
  }

  async next(): Promise<T> {
    const value = this.buffer.shift()
    if (value !== undefined) return value
    if (this.closed) throw this.failure ?? new Error('AsyncQueue closed')
    return new Promise<T>((resolve, reject) => {
      this.waiters.push({ resolve, reject })
    })
  }

  close(): void {
    this.closed = true
    const error = this.failure ?? new Error('AsyncQueue closed')
    for (const waiter of this.waiters.splice(0)) waiter.reject(error)
  }

  fail(error: Error, rejectBuffered: (value: T, error: Error) => void): void {
    if (this.closed) return
    this.failure = error
    this.closed = true
    for (const value of this.buffer.splice(0)) rejectBuffered(value, error)
    for (const waiter of this.waiters.splice(0)) waiter.reject(error)
  }
}
