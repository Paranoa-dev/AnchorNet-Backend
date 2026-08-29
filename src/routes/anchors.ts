/**
 * Routes for managing registered anchors.
 */

import { Router, Request, Response } from "express";
import { AnchorService } from "../services/anchorService";
import { SettlementService } from "../services/settlementService";
import { Anchor } from "../models/anchor";
import { Settlement } from "../models/settlement";
import { applySort } from "../utils/sorting";
import { paginate } from "../utils/pagination";
import { csvColumnsFor, toCsv } from "../utils/csv";
import { optionalBooleanFlag } from "../utils/validation";

const SORTABLE_FIELDS = ["id", "name", "registeredAt"];

// Locked to `Anchor` at compile time: adding a field to the model without
// adding a column here fails the build instead of silently shrinking the
// CSV export. See `csvColumnsFor` in ../utils/csv.
const CSV_COLUMNS = csvColumnsFor<Anchor>()([
  "id",
  "name",
  "registeredAt",
  "active",
]);

const SETTLEMENT_SORTABLE_FIELDS = [
  "id",
  "amount",
  "fee",
  "status",
  "createdAt",
];

// Must stay identical to the column list in ../routes/settlements.ts so the
// nested export matches the top-level one; both are locked to `Settlement`.
const SETTLEMENT_CSV_COLUMNS = csvColumnsFor<Settlement>()([
  "id",
  "anchor",
  "asset",
  "amount",
  "fee",
  "status",
  "createdAt",
  "cancelReason",
]);

const serializeSettlement = (s: Settlement) => ({
  ...s,
  amount: s.amount.toString(),
  fee: s.fee.toString(),
});

export function anchorRouter(
  service: AnchorService,
  settlements?: SettlementService,
): Router {
  const router = Router();

  // Register a new anchor.
  router.post("/", (req: Request, res: Response) => {
    const anchor = service.register(req.body ?? {});
    res.status(201).json(anchor);
  });

  // Register a batch of anchors atomically.
  //
  // With ?dryRun=true the batch runs through the identical validation but
  // nothing is persisted — a preflight check for onboarding UIs. The response
  // shape and status match a real call, plus a `dryRun` flag so the caller can
  // confirm no registration happened. `dryRun` is strictly parsed: only
  // "true"/"false" are accepted, so a typo can never silently perform a real
  // registration.
  router.post("/bulk", (req: Request, res: Response) => {
    const dryRun = optionalBooleanFlag(req.query.dryRun, "dryRun");
    const anchors = service.registerBulk((req.body ?? {}).anchors, dryRun);
    res.status(201).json({ anchors, dryRun });
  });

  // List anchors, optionally filtered via ?status=active|inactive and/or a
  // free-text ?q= search over id/name, sorted via ?sort=id|name|registeredAt
  // and ?order=asc|desc, and exported as CSV via ?format=csv.
  router.get("/", (req: Request, res: Response) => {
    const anchors = applySort(
      service.list({ status: req.query.status, q: req.query.q }),
      { sort: req.query.sort, order: req.query.order },
      SORTABLE_FIELDS,
    );

    if (req.query.format === "csv") {
      res.type("text/csv").send(toCsv(anchors, CSV_COLUMNS));
      return;
    }

    res.json({ anchors });
  });

  // Read a single anchor by id.
  router.get("/:id", (req: Request, res: Response) => {
    res.json(service.get(req.params.id));
  });

  // Partially update an anchor's mutable fields (currently just `name`).
  router.patch("/:id", (req: Request, res: Response) => {
    res.json(service.update(req.params.id, req.body ?? {}));
  });

  // Deactivate an anchor.
  router.delete("/:id", (req: Request, res: Response) => {
    res.json(service.deregister(req.params.id));
  });

  // Reactivate a previously deactivated anchor.
  router.post("/:id/reactivate", (req: Request, res: Response) => {
    res.json(service.reactivate(req.params.id));
  });

  // List settlements for a specific anchor, scoped by its id.
  // Returns 404 if the anchor does not exist.
  // Supports ?sort=, ?order=, ?page=, ?pageSize=, and ?format=csv.
  router.get("/:id/settlements", (req: Request, res: Response) => {
    // Validate anchor existence — throws 404 if unknown.
    service.get(req.params.id);

    if (!settlements) {
      res.status(501).json({
        error: {
          code: "NOT_IMPLEMENTED",
          message: "settlements service unavailable",
        },
      });
      return;
    }

    const sorted = applySort(
      settlements.list({ anchor: req.params.id }),
      { sort: req.query.sort, order: req.query.order },
      SETTLEMENT_SORTABLE_FIELDS,
    );

    // CSV export ignores pagination and returns every matching, sorted row.
    if (req.query.format === "csv") {
      const stringifiedSorted = sorted.map(serializeSettlement);
      res.type("text/csv").send(toCsv(stringifiedSorted, SETTLEMENT_CSV_COLUMNS));
      return;
    }

    const page = paginate(sorted, {
      page: req.query.page,
      pageSize: req.query.pageSize,
    });
    res.json({
      settlements: page.items.map(serializeSettlement),
      pagination: { ...page, items: undefined },
    });
  });

  return router;
}
