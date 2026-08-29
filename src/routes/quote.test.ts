import request from "supertest";
import { createApp } from "../app";
import { Express } from "express";

async function seedPool(app: Express): Promise<void> {
  await request(app)
    .post("/api/v1/liquidity")
    .send({ anchor: "big", asset: "USDC", amount: "1000" });
  await request(app)
    .post("/api/v1/liquidity")
    .send({ anchor: "mid", asset: "USDC", amount: "400" });
}

describe("quote routes", () => {
  it("returns a routing quote with fee and deliverable", async () => {
    const app = createApp();
    await seedPool(app);

    const res = await request(app)
      .post("/api/v1/quote")
      .send({ asset: "USDC", amount: "1000" });

    expect(res.status).toBe(200);
    expect(res.body.route).toEqual([{ anchor: "big", portion: "1000" }]);
    expect(res.body.fee).toBe("1");
    expect(res.body.deliverable).toBe("999");
  });

  it("returns a multi-anchor route when one anchor cannot cover the amount", async () => {
    const app = createApp();
    await seedPool(app);

    const res = await request(app)
      .post("/api/v1/quote")
      .send({ asset: "USDC", amount: "1200" });

    expect(res.status).toBe(200);
    expect(res.body.route).toEqual([
      { anchor: "big", portion: "1000" },
      { anchor: "mid", portion: "200" },
    ]);
  });

  it("returns 400 when liquidity is insufficient", async () => {
    const app = createApp();
    await seedPool(app);

    const res = await request(app)
      .post("/api/v1/quote")
      .send({ asset: "USDC", amount: "9999" });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INSUFFICIENT_LIQUIDITY");
  });

  it("applies a stricter rate limit than the general default", async () => {
    const app = createApp();
    await seedPool(app);

    for (let i = 0; i < 10; i++) {
      const res = await request(app)
        .post("/api/v1/quote")
        .send({ asset: "USDC", amount: "1" });
      expect(res.status).toBe(200);
    }

    const eleventh = await request(app)
      .post("/api/v1/quote")
      .send({ asset: "USDC", amount: "1" });

    expect(eleventh.status).toBe(429);
  });

  it("quote traffic does not consume the global mutating-request budget", async () => {
    const app = createApp();
    await seedPool(app);

    // 5 quote requests — well under the 10/min quote-specific limit.
    // With the global limiter excluded (the fix for #171), these should
    // NOT consume any of the 30-slot global mutating-request budget.
    for (let i = 0; i < 5; i++) {
      const res = await request(app)
        .post("/api/v1/quote")
        .send({ asset: "USDC", amount: "1" });
      expect(res.status).toBe(200);
    }

    // Seed consumed 2 global slots; quote traffic should consume 0.
    // All 28 remaining global slots should be available for other routes.
    for (let i = 0; i < 28; i++) {
      const res = await request(app)
        .post("/api/v1/liquidity")
        .send({ anchor: "big", asset: "USDC", amount: "1" });
      expect(res.status).toBe(201);
    }

    // The 31st total mutating request (2 seed + 28 liquidity) hits the
    // global 30/min limit.
    const overLimit = await request(app)
      .post("/api/v1/liquidity")
      .send({ anchor: "big", asset: "USDC", amount: "1" });
    expect(overLimit.status).toBe(429);
  });

  it("returns 400 for an invalid asset code format", async () => {
    const app = createApp();
    await seedPool(app);

    const res = await request(app)
      .post("/api/v1/quote")
      .send({ asset: "INVALID_ASSET!", amount: "1000" });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("BAD_REQUEST");
  });
});
