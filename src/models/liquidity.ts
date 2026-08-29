/**
 * Domain models for liquidity pools and routing quotes.
 */

/** A single anchor's liquidity contribution to an asset pool. */
export interface LiquidityEntry {
  /** Stellar anchor identifier (account or home domain). */
  anchor: string;
  /** Asset code the liquidity is denominated in (e.g. "USDC"). */
  asset: string;
  /** Amount of liquidity provided, in the asset's smallest unit. */
  amount: bigint;
  /** ISO-8601 timestamp of the last update. */
  updatedAt: string;
}

/** A successful withdrawal event recorded for auditability.
 *
 * Unlike {@link LiquidityEntry} (which reflects only the *current* balance),
 * a withdrawal record is append-only: it captures the amount moved and the
 * resulting balance at the moment the withdrawal completed, even after the
 * underlying entry has been reduced to zero and removed.
 */
export interface WithdrawalRecord {
  /** Anchor that withdrew the liquidity. */
  anchor: string;
  /** Asset code the withdrawal was denominated in (e.g. "USDC"). */
  asset: string;
  /** Amount withdrawn, in the asset's smallest unit. */
  amount: bigint;
  /** The anchor's resulting balance for the asset after the withdrawal (0 once fully drained). */
  remainingBalance: bigint;
  /** ISO-8601 timestamp of the withdrawal. */
  timestamp: string;
}

/** Aggregate liquidity available for an asset across all anchors. */
export interface Pool {
  asset: string;
  total: bigint;
  anchors: number;
  /** ISO-8601 timestamp of the most recently updated contributing entry. */
  lastUpdated?: string;
}

/** A request to route `amount` of `asset` through available liquidity. */
export interface QuoteRequest {
  asset: string;
  amount: bigint;
}

/** A single leg in a multi-anchor route. */
export interface RouteEntry {
  /** Anchor identifier supplying the portion. */
  anchor: string;
  /** Amount sourced from this anchor, in the asset's smallest unit. */
  portion: bigint;
}

/** A computed routing quote for a {@link QuoteRequest}. */
export interface Quote {
  asset: string;
  amount: bigint;
  /** Protocol fee charged for routing, in the asset's smallest unit. */
  fee: bigint;
  /** Amount delivered after fees. */
  deliverable: bigint;
  /** Anchors selected to source the liquidity, largest first, with per-anchor portions. */
  route: RouteEntry[];
}
