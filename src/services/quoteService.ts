/**
 * Quote service.
 *
 * Computes a routing quote for an asset by selecting anchor liquidity
 * largest-first and applying the protocol fee. This is a deterministic,
 * off-chain preview of how a settlement would be sourced.
 */

import { LiquidityRepository } from "../repositories/liquidityRepository";
import { Quote, RouteEntry } from "../models/liquidity";
import { ApiError } from "../errors/ApiError";
import { normalizeAsset, requireBigInt } from "../utils/validation";

/** Default protocol fee in basis points (10 bps = 0.1%). */
const DEFAULT_FEE_BPS = 10n;
const BPS_DIVISOR = 10_000n;

export class QuoteService {
  private readonly feeBps: bigint;

  constructor(
    private readonly repo: LiquidityRepository,
    feeBps: bigint | number = DEFAULT_FEE_BPS,
  ) {
    this.feeBps = BigInt(feeBps);
  }

  /**
   * Builds a {@link Quote} for routing `amount` of `asset`. Throws a 400 if
   * the pool does not hold enough liquidity to cover the request.
   */
  quote(input: { asset: unknown; amount: unknown }): Quote {
    const asset = normalizeAsset(input.asset);
    const amount = requireBigInt(input.amount, "amount");

    const sources = this.repo
      .byAsset(asset)
      .slice()
      .sort((a, b) => {
        if (b.amount > a.amount) return 1;
        if (b.amount < a.amount) return -1;
        return a.anchor.localeCompare(b.anchor);
      });

    const available = sources.reduce((sum, e) => sum + e.amount, 0n);
    if (available < amount) {
      throw ApiError.badRequest(
        `insufficient liquidity for ${asset}: requested ${amount}, available ${available}`,
        "INSUFFICIENT_LIQUIDITY",
      );
    }

    const route: RouteEntry[] = [];
    let remaining = amount;
    for (const entry of sources) {
      if (remaining <= 0n) break;
      const taken = remaining < entry.amount ? remaining : entry.amount;
      route.push({ anchor: entry.anchor, portion: taken });
      remaining -= taken;
    }

    // Exact BigInt ceiling division: (amount * feeBps + (BPS_DIVISOR - 1n)) / BPS_DIVISOR
    const fee = (amount * this.feeBps + (BPS_DIVISOR - 1n)) / BPS_DIVISOR;

    return {
      asset,
      amount,
      fee,
      deliverable: amount - fee,
      route,
    };
  }
}
