/**
 * Domain models for cross-anchor settlements.
 */

/** Lifecycle state of a settlement, mirroring the on-chain contract. */
export type SettlementStatus = "pending" | "executed" | "cancelled";

const VALID_STATUSES: readonly SettlementStatus[] = [
  "pending",
  "executed",
  "cancelled",
];

/** Runtime type guard: returns `true` when `value` is a valid {@link SettlementStatus}. */
export function isSettlementStatus(
  value: unknown,
): value is SettlementStatus {
  return (
    typeof value === "string" &&
    (VALID_STATUSES as readonly string[]).includes(value)
  );
}

/** A settlement that draws liquidity from a pool to settle a payment. */
export interface Settlement {
  /** Monotonic identifier assigned by the service. */
  id: number;
  /** Anchor that requested the settlement. */
  anchor: string;
  /** Asset being settled. */
  asset: string;
  /** Gross amount reserved from the pool. */
  amount: bigint;
  /** Protocol fee withheld from the amount. */
  fee: bigint;
  /** Current lifecycle state. */
  status: SettlementStatus;
  /** ISO-8601 timestamp of creation. */
  createdAt: string;
  /** Optional operator-supplied reason recorded when the settlement was cancelled. */
  cancelReason?: string;
}
