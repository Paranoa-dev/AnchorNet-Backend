import request from "supertest";
import { createApp } from "../app";
import { Express } from "express";

async function seed(app: Express): Promise<void> {
  await request(app).post("/api/v1/anchors").send({ id: "anchorA" });
  await request(app)
    .post("/api/v1/liquidity")
    .send({ anchor: "anchorA", asset: "USDC", amount: 1000 });
  await request(app)
    .post("/api/v1/settlements")
    .send({ anchor: "anchorA", asset: "USDC", amount: 200 });
}

/** Registers an anchor and funds it with `amount` of `asset`. */
async function fund(
  app: Express,
  anchor: string,
  asset: string,
  amount: number,
): Promise<void> {
  await request(app).post("/api/v1/anchors").send({ id: anchor });
  await request(app).post("/api/v1/liquidity").send({ anchor, asset, amount });
}

interface OpenedSettlement {
  id: number;
  amount: number;
  fee: number;
}

/** Opens a settlement and returns its id/amount/fee as assigned by the API. */
async function open(
  app: Express,
  anchor: string,
  asset: string,
  amount: number,
): Promise<OpenedSettlement> {
  const res = await request(app)
    .post("/api/v1/settlements")
    .send({ anchor, asset, amount });
  expect(res.status).toBe(201);
  return { id: res.body.id, amount: res.body.amount, fee: res.body.fee };
}

async function execute(app: Express, id: number): Promise<void> {
  const res = await request(app).post(`/api/v1/settlements/${id}/execute`);
  expect(res.status).toBe(200);
  expect(res.body.status).toBe("executed");
}

async function cancel(app: Express, id: number): Promise<void> {
  const res = await request(app).post(`/api/v1/settlements/${id}/cancel`);
  expect(res.status).toBe(200);
  expect(res.body.status).toBe("cancelled");
}

describe("metrics route", () => {
  it("reports zeroed metrics on a fresh app", async () => {
    const res = await request(createApp()).get("/api/v1/metrics");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      anchors: 0,
      pools: 0,
      totalLiquidity: 0,
      settlements: 0,
    });
  });

  it("aggregates anchors, pools and settlements", async () => {
    const app = createApp();
    await seed(app);

    const res = await request(app).get("/api/v1/metrics");
    expect(res.body.anchors).toBe(1);
    expect(res.body.activeAnchors).toBe(1);
    expect(res.body.pools).toBe(1);
    expect(res.body.totalLiquidity).toBe(1000);
    expect(res.body.settlements).toBe(1);
    expect(res.body.pendingSettlements).toBe(1);
  });

  it("starts with no metrics history", async () => {
    const res = await request(createApp()).get("/api/v1/metrics/history");
    expect(res.status).toBe(200);
    expect(res.body.snapshots).toEqual([]);
  });

  it("records a snapshot on every read of the current metrics", async () => {
    const app = createApp();
    await seed(app);

    await request(app).get("/api/v1/metrics");
    await request(app).get("/api/v1/metrics");

    const res = await request(app).get("/api/v1/metrics/history");
    expect(res.status).toBe(200);
    expect(res.body.snapshots).toHaveLength(2);
    expect(res.body.snapshots[0]).toMatchObject({
      anchors: 1,
      settlements: 1,
    });
    expect(typeof res.body.snapshots[0].timestamp).toBe("string");
  });

  it("returns the full metrics history when since is omitted", async () => {
    const app = createApp();
    await seed(app);

    await request(app).get("/api/v1/metrics");
    await request(app).get("/api/v1/metrics");
    await request(app).get("/api/v1/metrics");

    const res = await request(app).get("/api/v1/metrics/history");
    expect(res.status).toBe(200);
    expect(res.body.snapshots).toHaveLength(3);
  });

  it("filters metrics history to snapshots after a valid since timestamp", async () => {
    jest.useFakeTimers();
    try {
      const app = createApp();
      await seed(app);

      jest.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
      await request(app).get("/api/v1/metrics");

      jest.setSystemTime(new Date("2026-01-01T00:00:10.000Z"));
      await request(app).get("/api/v1/metrics");

      jest.setSystemTime(new Date("2026-01-01T00:00:20.000Z"));
      await request(app).get("/api/v1/metrics");

      const res = await request(app)
        .get("/api/v1/metrics/history")
        .query({ since: "2026-01-01T00:00:10.000Z" });

      expect(res.status).toBe(200);
      expect(res.body.snapshots).toHaveLength(1);
      expect(res.body.snapshots[0].timestamp).toBe("2026-01-01T00:00:20.000Z");
    } finally {
      jest.useRealTimers();
    }
  });

  it("rejects an invalid since timestamp", async () => {
    const res = await request(createApp())
      .get("/api/v1/metrics/history")
      .query({ since: "not-a-date" });

    expect(res.status).toBe(400);
    expect(res.body.error.message).toBe(
      '"since" must be a valid ISO-8601 timestamp',
    );
  });

  it("rejects repeated since timestamp query parameters", async () => {
    const res = await request(createApp()).get(
      "/api/v1/metrics/history?since=2026-01-01T00:00:00.000Z&since=2026-01-02T00:00:00.000Z",
    );

    expect(res.status).toBe(400);
    expect(res.body.error.message).toBe(
      '"since" must be a valid ISO-8601 timestamp',
    );
  });

  it("records snapshots on a fixed interval when configured", async () => {
    jest.useFakeTimers();
    try {
      const originalEnv = process.env.METRICS_SNAPSHOT_INTERVAL_MS;
      process.env.METRICS_SNAPSHOT_INTERVAL_MS = "1000";

      const app = createApp();
      await seed(app);

      // Verify no history initially
      let res = await request(app).get("/api/v1/metrics/history");
      expect(res.body.snapshots).toHaveLength(0);

      // Advance time by 3 seconds (should trigger 3 snapshots)
      jest.advanceTimersByTime(3000);

      // Verify history has been populated
      res = await request(app).get("/api/v1/metrics/history");
      expect(res.body.snapshots).toHaveLength(3);
      expect(res.body.snapshots[0].anchors).toBe(1);

      // Restore env
      if (originalEnv === undefined) {
        delete process.env.METRICS_SNAPSHOT_INTERVAL_MS;
      } else {
        process.env.METRICS_SNAPSHOT_INTERVAL_MS = originalEnv;
      }
    } finally {
      jest.useRealTimers();
    }
  });
});

describe("metrics settled-value totals", () => {
  it("reports zero settled amount and fees on a fresh app", async () => {
    const res = await request(createApp()).get("/api/v1/metrics");

    expect(res.status).toBe(200);
    expect(res.body.totalSettledAmount).toBe(0);
    expect(res.body.totalFeesCollected).toBe(0);
  });

  it("excludes pending settlements from the settled totals", async () => {
    const app = createApp();
    await fund(app, "anchorA", "USDC", 100_000);
    const pending = await open(app, "anchorA", "USDC", 10_000);
    expect(pending.fee).toBeGreaterThan(0);

    const res = await request(app).get("/api/v1/metrics");

    expect(res.body.settlements).toBe(1);
    expect(res.body.pendingSettlements).toBe(1);
    expect(res.body.totalSettledAmount).toBe(0);
    expect(res.body.totalFeesCollected).toBe(0);
  });

  it("excludes cancelled settlements from the settled totals", async () => {
    const app = createApp();
    await fund(app, "anchorA", "USDC", 100_000);
    const cancelled = await open(app, "anchorA", "USDC", 30_000);
    await cancel(app, cancelled.id);

    const res = await request(app).get("/api/v1/metrics");

    expect(res.body.settlements).toBe(1);
    expect(res.body.pendingSettlements).toBe(0);
    expect(res.body.totalSettledAmount).toBe(0);
    expect(res.body.totalFeesCollected).toBe(0);
  });

  it("counts an executed settlement's amount and fee", async () => {
    const app = createApp();
    await fund(app, "anchorA", "USDC", 100_000);
    const settlement = await open(app, "anchorA", "USDC", 20_000);
    await execute(app, settlement.id);

    const res = await request(app).get("/api/v1/metrics");

    expect(res.body.totalSettledAmount).toBe(20000);
    expect(res.body.totalFeesCollected).toBe(Number(settlement.fee));
    // Default protocol fee is 10 bps: ceil(20000 * 10 / 10000) === 20.
    expect(res.body.totalFeesCollected).toBe(20);
  });

  it("counts only executed settlements across a pending/executed/cancelled mix", async () => {
    const app = createApp();
    await fund(app, "anchorA", "USDC", 100_000);

    const pending = await open(app, "anchorA", "USDC", 10_000);
    const executedOne = await open(app, "anchorA", "USDC", 20_000);
    const cancelled = await open(app, "anchorA", "USDC", 30_000);
    const executedTwo = await open(app, "anchorA", "USDC", 40_000);

    await execute(app, executedOne.id);
    await cancel(app, cancelled.id);
    await execute(app, executedTwo.id);

    const res = await request(app).get("/api/v1/metrics");

    // Counts still cover every settlement regardless of status.
    expect(res.body.settlements).toBe(4);
    expect(res.body.pendingSettlements).toBe(1);

    // Value totals cover the two executed settlements only.
    expect(res.body.totalSettledAmount).toBe(60000);
    expect(res.body.totalFeesCollected).toBe(60);

    // Guard against the pending/cancelled legs leaking into the totals.
    expect(res.body.totalSettledAmount).not.toBe(
      pending.amount +
        executedOne.amount +
        cancelled.amount +
        executedTwo.amount,
    );
    expect(res.body.totalFeesCollected).not.toBe(
      pending.fee + executedOne.fee + cancelled.fee + executedTwo.fee,
    );
  });

  it("sums executed settlements across multiple anchors and assets", async () => {
    const app = createApp();
    await fund(app, "anchorA", "USDC", 100_000);
    await fund(app, "anchorB", "EURC", 100_000);

    const usdc = await open(app, "anchorA", "USDC", 25_000);
    const eurc = await open(app, "anchorB", "EURC", 15_000);
    const otherPending = await open(app, "anchorB", "EURC", 5_000);
    await execute(app, usdc.id);
    await execute(app, eurc.id);

    const res = await request(app).get("/api/v1/metrics");

    expect(res.body.anchors).toBe(2);
    expect(res.body.pools).toBe(2);
    expect(res.body.settlements).toBe(3);
    expect(res.body.pendingSettlements).toBe(1);
    expect(res.body.totalSettledAmount).toBe(40000);
    expect(res.body.totalFeesCollected).toBe(40);
    expect(otherPending.amount).toBe(5_000);
  });

  it("moves a settlement's value into the totals only once it is executed", async () => {
    const app = createApp();
    await fund(app, "anchorA", "USDC", 100_000);
    const settlement = await open(app, "anchorA", "USDC", 50_000);

    const before = await request(app).get("/api/v1/metrics");
    expect(before.body.totalSettledAmount).toBe(0);
    expect(before.body.totalFeesCollected).toBe(0);

    await execute(app, settlement.id);

    const after = await request(app).get("/api/v1/metrics");
    expect(after.body.totalSettledAmount).toBe(50000);
    expect(after.body.totalFeesCollected).toBe(Number(settlement.fee));
  });

  it("keeps the settled totals stable when a later settlement is cancelled", async () => {
    const app = createApp();
    await fund(app, "anchorA", "USDC", 100_000);
    const executed = await open(app, "anchorA", "USDC", 20_000);
    await execute(app, executed.id);

    const afterExecute = await request(app).get("/api/v1/metrics");

    const doomed = await open(app, "anchorA", "USDC", 20_000);
    await cancel(app, doomed.id);

    const afterCancel = await request(app).get("/api/v1/metrics");

    expect(afterCancel.body.totalSettledAmount).toBe(
      afterExecute.body.totalSettledAmount,
    );
    expect(afterCancel.body.totalFeesCollected).toBe(
      afterExecute.body.totalFeesCollected,
    );
    expect(afterCancel.body.settlements).toBe(2);
  });

  it("keeps the existing metrics fields unchanged alongside the new totals", async () => {
    const app = createApp();
    await fund(app, "anchorA", "USDC", 1_000);
    const settlement = await open(app, "anchorA", "USDC", 200);
    await execute(app, settlement.id);

    const res = await request(app).get("/api/v1/metrics");

    // Backward compatibility: the pre-existing shape is preserved verbatim and
    // the two value totals are purely additive.
    expect(Object.keys(res.body).sort()).toEqual([
      "activeAnchors",
      "anchors",
      "pendingSettlements",
      "pools",
      "settlements",
      "totalFeesCollected",
      "totalLiquidity",
      "totalSettledAmount",
    ]);
    expect(res.body).toEqual({
      anchors: 1,
      activeAnchors: 1,
      pools: 1,
      totalLiquidity: 1000,
      settlements: 1,
      pendingSettlements: 0,
      totalSettledAmount: 200,
      totalFeesCollected: settlement.fee,
    });
  });

  it("includes the settled totals in recorded history snapshots", async () => {
    const app = createApp();
    await fund(app, "anchorA", "USDC", 100_000);
    const first = await open(app, "anchorA", "USDC", 20_000);
    await execute(app, first.id);

    await request(app).get("/api/v1/metrics");

    const second = await open(app, "anchorA", "USDC", 30_000);
    await execute(app, second.id);

    await request(app).get("/api/v1/metrics");

    const res = await request(app).get("/api/v1/metrics/history");

    expect(res.status).toBe(200);
    expect(res.body.snapshots).toHaveLength(2);
    expect(res.body.snapshots[0]).toMatchObject({
      totalSettledAmount: 20000,
      totalFeesCollected: first.fee,
    });
    expect(res.body.snapshots[1]).toMatchObject({
      totalSettledAmount: 50000,
      totalFeesCollected: first.fee + second.fee,
    });
    // History snapshots keep the pre-existing fields plus a timestamp.
    expect(Object.keys(res.body.snapshots[1]).sort()).toEqual([
      "activeAnchors",
      "anchors",
      "pendingSettlements",
      "pools",
      "settlements",
      "timestamp",
      "totalFeesCollected",
      "totalLiquidity",
      "totalSettledAmount",
    ]);
  });

  it("reports numeric (never string or null) settled totals", async () => {
    const app = createApp();
    await fund(app, "anchorA", "USDC", 100_000);
    const settlement = await open(app, "anchorA", "USDC", 20_000);
    await execute(app, settlement.id);

    const res = await request(app).get("/api/v1/metrics");

    expect(typeof res.body.totalSettledAmount).toBe("number");
    expect(typeof res.body.totalFeesCollected).toBe("number");
    expect(Number.isFinite(res.body.totalSettledAmount)).toBe(true);
    expect(Number.isFinite(res.body.totalFeesCollected)).toBe(true);
  });
});
