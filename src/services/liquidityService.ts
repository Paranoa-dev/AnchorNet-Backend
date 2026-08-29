/**
 * Liquidity service.
 *
 * Owns the business rules for recording anchor liquidity and exposing
 * aggregated pool views to the routing layer.
 */

import { LiquidityRepository } from "../repositories/liquidityRepository";
import { LiquidityEntry, Pool, WithdrawalRecord } from "../models/liquidity";
import { ApiError } from "../errors/ApiError";
import { SettlementService } from "./settlementService";
import { BoundedHistory } from "../utils/history";
import {
  normalizeAsset,
  requireBigInt,
  requireString,
} from "../utils/validation";

/**
 * Maximum number of withdrawal records retained in memory. Mirrors the bounded
 * rolling-window pattern used by `routes/metrics.ts`, keeping an audit trail of
 * recent withdrawals without unbounded memory growth.
 */
const MAX_WITHDRAWAL_HISTORY = 100;

export class LiquidityService {
  private readonly withdrawalHistory = new BoundedHistory<WithdrawalRecord>(
    MAX_WITHDRAWAL_HISTORY,
  );

  constructor(
    private readonly repo: LiquidityRepository,
    private readonly settlementService?: SettlementService,
  ) {}

  /**
   * Records `amount` of liquidity from `anchor` in `asset`. If the anchor
   * already has a balance for the asset, the amounts are accumulated.
   */
  addLiquidity(input: {
    anchor: unknown;
    asset: unknown;
    amount: unknown;
  }): LiquidityEntry {
    const anchor = requireString(input.anchor, "anchor");
    const asset = normalizeAsset(input.asset);
    const amount = requireBigInt(input.amount, "amount");

    const existing = this.repo.get(anchor, asset);
    const total = (existing?.amount ?? 0n) + amount;

    return this.repo.upsert({
      anchor,
      asset,
      amount: total,
      updatedAt: new Date().toISOString(),
    });
  }

  /**
   * Withdraws `amount` of liquidity previously contributed by `anchor` in
   * `asset`, mirroring the on-chain contract's `withdraw_liquidity`. Reduces
   * the anchor's balance and removes the entry once it reaches zero. Throws
   * 404 if the anchor holds no balance in the asset, or 400
   * (`INSUFFICIENT_LIQUIDITY`) if the withdrawal exceeds the balance.
   */
  withdrawLiquidity(input: {
    anchor: unknown;
    asset: unknown;
    amount: unknown;
  }): LiquidityEntry {
    const anchor = requireString(input.anchor, "anchor");
    const asset = normalizeAsset(input.asset);
    const amount = requireBigInt(input.amount, "amount");

    const existing = this.repo.get(anchor, asset);
    if (!existing) {
      throw ApiError.notFound(
        `no liquidity balance for anchor "${anchor}" in ${asset}`,
      );
    }
    if (existing.amount < amount) {
      throw ApiError.badRequest(
        `insufficient balance for ${asset}: requested ${amount}, available ${existing.amount}`,
        "INSUFFICIENT_LIQUIDITY",
      );
    }

    // Ensure withdrawal does not exceed the liquidity available for settlements
    if (this.settlementService) {
      const available = this.settlementService.available(asset);
      if (amount > available) {
        throw ApiError.badRequest(
          `withdrawal would reduce available liquidity for ${asset} below zero: requested ${amount}, available ${available}`,
          "INSUFFICIENT_LIQUIDITY_RESERVED",
        );
      }
    }

    const remaining = existing.amount - amount;
    const updatedAt = new Date().toISOString();

    // Record the successful withdrawal for auditability BEFORE mutating state.
    this.withdrawalHistory.push({
      anchor,
      asset,
      amount,
      remainingBalance: remaining,
      timestamp: updatedAt,
    });

    if (remaining === 0n) {
      this.repo.remove(anchor, asset);
      return { anchor, asset, amount: 0n, updatedAt };
    }

    return this.repo.upsert({ anchor, asset, amount: remaining, updatedAt });
  }

  /**
   * Transfers `amount` of liquidity in `asset` from one anchor to another,
   * atomically, as a single logical operation.
   */
  transferLiquidity(input: {
    from: unknown;
    to: unknown;
    asset: unknown;
    amount: unknown;
  }): { from: LiquidityEntry; to: LiquidityEntry } {
    const from = requireString(input.from, "from");
    const to = requireString(input.to, "to");
    const asset = normalizeAsset(input.asset);
    const amount = requireBigInt(input.amount, "amount");

    if (from === to) {
      throw ApiError.badRequest(
        `"from" and "to" must be different anchors`,
        "SAME_ANCHOR",
      );
    }

    const source = this.repo.get(from, asset);
    if (!source) {
      throw ApiError.notFound(
        `no liquidity balance for anchor "${from}" in ${asset}`,
      );
    }
    if (source.amount < amount) {
      throw ApiError.badRequest(
        `insufficient balance for ${asset}: requested ${amount}, available ${source.amount}`,
        "INSUFFICIENT_LIQUIDITY",
      );
    }

    const updatedAt = new Date().toISOString();
    const fromRemaining = source.amount - amount;
    const destination = this.repo.get(to, asset);
    const toTotal = (destination?.amount ?? 0n) + amount;

    let fromEntry: LiquidityEntry;
    if (fromRemaining === 0n) {
      this.repo.remove(from, asset);
      fromEntry = { anchor: from, asset, amount: 0n, updatedAt };
    } else {
      fromEntry = this.repo.upsert({
        anchor: from,
        asset,
        amount: fromRemaining,
        updatedAt,
      });
    }
    const toEntry = this.repo.upsert({
      anchor: to,
      asset,
      amount: toTotal,
      updatedAt,
    });

    return { from: fromEntry, to: toEntry };
  }

  /**
   * Removes an anchor's entire liquidity entry for an asset, regardless of
   * its current balance. Returns the removed entry, or 404 if none exists.
   */
  removeEntry(anchorInput: unknown, assetInput: unknown): LiquidityEntry {
    const anchor = requireString(anchorInput, "anchor");
    const asset = normalizeAsset(assetInput);
    const existing = this.repo.get(anchor, asset);

    if (!existing) {
      throw ApiError.notFound(
        `no liquidity balance for anchor "${anchor}" in ${asset}`,
      );
    }

    this.repo.remove(anchor, asset);
    return existing;
  }

  /** Returns the aggregated pools for every asset. */
  listPools(): Pool[] {
    return this.repo.pools().sort((a, b) => a.asset.localeCompare(b.asset));
  }

  /** Returns the aggregated pool for one asset, or 404 if none exists. */
  getPool(assetInput: unknown): Pool {
    const asset = normalizeAsset(assetInput);
    const pool = this.repo.pools().find((p) => p.asset === asset);
    if (!pool) {
      throw ApiError.notFound(`no liquidity pool for asset "${asset}"`);
    }
    return pool;
  }

  /** Returns all raw liquidity entries. */
  listEntries(): LiquidityEntry[] {
    return this.repo.all();
  }

  /** Returns all raw liquidity entries for a given anchor. */
  listByAnchor(anchorInput: unknown): LiquidityEntry[] {
    const anchor = requireString(anchorInput, "anchor");
    return this.repo.byAnchor(anchor);
  }

  /**
   * Returns the in-memory audit trail of successful withdrawals, oldest first.
   */
  listWithdrawals(): WithdrawalRecord[] {
    return this.withdrawalHistory.all();
  }
}
