import express, { Express } from "express";
import request from "supertest";
import {
  createAuditLog,
  isSensitiveField,
  redactSensitiveData,
  SENSITIVE_FIELD_DENYLIST,
} from "./auditLog";

function makeApp(audit: ReturnType<typeof createAuditLog>): Express {
  const app = express();
  app.use(audit.middleware);
  app.post("/mutate", (_req, res) => res.status(201).json({ ok: true }));
  app.get("/read", (_req, res) => res.json({ ok: true }));
  return app;
}

describe("createAuditLog", () => {
  it("records a mutating request once its response finishes", async () => {
    const audit = createAuditLog();
    const app = makeApp(audit);

    await request(app).post("/mutate");

    expect(audit.entries()).toHaveLength(1);
    expect(audit.entries()[0]).toMatchObject({
      method: "POST",
      path: "/mutate",
      status: 201,
    });
  });

  it("does not record read-only requests", async () => {
    const audit = createAuditLog();
    const app = makeApp(audit);

    await request(app).get("/read");

    expect(audit.entries()).toHaveLength(0);
  });

  it("silently evicts the oldest entry once over the configured limit but exposes the evicted count", async () => {
    const audit = createAuditLog(2);
    const app = makeApp(audit);

    await request(app).post("/mutate");
    await request(app).post("/mutate");
    await request(app).post("/mutate");

    expect(audit.entries()).toHaveLength(2);
    expect(audit.evictedCount()).toBe(1);
  });
});

describe("audit log sensitive data redaction", () => {
  it("includes x-api-key, authorization, and secret fields in denylist", () => {
    expect(SENSITIVE_FIELD_DENYLIST.has("x-api-key")).toBe(true);
    expect(SENSITIVE_FIELD_DENYLIST.has("authorization")).toBe(true);
    expect(SENSITIVE_FIELD_DENYLIST.has("password")).toBe(true);
    expect(SENSITIVE_FIELD_DENYLIST.has("secret")).toBe(true);
    expect(SENSITIVE_FIELD_DENYLIST.has("token")).toBe(true);
  });

  it("matches denylisted fields case-insensitively", () => {
    expect(isSensitiveField("X-API-KEY")).toBe(true);
    expect(isSensitiveField("x-api-key")).toBe(true);
    expect(isSensitiveField("Authorization")).toBe(true);
    expect(isSensitiveField("AUTHORIZATION")).toBe(true);
    expect(isSensitiveField("Secret")).toBe(true);
  });

  it("redacts denylisted headers and body fields while preserving non-sensitive data", () => {
    const sensitiveData = {
      method: "POST",
      path: "/api/v1/anchors",
      headers: {
        "x-api-key": "secret_key_12345",
        "Authorization": "Bearer token_xyz",
        "content-type": "application/json",
      },
      body: {
        id: "anchor-1",
        name: "Test Anchor",
        password: "super_secret_password",
        nested: {
          token: "nested_token_abc",
          safeField: "safeValue",
        },
      },
    };

    const redacted = redactSensitiveData(sensitiveData);

    expect(redacted).toEqual({
      method: "POST",
      path: "/api/v1/anchors",
      headers: {
        "x-api-key": "[REDACTED]",
        "Authorization": "[REDACTED]",
        "content-type": "application/json",
      },
      body: {
        id: "anchor-1",
        name: "Test Anchor",
        password: "[REDACTED]",
        nested: {
          token: "[REDACTED]",
          safeField: "safeValue",
        },
      },
    });
  });

  it("handles null or primitive values gracefully", () => {
    expect(redactSensitiveData(null)).toBeNull();
    expect(redactSensitiveData(undefined)).toBeUndefined();
    expect(redactSensitiveData("plain_string")).toBe("plain_string");
    expect(redactSensitiveData(123)).toBe(123);
  });
});

