import request from "supertest";
import { createApp } from "../app";

describe("liquidity routes", () => {
  it("creates liquidity and returns the stored entry", async () => {
    const app = createApp();
    const res = await request(app)
      .post("/api/v1/liquidity")
      .send({ anchor: "anchorA", asset: "USDC", amount: "500" });

    expect(res.status).toBe(201);
    expect(res.body.asset).toBe("USDC");
    expect(res.body.amount).toBe("500");
  });

  it("lists aggregated pools", async () => {
    const app = createApp();
    await request(app)
      .post("/api/v1/liquidity")
      .send({ anchor: "anchorA", asset: "USDC", amount: "500" });
    await request(app)
      .post("/api/v1/liquidity")
      .send({ anchor: "anchorB", asset: "USDC", amount: "300" });

    const res = await request(app).get("/api/v1/liquidity");
    expect(res.status).toBe(200);
    expect(res.body.pools).toEqual([
      {
        asset: "USDC",
        total: "800",
        anchors: 2,
        lastUpdated: expect.any(String),
      },
    ]);
  });

  it("reads a single pool by asset", async () => {
    const app = createApp();
    await request(app)
      .post("/api/v1/liquidity")
      .send({ anchor: "anchorA", asset: "USDC", amount: "500" });

    const res = await request(app).get("/api/v1/liquidity/usdc");
    expect(res.status).toBe(200);
    expect(res.body.total).toBe("500");
  });

  it("returns 400 for an invalid amount", async () => {
    const app = createApp();
    await request(app).post("/api/v1/anchors").send({ id: "anchorA" });
    await request(app)
      .post("/api/v1/liquidity")
      .send({ anchor: "anchorA", asset: "USDC", amount: "1000" });
    const res = await request(app)
      .post("/api/v1/liquidity")
      .send({ anchor: "anchorA", asset: "USDC", amount: "-1" });
    expect(res.status).toBe(400);
  });




  it("returns 404 for an unknown pool", async () => {
    const app = createApp();
    const res = await request(app).get("/api/v1/liquidity/XLM");

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
  });

  it("withdraws liquidity and returns the reduced entry", async () => {
    const app = createApp();
    await request(app)
      .post("/api/v1/liquidity")
      .send({ anchor: "anchorA", asset: "USDC", amount: "500" });

    const res = await request(app)
      .post("/api/v1/liquidity/withdraw")
      .send({ anchor: "anchorA", asset: "USDC", amount: "200" });

    expect(res.status).toBe(200);
    expect(res.body.amount).toBe("300");

    const pool = await request(app).get("/api/v1/liquidity/USDC");
    expect(pool.body.total).toBe("300");
  });

  it("removes the pool once the full balance is withdrawn", async () => {
    const app = createApp();
    await request(app)
      .post("/api/v1/liquidity")
      .send({ anchor: "anchorA", asset: "USDC", amount: "500" });

    const res = await request(app)
      .post("/api/v1/liquidity/withdraw")
      .send({ anchor: "anchorA", asset: "USDC", amount: "500" });

    expect(res.status).toBe(200);
    expect(res.body.amount).toBe("0");

    const pool = await request(app).get("/api/v1/liquidity/USDC");
    expect(pool.status).toBe(404);
  });

  it("returns 400 when withdrawing more than the available balance", async () => {
    const app = createApp();
    await request(app)
      .post("/api/v1/liquidity")
      .send({ anchor: "anchorA", asset: "USDC", amount: "100" });

    const res = await request(app)
      .post("/api/v1/liquidity/withdraw")
      .send({ anchor: "anchorA", asset: "USDC", amount: "200" });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INSUFFICIENT_LIQUIDITY");
  });

  it("returns 404 when withdrawing from an anchor with no balance", async () => {
    const app = createApp();
    const res = await request(app)
      .post("/api/v1/liquidity/withdraw")
      .send({ anchor: "anchorA", asset: "USDC", amount: "10" });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
  });

  it("deletes one anchor's entire liquidity entry", async () => {
    const app = createApp();
    await request(app)
      .post("/api/v1/liquidity")
      .send({ anchor: "anchorA", asset: "USDC", amount: "500" });
    await request(app)
      .post("/api/v1/liquidity")
      .send({ anchor: "anchorB", asset: "USDC", amount: "300" });

    const res = await request(app).delete("/api/v1/liquidity/anchorA/usdc");

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      anchor: "anchorA",
      asset: "USDC",
      amount: "500",
    });

    const entries = await request(app).get("/api/v1/liquidity/entries");
    expect(entries.body.entries).toHaveLength(1);
    expect(entries.body.entries[0].anchor).toBe("anchorB");
  });

  it("returns 404 when deleting a non-existent liquidity entry", async () => {
    const res = await request(createApp()).delete(
      "/api/v1/liquidity/anchorA/USDC",
    );

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
  });

  it("returns 400 for an invalid asset code format", async () => {
    const app = createApp();
    const res = await request(app)
      .post("/api/v1/liquidity")
      .send({ anchor: "anchorA", asset: "TOOLONGASSETCODE", amount: "500" });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("BAD_REQUEST");
  });

  it("returns 400 for exotic invalid amounts (NaN, Infinity, string amount)", async () => {
    const app = createApp();
    const badAmounts = [
      NaN,
      Infinity,
      -Infinity,
      -0,
      "abc",
      null,
      [5],
      {},
    ];
    for (const amount of badAmounts) {
      const res = await request(app)
        .post("/api/v1/liquidity")
        .send({ anchor: "anchorA", asset: "USDC", amount });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("BAD_REQUEST");
    }
  });

  it("lists entries by anchor via GET /anchors/:anchor", async () => {
    const app = createApp();
    await request(app)
      .post("/api/v1/liquidity")
      .send({ anchor: "anchorA", asset: "USDC", amount: "500" });
    await request(app)
      .post("/api/v1/liquidity")
      .send({ anchor: "anchorB", asset: "USDC", amount: "300" });
    await request(app)
      .post("/api/v1/liquidity")
      .send({ anchor: "anchorA", asset: "EURC", amount: "150" });

    const res = await request(app).get("/api/v1/liquidity/anchors/anchorA");

    expect(res.status).toBe(200);
    expect(res.body.entries).toHaveLength(2);

    const assets = res.body.entries.map((e: any) => e.asset).sort();
    expect(assets).toEqual(["EURC", "USDC"]);
  });

  it("does not shadow /:asset with /anchors/:anchor", async () => {
    const app = createApp();
    // Insert an asset named "anchors" just to be sure it can still be fetched
    await request(app)
      .post("/api/v1/liquidity")
      .send({ anchor: "anchorA", asset: "ANCHORS", amount: "500" });

    const res = await request(app).get("/api/v1/liquidity/ANCHORS");
    expect(res.status).toBe(200);
    expect(res.body.total).toBe("500");
  });

  it("the /entries static route takes precedence over /:asset", async () => {
    const app = createApp();
    const res = await request(app).get("/api/v1/liquidity/entries");

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.entries)).toBe(true);
    expect(res.body).toEqual({ entries: [] });
    expect(res.body).not.toHaveProperty("asset");
    expect(res.body).not.toHaveProperty("total");
    expect(res.body).not.toHaveProperty("error");
  });

  it("keeps /entries resolving to the entries list even with liquidity recorded", async () => {
    const app = createApp();
    await request(app)
      .post("/api/v1/liquidity")
      .send({ anchor: "anchorA", asset: "USDC", amount: "500" });

    const res = await request(app).get("/api/v1/liquidity/entries");

    expect(res.status).toBe(200);
    expect(res.body.entries).toHaveLength(1);
    expect(res.body.entries[0]).toMatchObject({
      anchor: "anchorA",
      asset: "USDC",
      amount: "500",
    });
    expect(res.body).not.toHaveProperty("total");
  });

  it("still resolves /entries to the entries list when an asset named ENTRIES exists", async () => {
    const app = createApp();
    await request(app)
      .post("/api/v1/liquidity")
      .send({ anchor: "anchorA", asset: "ENTRIES", amount: "42" });

    const res = await request(app).get("/api/v1/liquidity/entries");

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.entries)).toBe(true);
    expect(res.body.entries).toHaveLength(1);
    expect(res.body).not.toHaveProperty("total");
    expect(res.body).not.toHaveProperty("anchors");
    expect(res.body.entries[0]).toMatchObject({ asset: "ENTRIES", amount: "42" });
  });

  it("starts with an empty withdrawal history", async () => {
    const res = await request(createApp()).get("/api/v1/liquidity/withdrawals");

    expect(res.status).toBe(200);
    expect(res.body.withdrawals).toEqual([]);
  });

  it("records a successful withdrawal in the withdrawal history", async () => {
    const app = createApp();
    await request(app)
      .post("/api/v1/liquidity")
      .send({ anchor: "anchorA", asset: "USDC", amount: "500" });

    const res = await request(app)
      .post("/api/v1/liquidity/withdraw")
      .send({ anchor: "anchorA", asset: "USDC", amount: "200" });

    expect(res.status).toBe(200);

    const history = await request(app).get("/api/v1/liquidity/withdrawals");
    expect(history.status).toBe(200);
    expect(history.body.withdrawals).toHaveLength(1);
    expect(history.body.withdrawals[0]).toEqual({
      anchor: "anchorA",
      asset: "USDC",
      amount: "200",
      remainingBalance: "300",
      timestamp: expect.any(String),
    });
  });

  it("records a full withdrawal with a zero remaining balance", async () => {
    const app = createApp();
    await request(app)
      .post("/api/v1/liquidity")
      .send({ anchor: "anchorA", asset: "USDC", amount: "500" });

    await request(app)
      .post("/api/v1/liquidity/withdraw")
      .send({ anchor: "anchorA", asset: "USDC", amount: "500" });

    const history = await request(app).get("/api/v1/liquidity/withdrawals");
    expect(history.body.withdrawals[0].remainingBalance).toBe("0");
  });

  it("transfers liquidity between two anchors in a single atomic operation", async () => {
    const app = createApp();
    await request(app)
      .post("/api/v1/liquidity")
      .send({ anchor: "anchorA", asset: "USDC", amount: "500" });
    await request(app)
      .post("/api/v1/liquidity")
      .send({ anchor: "anchorB", asset: "USDC", amount: "300" });

    const res = await request(app)
      .post("/api/v1/liquidity/transfer")
      .send({ from: "anchorA", to: "anchorB", asset: "usdc", amount: "200" });

    expect(res.status).toBe(200);
    expect(res.body.from).toMatchObject({
      anchor: "anchorA",
      asset: "USDC",
      amount: "300",
    });
    expect(res.body.to).toMatchObject({
      anchor: "anchorB",
      asset: "USDC",
      amount: "500",
    });

    const pool = await request(app).get("/api/v1/liquidity/USDC");
    expect(pool.body.total).toBe("800");
    expect(pool.body.anchors).toBe(2);
  });

  it("creates the destination entry when transferring to an anchor with no balance", async () => {
    const app = createApp();
    await request(app)
      .post("/api/v1/liquidity")
      .send({ anchor: "anchorA", asset: "USDC", amount: "500" });

    const res = await request(app)
      .post("/api/v1/liquidity/transfer")
      .send({ from: "anchorA", to: "anchorB", asset: "USDC", amount: "500" });

    expect(res.status).toBe(200);
    expect(res.body.from.amount).toBe("0");
    expect(res.body.to.amount).toBe("500");

    const entries = await request(app).get("/api/v1/liquidity/entries");
    expect(entries.body.entries).toHaveLength(1);
    expect(entries.body.entries[0]).toMatchObject({
      anchor: "anchorB",
      amount: "500",
    });
  });

  it("returns 400 INSUFFICIENT_LIQUIDITY and leaves both balances unchanged", async () => {
    const app = createApp();
    await request(app)
      .post("/api/v1/liquidity")
      .send({ anchor: "anchorA", asset: "USDC", amount: "100" });
    await request(app)
      .post("/api/v1/liquidity")
      .send({ anchor: "anchorB", asset: "USDC", amount: "300" });

    const res = await request(app)
      .post("/api/v1/liquidity/transfer")
      .send({ from: "anchorA", to: "anchorB", asset: "USDC", amount: "200" });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INSUFFICIENT_LIQUIDITY");

    const entries = await request(app).get("/api/v1/liquidity/entries");
    const byAnchor = Object.fromEntries(
      entries.body.entries.map((e: any) => [e.anchor, e.amount]),
    );
    expect(byAnchor).toEqual({ anchorA: "100", anchorB: "300" });

    const pool = await request(app).get("/api/v1/liquidity/USDC");
    expect(pool.body.total).toBe("400");
  });

  it("returns 404 when transferring from an anchor with no balance", async () => {
    const app = createApp();
    await request(app)
      .post("/api/v1/liquidity")
      .send({ anchor: "anchorB", asset: "USDC", amount: "300" });

    const res = await request(app)
      .post("/api/v1/liquidity/transfer")
      .send({ from: "anchorA", to: "anchorB", asset: "USDC", amount: "10" });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOT_FOUND");

    const entries = await request(app).get("/api/v1/liquidity/entries");
    expect(entries.body.entries).toHaveLength(1);
    expect(entries.body.entries[0]).toMatchObject({
      anchor: "anchorB",
      amount: "300",
    });
  });

  it("returns 400 when transferring an anchor's liquidity to itself", async () => {
    const app = createApp();
    await request(app)
      .post("/api/v1/liquidity")
      .send({ anchor: "anchorA", asset: "USDC", amount: "100" });

    const res = await request(app)
      .post("/api/v1/liquidity/transfer")
      .send({ from: "anchorA", to: "anchorA", asset: "USDC", amount: "50" });

    expect(res.status).toBe(400);

    const pool = await request(app).get("/api/v1/liquidity/USDC");
    expect(pool.body.total).toBe("100");
  });
});
