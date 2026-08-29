/**
 * In-memory store for liquidity entries.
 *
 * Entries are keyed by `${anchor}:${asset}` so each anchor holds at most one
 * balance per asset. This mirrors the on-chain contract's per-provider balance
 * and is swappable for a persistent indexer-backed store later.
 */

import { LiquidityEntry, Pool } from "../models/liquidity";
import { InMemoryRepository } from "./inMemoryRepository";

export class LiquidityRepository extends InMemoryRepository<string, LiquidityEntry> {
  private static key(anchor: string, asset: string): string {
    return `${anchor}:${asset}`;
  }

  /** Returns the entry for an anchor/asset pair, or `undefined`. */
  get(anchor: string, asset: string): LiquidityEntry | undefined {
    return this.getByKey(LiquidityRepository.key(anchor, asset));
  }

  /** Inserts or replaces an entry. */
  upsert(entry: LiquidityEntry): LiquidityEntry {
    return this.upsertByKey(LiquidityRepository.key(entry.anchor, entry.asset), entry);
  }

  /** Removes an entry, returning `true` if one existed. */
  remove(anchor: string, asset: string): boolean {
    return this.removeByKey(LiquidityRepository.key(anchor, asset));
  }

  /** Returns all entries for a given asset. */
  byAsset(asset: string): LiquidityEntry[] {
    return this.listAll().filter((e) => e.asset === asset);
  }

  /** Returns all entries for a given anchor. */
  byAnchor(anchor: string): LiquidityEntry[] {
    return this.listAll().filter((e) => e.anchor === anchor);
  }

  /** Returns every stored entry. */
  all(): LiquidityEntry[] {
    return this.listAll();
  }

  /** Aggregates all entries into one {@link Pool} per asset. */
  pools(): Pool[] {
    const totals = new Map<string, Pool>();
    for (const entry of this.listAll()) {
      const pool = totals.get(entry.asset) ?? {
        asset: entry.asset,
        total: 0n,
        anchors: 0,
        lastUpdated: entry.updatedAt,
      };
      pool.total += entry.amount;
      pool.anchors += 1;
      if (!pool.lastUpdated || entry.updatedAt > pool.lastUpdated) {
        pool.lastUpdated = entry.updatedAt;
      }
      totals.set(entry.asset, pool);
    }
    return [...totals.values()];
  }

  /** Removes every entry. Primarily used by tests. */
  clear(): void {
    this.clearAll();
  }
}
