import { loadConfig, validateConfig, ConfigValidationError } from "./config";

describe("loadConfig", () => {
  it("applies defaults when env is empty", () => {
    const config = loadConfig({});
    expect(config.port).toBe(3001);
    expect(config.feeBps).toBe(10);
    expect(config.apiKey).toBeUndefined();
    expect(config.env).toBe("development");
  });

  it("reads values from the environment", () => {
    const config = loadConfig({
      PORT: "8080",
      FEE_BPS: "25",
      API_KEY: "secret",
      NODE_ENV: "production",
    });
    expect(config.port).toBe(8080);
    expect(config.feeBps).toBe(25);
    expect(config.apiKey).toBe("secret");
    expect(config.env).toBe("production");
  });

  it("falls back to defaults for non-numeric values", () => {
    const config = loadConfig({ PORT: "abc" });
    expect(config.port).toBe(3001);
  });

  it("treats a blank API key as unset", () => {
    const config = loadConfig({ API_KEY: "   " });
    expect(config.apiKey).toBeUndefined();
  });

  it("throws when FEE_BPS is negative", () => {
    expect(() => loadConfig({ FEE_BPS: "-1" })).toThrow(
      "FEE_BPS must be between 0 and 10000 (got -1)",
    );
  });

  it("throws when FEE_BPS exceeds 10000", () => {
    expect(() => loadConfig({ FEE_BPS: "10001" })).toThrow(
      "FEE_BPS must be between 0 and 10000 (got 10001)",
    );
  });

  it("accepts the boundary FEE_BPS values", () => {
    expect(loadConfig({ FEE_BPS: "0" }).feeBps).toBe(0);
    expect(loadConfig({ FEE_BPS: "10000" }).feeBps).toBe(10000);
  });

  it("leaves the CORS allowlist undefined when unset", () => {
    expect(loadConfig({}).corsOrigins).toBeUndefined();
  });

  describe("validateConfig (fail-fast contract)", () => {
    it("throws ConfigValidationError when API_KEY is missing in production", () => {
      expect(() => loadConfig({ NODE_ENV: "production" })).toThrow(
        ConfigValidationError,
      );
      expect(() => loadConfig({ NODE_ENV: "production" })).toThrow(/API_KEY/);
    });

    it("throws when API_KEY is present-but-blank in production (treated as unset)", () => {
      expect(() =>
        validateConfig(loadConfig({ NODE_ENV: "production", API_KEY: "   " })),
      ).toThrow(ConfigValidationError);
    });

    it("allows a missing API_KEY in development (historical open access preserved)", () => {
      expect(() => loadConfig({ NODE_ENV: "development" })).not.toThrow();
      expect(() => loadConfig({})).not.toThrow();
    });

    it("allows a missing API_KEY in test", () => {
      expect(() => loadConfig({ NODE_ENV: "test" })).not.toThrow();
    });

    it("accepts a configured API_KEY in production", () => {
      expect(() =>
        loadConfig({ NODE_ENV: "production", API_KEY: "secret" }),
      ).not.toThrow();
    });

    it("names the offending variable on the thrown error", () => {
      try {
        validateConfig(loadConfig({ NODE_ENV: "production" }));
        throw new Error("expected validateConfig to throw");
      } catch (err) {
        expect(err).toBeInstanceOf(ConfigValidationError);
        expect((err as ConfigValidationError).variable).toBe("API_KEY");
      }
    });
  });

  it("parses a comma-separated CORS_ORIGIN allowlist", () => {
    const config = loadConfig({
      CORS_ORIGIN: "https://a.example, https://b.example",
    });
    expect(config.corsOrigins).toEqual([
      "https://a.example",
      "https://b.example",
    ]);
  });

  it("treats a blank CORS_ORIGIN as unset", () => {
    expect(loadConfig({ CORS_ORIGIN: "  ,  " }).corsOrigins).toBeUndefined();
  });

  it.each([
    "http://localhost:3000",
    "https://api.example.com",
    "https://api.example.com:8443",
    "https://[2001:db8::1]:8443",
  ])("accepts the valid CORS origin %p", (origin) => {
    expect(loadConfig({ CORS_ORIGIN: origin }).corsOrigins).toEqual([origin]);
  });

  it.each([
    "example.com",
    "*",
    "ftp://example.com",
    "https://user:password@example.com",
    "https://example.com/path",
    "https://example.com?query=value",
    "https://example.com#fragment",
  ])("rejects the invalid CORS origin %p", (origin) => {
    expect(() => loadConfig({ CORS_ORIGIN: origin })).toThrow(
      `CORS_ORIGIN contains an invalid origin: ${JSON.stringify(origin)}`,
    );
  });

  it("rejects the full allowlist when one CORS origin is malformed", () => {
    expect(() =>
      loadConfig({
        CORS_ORIGIN: "https://valid.example, example.com",
      }),
    ).toThrow(/example\.com/);
  });

  it("defaults the JSON body size limit to 100kb", () => {
    expect(loadConfig({}).bodyLimit).toBe("100kb");
  });

  it("reads a configured JSON body size limit", () => {
    expect(loadConfig({ BODY_LIMIT: "1mb" }).bodyLimit).toBe("1mb");
  });

  it("falls back to the default body limit for a blank value", () => {
    expect(loadConfig({ BODY_LIMIT: "   " }).bodyLimit).toBe("100kb");
  });

  it("defaults maintenance mode to disabled", () => {
    expect(loadConfig({}).maintenanceMode).toBe(false);
  });

  it.each(["1", "true", "TRUE", " true "])(
    "enables maintenance mode for MAINTENANCE_MODE=%p",
    (value) => {
      expect(loadConfig({ MAINTENANCE_MODE: value }).maintenanceMode).toBe(
        true,
      );
    },
  );

  it.each(["0", "false", "", undefined])(
    "leaves maintenance mode disabled for MAINTENANCE_MODE=%p",
    (value) => {
      expect(loadConfig({ MAINTENANCE_MODE: value }).maintenanceMode).toBe(
        false,
      );
    },
  );

  it("defaults idempotency and rate limiting options", () => {
    const config = loadConfig({});
    expect(config.idempotencyTtlMs).toBe(86_400_000);
    expect(config.rateLimitMax).toBe(30);
    expect(config.rateLimitWindowMs).toBe(60_000);
  });

  it("reads idempotency and rate limiting options from the environment", () => {
    const config = loadConfig({
      IDEMPOTENCY_TTL_MS: "3600000",
      RATE_LIMIT_MAX: "100",
      RATE_LIMIT_WINDOW_MS: "120000",
    });
    expect(config.idempotencyTtlMs).toBe(3600000);
    expect(config.rateLimitMax).toBe(100);
    expect(config.rateLimitWindowMs).toBe(120000);
  });

  it("leaves the metrics API key unset by default", () => {
    expect(loadConfig({}).metricsApiKey).toBeUndefined();
  });

  it("reads a configured metrics API key", () => {
    expect(loadConfig({ METRICS_API_KEY: "scraper" }).metricsApiKey).toBe(
      "scraper",
    );
  });

  it("treats a blank metrics API key as unset", () => {
    expect(loadConfig({ METRICS_API_KEY: "   " }).metricsApiKey).toBeUndefined();
  });

  it("defaults the metrics read rate limit", () => {
    const config = loadConfig({});
    expect(config.metricsRateLimitMax).toBe(120);
    expect(config.metricsRateLimitWindowMs).toBe(60_000);
  });

  it("reads the metrics read rate limit from the environment", () => {
    const config = loadConfig({
      METRICS_RATE_LIMIT_MAX: "10",
      METRICS_RATE_LIMIT_WINDOW_MS: "5000",
    });
    expect(config.metricsRateLimitMax).toBe(10);
    expect(config.metricsRateLimitWindowMs).toBe(5000);
  });

  describe("TRUST_PROXY", () => {
    it('parses "true" to boolean true', () => {
      expect(loadConfig({ TRUST_PROXY: "true" }).trustProxy).toBe(true);
    });

    it('parses "false" to boolean false', () => {
      expect(loadConfig({ TRUST_PROXY: "false" }).trustProxy).toBe(false);
    });

    it('parses "1" to boolean true', () => {
      expect(loadConfig({ TRUST_PROXY: "1" }).trustProxy).toBe(true);
    });

    it('parses "0" to boolean false', () => {
      expect(loadConfig({ TRUST_PROXY: "0" }).trustProxy).toBe(false);
    });

    it("parses a numeric string to a number", () => {
      expect(loadConfig({ TRUST_PROXY: "2" }).trustProxy).toBe(2);
    });

    it("passes a non-numeric string through", () => {
      expect(loadConfig({ TRUST_PROXY: "loopback" }).trustProxy).toBe(
        "loopback",
      );
    });

    it("defaults to false when unset", () => {
      expect(loadConfig({}).trustProxy).toBe(false);
    });
  });
});

describe("validateConfig", () => {
  it("returns the config unchanged when valid", () => {
    const config = loadConfig({ API_KEY: "secret", PORT: "3001" });
    expect(validateConfig(config)).toBe(config);
  });

  it("requires API_KEY in production and fails fast", () => {
    const config = loadConfig({ NODE_ENV: "production" });
    expect(() => validateConfig(config)).toThrow(ConfigValidationError);
    expect(() => validateConfig(config)).toThrow(/API_KEY is required/);
  });

  it("allows a production deploy that sets API_KEY", () => {
    const config = loadConfig({ NODE_ENV: "production", API_KEY: "secret" });
    expect(() => validateConfig(config)).not.toThrow();
  });

  it("does NOT require API_KEY in development (open access is allowed, not fatal)", () => {
    const config = loadConfig({ NODE_ENV: "development" });
    expect(() => validateConfig(config)).not.toThrow();
  });

  it("does NOT require API_KEY in test", () => {
    const config = loadConfig({ NODE_ENV: "test" });
    expect(() => validateConfig(config)).not.toThrow();
  });

  it("fails fast on an out-of-range PORT", () => {
    const config = loadConfig({ PORT: "0" });
    expect(() => validateConfig(config)).toThrow(ConfigValidationError);
    expect(() => validateConfig(config)).toThrow(/PORT must be/);
  });

  it("fails fast on a non-integer PORT", () => {
    const config = loadConfig({ PORT: "3001.5" });
    expect(() => validateConfig(config)).toThrow(ConfigValidationError);
  });

  it("fails fast on a negative RATE_LIMIT_MAX", () => {
    const config = loadConfig({ RATE_LIMIT_MAX: "-1" });
    expect(() => validateConfig(config)).toThrow(ConfigValidationError);
  });

  it("fails fast on a negative IDEMPOTENCY_TTL_MS", () => {
    const config = loadConfig({ IDEMPOTENCY_TTL_MS: "-1" });
    expect(() => validateConfig(config)).toThrow(ConfigValidationError);
  });
});
