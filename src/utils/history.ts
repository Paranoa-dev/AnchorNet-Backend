/**
 * Bounded FIFO history buffer.
 *
 * Keeps at most `limit` most-recently pushed items, discarding the oldest
 * once the limit is exceeded. Used to retain a rolling window of periodic
 * snapshots (e.g. metrics) in memory without unbounded growth.
 */
export class BoundedHistory<T> {
  private readonly items: T[] = [];
  public evictedCount: number = 0;

  constructor(private readonly limit: number) {
    if (!Number.isInteger(limit) || limit <= 0) {
      throw new Error(
        `BoundedHistory limit must be a positive integer (got ${limit})`,
      );
    }
  }

  /** Appends `item`, evicting the oldest entry once over the limit. */
  push(item: T): void {
    this.items.push(item);
    if (this.items.length > this.limit) {
      this.items.shift();
      this.evictedCount++;
    }
  }

  /** Returns a snapshot copy of the buffered items, oldest first. */
  all(): T[] {
    return [...this.items];
  }

  /** Number of items currently buffered. */
  size(): number {
    return this.items.length;
  }
}
