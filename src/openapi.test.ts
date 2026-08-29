import request from "supertest";
import { createApp } from "./app";
import { buildOpenApiSpec } from "./openapi";

describe("openapi spec", () => {
  it("describes the anchors, settlements, liquidity, quote and metrics routes", () => {
    const spec = buildOpenApiSpec() as { paths: Record<string, unknown> };

    expect(spec.paths).toHaveProperty("/api/v1/audit");
    expect(spec.paths).toHaveProperty("/health/live");
    expect(spec.paths).toHaveProperty("/health/ready");
    expect(spec.paths).toHaveProperty("/api/v1/anchors");
    expect(spec.paths).toHaveProperty("/api/v1/anchors/{id}/reactivate");
    expect(spec.paths).toHaveProperty("/api/v1/anchors/bulk");
    expect(spec.paths).toHaveProperty("/api/v1/settlements");
    expect(spec.paths).toHaveProperty("/api/v1/liquidity");
    expect(spec.paths).toHaveProperty("/api/v1/liquidity/withdraw");
    expect(spec.paths).toHaveProperty("/api/v1/liquidity/withdrawals");
    expect(spec.paths).toHaveProperty("/api/v1/liquidity/{anchor}/{asset}");
    expect(spec.paths).toHaveProperty("/api/v1/quote");
    expect(spec.paths).toHaveProperty("/api/v1/metrics");
    expect(spec.paths).toHaveProperty("/api/v1/metrics/history");
    expect(spec.paths).toHaveProperty("/api/v1/settlements/{id}/audit");
  });

  it("serves the spec over GET /api/v1/openapi.json", async () => {
    const res = await request(createApp()).get("/api/v1/openapi.json");

    expect(res.status).toBe(200);
    expect(res.body.openapi).toBe("3.0.3");
    expect(res.body.paths["/api/v1/settlements"].get).toBeDefined();
    expect(res.body.paths["/api/v1/settlements"].get.parameters).toEqual(
      expect.arrayContaining(["sort", "order", "asset", "anchor"]),
    );
    expect(
      res.body.paths["/api/v1/liquidity/{anchor}/{asset}"].delete,
    ).toBeDefined();
  });

  it("documents the settled-value totals on GET /api/v1/metrics", () => {
    const spec = buildOpenApiSpec() as {
      paths: Record<string, { get: { description?: string } }>;
    };

    const metrics = spec.paths["/api/v1/metrics"].get;
    expect(metrics.description).toContain("totalSettledAmount");
    expect(metrics.description).toContain("totalFeesCollected");
    expect(metrics.description).toContain("executed settlements only");

    const history = spec.paths["/api/v1/metrics/history"].get;
    expect(history.description).toContain("totalSettledAmount");
    expect(history.description).toContain("totalFeesCollected");
  });

  it("declares the x-api-key security scheme and marks metrics as protected", () => {
    const spec = buildOpenApiSpec() as {
      components?: {
        securitySchemes?: Record<
          string,
          { type?: string; in?: string; name?: string }
        >;
      };
      paths: Record<string, { get: { security?: unknown[]; description?: string } }>;
    };

    const scheme = spec.components?.securitySchemes?.ApiKeyAuth;
    expect(scheme).toMatchObject({
      type: "apiKey",
      in: "header",
      name: "x-api-key",
    });

    expect(spec.paths["/api/v1/metrics"].get.security).toEqual([
      { ApiKeyAuth: [] },
    ]);
    expect(spec.paths["/api/v1/metrics/history"].get.security).toEqual([
      { ApiKeyAuth: [] },
    ]);
    expect(spec.paths["/api/v1/metrics/history"].get.description).toContain(
      "50",
    );
  });

  it("documents the dryRun preflight parameter on POST /api/v1/anchors/bulk", () => {
    const spec = buildOpenApiSpec() as {
      paths: Record<
        string,
        { post: { parameters?: string[]; description?: string } }
      >;
    };
    const operation = spec.paths["/api/v1/anchors/bulk"].post;

    expect(operation.parameters).toEqual(expect.arrayContaining(["dryRun"]));
    expect(operation.description).toContain("dryRun=true");
  });
});
