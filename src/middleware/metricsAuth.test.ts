import request from "supertest";
import { createApp } from "../app";

/**
 * Metrics reads are protected whenever a credential is configured. These tests
 * exercise the three deployment shapes: open (no key), primary-key only, and a
 * dedicated read-only metrics key alongside the write key.
 */
describe("metricsAuth", () => {
  const originalApiKey = process.env.API_KEY;
  const originalMetricsKey = process.env.METRICS_API_KEY;

  afterEach(() => {
    if (originalApiKey === undefined) delete process.env.API_KEY;
    else process.env.API_KEY = originalApiKey;
    if (originalMetricsKey === undefined) delete process.env.METRICS_API_KEY;
    else process.env.METRICS_API_KEY = originalMetricsKey;
  });

  describe("open access when no key is configured", () => {
    beforeEach(() => {
      delete process.env.API_KEY;
      delete process.env.METRICS_API_KEY;
    });

    it("serves current metrics without a key", async () => {
      const res = await request(createApp()).get("/api/v1/metrics");
      expect(res.status).toBe(200);
    });

    it("serves metrics history without a key", async () => {
      const res = await request(createApp()).get("/api/v1/metrics/history");
      expect(res.status).toBe(200);
    });
  });

  describe("protected by the primary API key", () => {
    beforeEach(() => {
      process.env.API_KEY = "write-secret";
      delete process.env.METRICS_API_KEY;
    });

    it("rejects metrics reads without a key", async () => {
      const res = await request(createApp()).get("/api/v1/metrics");
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe("UNAUTHORIZED");
    });

    it("rejects history reads without a key", async () => {
      const res = await request(createApp()).get("/api/v1/metrics/history");
      expect(res.status).toBe(401);
    });

    it("rejects metrics reads with the wrong key", async () => {
      const res = await request(createApp())
        .get("/api/v1/metrics")
        .set("x-api-key", "nope");
      expect(res.status).toBe(401);
    });

    it("allows metrics reads with the primary key", async () => {
      const res = await request(createApp())
        .get("/api/v1/metrics")
        .set("x-api-key", "write-secret");
      expect(res.status).toBe(200);
      expect(res.body.anchors).toBe(0);
    });

    it("does not trigger a snapshot when a read is rejected", async () => {
      const app = createApp();
      // Rejected read must not leak data via the history side effect.
      await request(app).get("/api/v1/metrics");
      const res = await request(app)
        .get("/api/v1/metrics/history")
        .set("x-api-key", "write-secret");
      expect(res.status).toBe(200);
      expect(res.body.snapshots).toEqual([]);
    });
  });

  describe("dedicated read-only metrics key", () => {
    beforeEach(() => {
      process.env.API_KEY = "write-secret";
      process.env.METRICS_API_KEY = "read-only-scraper";
    });

    it("allows metrics reads with the read-only metrics key", async () => {
      const res = await request(createApp())
        .get("/api/v1/metrics")
        .set("x-api-key", "read-only-scraper");
      expect(res.status).toBe(200);
    });

    it("still allows metrics reads with the primary key", async () => {
      const res = await request(createApp())
        .get("/api/v1/metrics")
        .set("x-api-key", "write-secret");
      expect(res.status).toBe(200);
    });

    it("does not let the read-only metrics key authorize writes", async () => {
      const res = await request(createApp())
        .post("/api/v1/anchors")
        .set("x-api-key", "read-only-scraper")
        .send({ id: "anchorA" });
      expect(res.status).toBe(401);
    });

    it("rejects an unknown key", async () => {
      const res = await request(createApp())
        .get("/api/v1/metrics/history")
        .set("x-api-key", "guessed");
      expect(res.status).toBe(401);
    });
  });
});
