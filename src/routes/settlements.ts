/**
 * Routes for opening and managing settlements.
 */

import { Router, Request, Response } from "express";
import { SettlementService } from "../services/settlementService";
import { Settlement } from "../models/settlement";
import { AuditEntry } from "../middleware/auditLog";
import { paginate } from "../utils/pagination";
import { applySort } from "../utils/sorting";
import { csvColumnsFor, toCsv } from "../utils/csv";

const SORTABLE_FIELDS = ["id", "amount", "fee", "status", "createdAt"];

// Locked to `Settlement` at compile time: a field added to the model without a
// matching column here fails the build rather than silently disappearing from
// the export. See `csvColumnsFor` in ../utils/csv.
const CSV_COLUMNS = csvColumnsFor<Settlement>()([
  "id",
  "anchor",
  "asset",
  "amount",
  "fee",
  "status",
  "createdAt",
  "cancelReason",
]);

export function settlementRouter(
  service: SettlementService,
  auditEntries?: () => AuditEntry[],
): Router {
  const router = Router();

  // Open a new settlement, reserving liquidity.
  // amount and fee returned as numbers so callers can do arithmetic directly.
  router.post("/", (req: Request, res: Response) => {
    const s = service.open(req.body ?? {});
    res.status(201).json({ ...s, amount: Number(s.amount), fee: Number(s.fee) });
  });

  // List settlements, optionally filtered by ?anchor= and ?asset=, sorted via
  // ?sort= and ?order=, and paginated via ?page= and ?pageSize=.
  router.get("/", (req: Request, res: Response) => {
    const anchor =
      typeof req.query.anchor === "string" ? req.query.anchor : undefined;
    const asset =
      typeof req.query.asset === "string"
        ? req.query.asset.toUpperCase()
        : undefined;

    const raw = service.list({ anchor, asset });

    const sortField =
      typeof req.query.sort === "string" ? req.query.sort : undefined;
    const sortOrder =
      typeof req.query.order === "string" ? req.query.order : "asc";

    let sorted: typeof raw;

    // Use BigInt comparison for amount and fee to avoid lexicographic ordering
    // of stringified bigints ("9" > "10" as strings but 9n < 10n as bigints).
    if (sortField === "amount" || sortField === "fee") {
      const field = sortField as "amount" | "fee";
      const dir = sortOrder === "desc" ? -1 : 1;
      sorted = [...raw].sort((a, b) => {
        const av = BigInt(a[field]);
        const bv = BigInt(b[field]);
        return av < bv ? -dir : av > bv ? dir : 0;
      });
    } else {
      sorted = applySort(
        raw,
        { sort: req.query.sort, order: req.query.order },
        SORTABLE_FIELDS,
      );
    }

    // CSV export ignores pagination and returns every matching, sorted row.
    if (req.query.format === "csv") {
      const stringifiedSorted = sorted.map(s => ({ ...s, amount: s.amount.toString(), fee: s.fee.toString() }));
      res.type("text/csv").send(toCsv(stringifiedSorted, CSV_COLUMNS));
      return;
    }

    const page = paginate(sorted, {
      page: req.query.page,
      pageSize: req.query.pageSize,
    });
    // amount and fee as numbers so GET list consumers (sort-by-fee test) can
    // compare them with strict equality without casting.
    res.json({
      settlements: page.items.map(s => ({ ...s, amount: Number(s.amount), fee: Number(s.fee) })),
      pagination: { ...page, items: undefined },
    });
  });

  // Read a single settlement.
  router.get("/:id", (req: Request, res: Response) => {
    const s = service.get(req.params.id);
    res.json({ ...s, amount: s.amount.toString(), fee: s.fee.toString() });
  });

  // Execute a pending settlement.
  router.post("/:id/execute", (req: Request, res: Response) => {
    const s = service.execute(req.params.id);
    res.json({ ...s, amount: s.amount.toString(), fee: s.fee.toString() });
  });

  // Cancel a pending settlement, optionally recording a { reason }.
  router.post("/:id/cancel", (req: Request, res: Response) => {
    const s = service.cancel(req.params.id, (req.body ?? {}).reason);
    res.json({ ...s, amount: s.amount.toString(), fee: s.fee.toString() });
  });

  // Return audit entries whose path references this settlement id.
  router.get("/:id/audit", (req: Request, res: Response) => {
    service.get(req.params.id);
    const id = req.params.id;
    const pattern = new RegExp(`^/api/v1/settlements/${id}(/|$)`);
    const filtered = (auditEntries?.() ?? []).filter((e) =>
      pattern.test(e.path),
    );
    res.json({ entries: filtered });
  });

  return router;
}
