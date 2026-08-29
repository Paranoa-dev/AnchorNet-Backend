/**
 * Settlement service.
 *
 * Reserves pool liquidity for cross-anchor settlements and tracks their
 * lifecycle, mirroring the on-chain contract's reserve/execute/cancel flow.
 *
 * Availability accounting:
 *   available(asset) = poolTotal(asset) - reserved(asset) - consumed(asset)
 *
 * - `reserved` holds liquidity locked by pending settlements.
 * - `consumed` holds liquidity permanently drawn by executed settlements.
 */

import { SettlementRepository } from "../repositories/settlementRepository";
import { LiquidityRepository } from "../repositories/liquidityRepository";
import { AnchorService } from "./anchorService";
import { Settlement } from "../models/settlement";
import { ApiError } from "../errors/ApiError";
import {
  normalizeAsset,
  requireBigInt,
  requirePositiveInteger,
  requireString,
  requireStringMaxLength,
} from "../utils/validation";

const DEFAULT_FEE_BPS = 10n;
const BPS_DIVISOR = 10_000n;

export class SettlementService {
  private readonly reserved = new Map<string, bigint>();
  private readonly consumed = new Map<string, bigint>();

  constructor(
    private readonly settlements: SettlementRepository,
    private readonly liquidity: LiquidityRepository,
    private readonly anchors: AnchorService,
    feeBps: bigint | number = DEFAULT_FEE_BPS,
  ) {
    this.feeBps = BigInt(feeBps);
  }

  private readonly feeBps: bigint;

  /** Liquidity available for new settlements in `asset`. */
  available(asset: string): bigint {
    const pool = this.liquidity.pools().find((p) => p.asset === asset);
    const total = pool?.total ?? 0n;
    return total - (this.reserved.get(asset) ?? 0n) - (this.consumed.get(asset) ?? 0n);
  }
  /** Returns the amount of liquidity reserved for pending settlements for a given asset. */
  public getReservedLiquidity(asset: string): bigint {
    return this.reserved.get(asset) ?? 0n;
  }

  /** Opens a pending settlement, reserving liquidity from the pool. */
  open(input: { anchor: unknown; asset: unknown; amount: unknown }): Settlement {
    const anchor = requireString(input.anchor, "anchor");
    const asset = normalizeAsset(input.asset);
    const amount = requireBigInt(input.amount, "amount");

    if (!this.anchors.isActive(anchor)) {
      throw ApiError.badRequest(
        `anchor "${anchor}" is not an active registered anchor`,
        "ANCHOR_NOT_ACTIVE",
      );
    }

    if (this.available(asset) < amount) {
      throw ApiError.badRequest(
        `insufficient liquidity for ${asset}: requested ${amount}, available ${this.available(asset)}`,
        "INSUFFICIENT_LIQUIDITY",
      );
    }

    this.reserved.set(asset, (this.reserved.get(asset) ?? 0n) + amount);
    const fee = (amount * this.feeBps + (BPS_DIVISOR - 1n)) / BPS_DIVISOR;

    return this.settlements.create({
      anchor,
      asset,
      amount,
      fee,
      status: "pending",
      createdAt: new Date().toISOString(),
    });
  }

  /** Executes a pending settlement, consuming its reserved liquidity. */
  execute(idInput: unknown): Settlement {
    const settlement = this.requirePending(idInput);
    this.reserved.set(
      settlement.asset,
      (this.reserved.get(settlement.asset) ?? 0n) - settlement.amount,
    );
    this.consumed.set(
      settlement.asset,
      (this.consumed.get(settlement.asset) ?? 0n) + settlement.amount,
    );
    return this.settlements.save({ ...settlement, status: "executed" });
  }

  /**
   * Cancels a pending settlement, releasing its reserved liquidity. An
   * optional `reason` is recorded on the settlement if provided; if given, it
   * must be a non-blank string.
   */
  cancel(idInput: unknown, reasonInput?: unknown): Settlement {
    const settlement = this.requirePending(idInput);
    const cancelReason =
      reasonInput === undefined
        ? undefined
        : requireStringMaxLength(reasonInput, "reason", 500);

    this.reserved.set(
      settlement.asset,
      (this.reserved.get(settlement.asset) ?? 0n) - settlement.amount,
    );
    return this.settlements.save({
      ...settlement,
      status: "cancelled",
      cancelReason,
    });
  }

  /** Returns one settlement or 404. */
  get(idInput: unknown): Settlement {
    const id = this.parseId(idInput);
    const settlement = this.settlements.get(id);
    if (!settlement) {
      throw ApiError.notFound(`settlement ${id} not found`);
    }
    return settlement;
  }

  /** Returns all settlements, optionally filtered by anchor and/or asset. */
  list(filters: { anchor?: string; asset?: string } = {}): Settlement[] {
    const base = filters.anchor
      ? this.settlements.byAnchor(filters.anchor)
      : this.settlements.all();
    return filters.asset
      ? base.filter((s) => s.asset === filters.asset)
      : base;
  }

  private requirePending(idInput: unknown): Settlement {
    const settlement = this.get(idInput);
    if (settlement.status !== "pending") {
      throw ApiError.conflict(
        `settlement ${settlement.id} is ${settlement.status}, not pending`,
        "INVALID_STATE",
      );
    }
    return settlement;
  }

  private parseId(idInput: unknown): number {
    return requirePositiveInteger(idInput, "id");
  }
}
