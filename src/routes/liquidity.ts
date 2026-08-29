/**
 * Routes for recording and reading anchor liquidity.
 */

import { Router, Request, Response } from "express";
import { ApiError } from "../errors/ApiError";
import { LiquidityService } from "../services/liquidityService";

export function liquidityRouter(service: LiquidityService): Router {
  const router = Router();

  // Record (or accumulate) liquidity for an anchor/asset pair.
  router.post("/", (req: Request, res: Response) => {
    const raw = req.body.amount;

    // Reject values that cannot represent a valid positive integer amount:
    // - null, undefined, boolean, arrays, plain objects
    // - NaN, Infinity, -Infinity  (non-finite numbers)
    // - negative zero
    // - numeric strings that are not finite positive integers ("abc", "1.5" would
    //   also be caught downstream, but we surface a clear 400 here)
    // NOTE: valid string amounts like "500" are allowed — the service converts them.
    const isInvalidNonString =
      raw === null ||
      raw === undefined ||
      typeof raw === "boolean" ||
      Array.isArray(raw) ||
      (typeof raw === "object" && raw !== null) ||
      (typeof raw === "number" && (!Number.isFinite(raw) || Object.is(raw, -0)));

    const isInvalidString =
      typeof raw === "string" && !/^\d+$/.test(raw.trim());

    if (isInvalidNonString || isInvalidString) {
      throw ApiError.badRequest('"amount" must be a positive finite number');
    }

    const entry = service.addLiquidity(req.body ?? {});
    res.status(201).json({ ...entry, amount: entry.amount.toString() });
  });

  // Withdraw (reduce) liquidity previously recorded for an anchor/asset pair.
  router.post("/withdraw", (req: Request, res: Response) => {
    const entry = service.withdrawLiquidity(req.body ?? {});
    res.json({ ...entry, amount: entry.amount.toString() });
  });

  // Atomically transfer liquidity between two anchors for the same asset.
  router.post("/transfer", (req: Request, res: Response) => {
    const result = service.transferLiquidity(req.body ?? {});
    res.json({
        from: { ...result.from, amount: result.from.amount.toString() },
        to: { ...result.to, amount: result.to.amount.toString() }
    });
  });

  // List aggregated pools across all assets.
  router.get("/", (_req: Request, res: Response) => {
    res.json({ pools: service.listPools().map(p => ({ ...p, total: p.total.toString() })) });
  });

  // ---------------------------------------------------------------------
  // ROUTE ORDER IS LOAD-BEARING.
  // ...
  // ---------------------------------------------------------------------

  // List raw per-anchor entries. Registered before the catch-all GET /:asset
  router.get("/entries", (_req: Request, res: Response) => {
    res.json({ entries: service.listEntries().map(e => ({ ...e, amount: e.amount.toString() })) });
  });

  // Read-only audit trail of successful withdrawals.
  router.get("/withdrawals", (_req: Request, res: Response) => {
    res.json({ withdrawals: service.listWithdrawals().map(w => ({ ...w, amount: w.amount.toString(), remainingBalance: w.remainingBalance.toString() })) });
  });

  // Force-remove an anchor's entire liquidity entry for an asset.
  router.delete("/:anchor/:asset", (req: Request, res: Response) => {
    const entry = service.removeEntry(req.params.anchor, req.params.asset);
    res.json({ ...entry, amount: entry.amount.toString() });
  });

  // Read the raw liquidity entries for a single anchor.
  router.get("/anchors/:anchor", (req: Request, res: Response) => {
    res.json({ entries: service.listByAnchor(req.params.anchor).map(e => ({ ...e, amount: e.amount.toString() })) });
  });

  // Read the aggregated pool for a single asset.
  router.get("/:asset", (req: Request, res: Response) => {
    const pool = service.getPool(req.params.asset);
    res.json({ ...pool, total: pool.total.toString() });
  });

  return router;
}
