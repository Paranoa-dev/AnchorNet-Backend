/**
 * Route for computing routing quotes.
 */

import { Router, Request, Response } from "express";
import { QuoteService } from "../services/quoteService";

export function quoteRouter(service: QuoteService): Router {
  const router = Router();

  // Compute a routing quote for an asset/amount pair.
  router.post("/", (req: Request, res: Response) => {
    const quote = service.quote(req.body ?? {});
    res.json({
      ...quote,
      amount: quote.amount.toString(),
      fee: quote.fee.toString(),
      deliverable: quote.deliverable.toString(),
      route: quote.route.map((r) => ({
        ...r,
        portion: r.portion.toString(),
      })),
    });
  });

  return router;
}
