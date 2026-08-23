/**
 * A tiny async FIFO queue. Used to feed a sequence of commands (sendAI,
 * downloadFig, close, ...) into a single long-running puppeteer-cluster task
 * so one browser page/context can be reused across multiple calls instead of
 * being torn down after each one.
 */
export class AsyncQueue<T> {
  private readonly buffer: T[] = []
  private readonly waiters: Array<(value: T) => void> = []
  private closed = false

  push(value: T): void {
    if (this.closed) throw new Error('Cannot push to a closed AsyncQueue')
    const waiter = this.waiters.shift()
    if (waiter) {
      waiter(value)
      return
    }
    this.buffer.push(value)
  }

  async next(): Promise<T> {
    const value = this.buffer.shift()
    if (value !== undefined) return value
    if (this.closed) throw new Error('AsyncQueue closed')
    return new Promise<T>((resolve) => {
      this.waiters.push(resolve)
    })
  }

  close(): void {
    this.closed = true
    this.waiters.length = 0
  }
}
