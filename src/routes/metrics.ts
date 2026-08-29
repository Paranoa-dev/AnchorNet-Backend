/**
 * Aggregate network metrics endpoint.
 */

import { Router, Request, Response } from "express";
import { LiquidityService } from "../services/liquidityService";
import { AnchorService } from "../services/anchorService";
import { SettlementService } from "../services/settlementService";
import { ApiError } from "../errors/ApiError";
import { BoundedHistory } from "../utils/history";

/** Maximum number of metrics snapshots retained for `GET /history`. */
const MAX_HISTORY = 50;

/**
 * A point-in-time view of the network's aggregate state.
 */
export interface MetricsSnapshot {
  anchors: number;
  activeAnchors: number;
  pools: number;
  totalLiquidity: bigint;
  settlements: number;
  pendingSettlements: number;
  totalSettledAmount: bigint;
  totalFeesCollected: bigint;
}

export function metricsRouter(deps: {
  liquidity: LiquidityService;
  anchors: AnchorService;
  settlements: SettlementService;
  snapshotIntervalMs?: number;
}): Router {
  const router = Router();
  const history = new BoundedHistory<any>( // Simplified type for history
    MAX_HISTORY,
  );

  function snapshot(): MetricsSnapshot {
    const pools = deps.liquidity.listPools();
    const anchors = deps.anchors.list();
    const settlements = deps.settlements.list();

    const executed = settlements.filter((s) => s.status === "executed");

    return {
      anchors: anchors.length,
      activeAnchors: deps.anchors.countActive(),
      pools: pools.length,
      totalLiquidity: pools.reduce((sum, p) => sum + p.total, 0n),
      settlements: settlements.length,
      pendingSettlements: settlements.filter((s) => s.status === "pending")
        .length,
      totalSettledAmount: executed.reduce((sum, s) => sum + s.amount, 0n),
      totalFeesCollected: executed.reduce((sum, s) => sum + s.fee, 0n),
    };
  }

  function recordSnapshot(): MetricsSnapshot {
    const current = snapshot();
    history.push({
      ...current,
      totalLiquidity: Number(current.totalLiquidity),
      totalSettledAmount: Number(current.totalSettledAmount),
      totalFeesCollected: Number(current.totalFeesCollected),
      timestamp: new Date().toISOString(),
    });
    return current;
  }

  if (deps.snapshotIntervalMs && deps.snapshotIntervalMs > 0) {
    const timer = setInterval(() => {
      recordSnapshot();
    }, deps.snapshotIntervalMs);
    timer.unref();
  }

  router.get("/", (_req: Request, res: Response) => {
    const current = recordSnapshot();
    res.json({
      ...current,
      totalLiquidity: Number(current.totalLiquidity),
      totalSettledAmount: Number(current.totalSettledAmount),
      totalFeesCollected: Number(current.totalFeesCollected),
    });
  });

  router.get("/history", (req: Request, res: Response) => {
    const since = req.query.since;
    const snapshots = history.all();

    if (since === undefined) {
      res.json({ snapshots });
      return;
    }

    if (typeof since !== "string") {
      throw ApiError.badRequest('"since" must be a valid ISO-8601 timestamp');
    }

    const sinceTime = new Date(since).getTime();
    if (Number.isNaN(sinceTime)) {
      throw ApiError.badRequest('"since" must be a valid ISO-8601 timestamp');
    }

    res.json({
      snapshots: snapshots.filter(
        (snapshot) => new Date(snapshot.timestamp).getTime() > sinceTime,
      ),
    });
  });

  return router;
}
