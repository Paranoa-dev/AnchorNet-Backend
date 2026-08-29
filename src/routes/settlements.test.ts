import request from "supertest";
import { createApp } from "../app";
import { Express } from "express";

/**
 * Returns the header row of a CSV payload as a list of column names.
 *
 * Kept deliberately simple: `toCsv` only quotes a field when it contains a
 * comma, quote, or newline, and no column name does, so a plain split is
 * exact for the header row.
 */
function parseHeaderRow(csv: string): string[] {
  return csv.split("\n")[0].split(",");
}

async function setup(app: Express): Promise<void> {
  await request(app).post("/api/v1/anchors").send({ id: "anchorA" });
  await request(app)
    .post("/api/v1/liquidity")
    .send({ anchor: "anchorA", asset: "USDC", amount: "1000" });
}

describe("settlement routes", () => {
  it("opens a settlement reserving liquidity", async () => {
    const app = createApp();
    await setup(app);

    const res = await request(app)
      .post("/api/v1/settlements")
      .send({ anchor: "anchorA", asset: "USDC", amount: "400" });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe("pending");
    expect(res.body.id).toBe(1);
  });

  it("executes a pending settlement", async () => {
    const app = createApp();
    await setup(app);
    const open = await request(app)
      .post("/api/v1/settlements")
      .send({ anchor: "anchorA", asset: "USDC", amount: "400" });

    const res = await request(app).post(
      `/api/v1/settlements/${open.body.id}/execute`,
    );
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("executed");
  });

  it("cancels a pending settlement", async () => {
    const app = createApp();
    await setup(app);
    const open = await request(app)
      .post("/api/v1/settlements")
      .send({ anchor: "anchorA", asset: "USDC", amount: "400" });

    const res = await request(app).post(
      `/api/v1/settlements/${open.body.id}/cancel`,
    );
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("cancelled");
  });

  it("records an optional reason when cancelling", async () => {
    const app = createApp();
    await setup(app);
    const open = await request(app)
      .post("/api/v1/settlements")
      .send({ anchor: "anchorA", asset: "USDC", amount: "400" });

    const res = await request(app)
      .post(`/api/v1/settlements/${open.body.id}/cancel`)

      .send({ reason: "duplicate request" });

    expect(res.status).toBe(200);
    expect(res.body.cancelReason).toBe("duplicate request");
  });

  it("rejects cancel reason over 500 characters", async () => {
    const app = createApp();
    await setup(app);
    const open = await request(app)
      .post("/api/v1/settlements")
      .send({ anchor: "anchorA", asset: "USDC", amount: "400" });

    const longReason = "a".repeat(501);
    const res = await request(app)
      .post(`/api/v1/settlements/${open.body.id}/cancel`)
      .send({ reason: longReason });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("BAD_REQUEST");
  });

  it("rejects settlement beyond available liquidity", async () => {
    const app = createApp();
    await setup(app);

    const res = await request(app)
      .post("/api/v1/settlements")
      .send({ anchor: "anchorA", asset: "USDC", amount: "5000" });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INSUFFICIENT_LIQUIDITY");
  });

  it("filters settlements by anchor", async () => {
    const app = createApp();
    await setup(app);
    await request(app)
      .post("/api/v1/settlements")
      .send({ anchor: "anchorA", asset: "USDC", amount: "100" });

    const res = await request(app).get("/api/v1/settlements?anchor=anchorA");
    expect(res.status).toBe(200);
    expect(res.body.settlements).toHaveLength(1);
  });

  it("filters settlements by asset", async () => {
    const app = createApp();
    await setup(app);
    await request(app)
      .post("/api/v1/settlements")
      .send({ anchor: "anchorA", asset: "USDC", amount: "100" });

    const matching = await request(app).get("/api/v1/settlements?asset=usdc");
    expect(matching.status).toBe(200);
    expect(matching.body.settlements).toHaveLength(1);

    const nonMatching = await request(app).get(
      "/api/v1/settlements?asset=EURC",
    );
    expect(nonMatching.body.settlements).toHaveLength(0);
  });

  it("sorts settlements by amount", async () => {
    const app = createApp();
    await setup(app);
    await request(app)
      .post("/api/v1/settlements")
      .send({ anchor: "anchorA", asset: "USDC", amount: "300" });
    await request(app)
      .post("/api/v1/settlements")
      .send({ anchor: "anchorA", asset: "USDC", amount: "100" });

    const asc = await request(app).get(
      "/api/v1/settlements?sort=amount&order=asc",
    );
    expect(asc.status).toBe(200);
    expect(
      asc.body.settlements.map((s: { amount: string }) => Number(s.amount)),
    ).toEqual([100, 300]);

    const desc = await request(app).get(
      "/api/v1/settlements?sort=amount&order=desc",
    );
    expect(
      desc.body.settlements.map((s: { amount: string }) => Number(s.amount)),
    ).toEqual([300, 100]);
  });

  it("sorts settlements by amount with 9 and 10 numerically", async () => {
    const app = createApp();
    await setup(app);
    await request(app)
      .post("/api/v1/settlements")
      .send({ anchor: "anchorA", asset: "USDC", amount: "10" });
    await request(app)
      .post("/api/v1/settlements")
      .send({ anchor: "anchorA", asset: "USDC", amount: "9" });
    await request(app)
      .post("/api/v1/settlements")
      .send({ anchor: "anchorA", asset: "USDC", amount: "100" });

    const asc = await request(app).get(
      "/api/v1/settlements?sort=amount&order=asc",
    );
    expect(asc.status).toBe(200);
    expect(
      asc.body.settlements.map((s: { amount: string }) => Number(s.amount)),
    ).toEqual([9, 10, 100]);
  });


  it("executes a pending settlement", async () => {
    const app = createApp();
    await setup(app);
    const open = await request(app)
      .post("/api/v1/settlements")
      .send({ anchor: "anchorA", asset: "USDC", amount: "400" });

    const res = await request(app).post(
      `/api/v1/settlements/${open.body.id}/execute`,
    );
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("executed");
  });

  it("cancels a pending settlement", async () => {
    const app = createApp();
    await setup(app);
    const open = await request(app)
      .post("/api/v1/settlements")
      .send({ anchor: "anchorA", asset: "USDC", amount: "400" });

    const res = await request(app).post(
      `/api/v1/settlements/${open.body.id}/cancel`,
    );
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("cancelled");
  });

  it("records a cancel reason when provided", async () => {
    const app = createApp();
    await setup(app);
    const open = await request(app)
      .post("/api/v1/settlements")
      .send({ anchor: "anchorA", asset: "USDC", amount: "400" });

    const res = await request(app)
      .post(`/api/v1/settlements/${open.body.id}/cancel`)
      .send({ reason: "duplicate request" });

    expect(res.status).toBe(200);
    expect(res.body.cancelReason).toBe("duplicate request");
  });

  it("rejects cancel reason over 500 characters", async () => {
    const app = createApp();
    await setup(app);
    const open = await request(app)
      .post("/api/v1/settlements")
      .send({ anchor: "anchorA", asset: "USDC", amount: "400" });

    const longReason = "a".repeat(501);
    const res = await request(app)
      .post(`/api/v1/settlements/${open.body.id}/cancel`)
      .send({ reason: longReason });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("BAD_REQUEST");
  });

  it("rejects settlement beyond available liquidity", async () => {
    const app = createApp();
    await setup(app);

    const res = await request(app)
      .post("/api/v1/settlements")
      .send({ anchor: "anchorA", asset: "USDC", amount: "5000" });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INSUFFICIENT_LIQUIDITY");
  });

  it("filters settlements by anchor", async () => {
    const app = createApp();
    await setup(app);
    await request(app)
      .post("/api/v1/settlements")
      .send({ anchor: "anchorA", asset: "USDC", amount: 100 });

    const res = await request(app).get("/api/v1/settlements?anchor=anchorA");
    expect(res.status).toBe(200);
    expect(res.body.settlements).toHaveLength(1);
  });

  it("filters settlements by asset", async () => {
    const app = createApp();
    await setup(app);
    await request(app)
      .post("/api/v1/settlements")
      .send({ anchor: "anchorA", asset: "USDC", amount: 100 });

    const matching = await request(app).get("/api/v1/settlements?asset=usdc");
    expect(matching.status).toBe(200);
    expect(matching.body.settlements).toHaveLength(1);

    const nonMatching = await request(app).get(
      "/api/v1/settlements?asset=EURC",
    );
    expect(nonMatching.body.settlements).toHaveLength(0);
  });

  it("sorts settlements by amount", async () => {
    const app = createApp();
    await setup(app);
    await request(app)
      .post("/api/v1/settlements")
      .send({ anchor: "anchorA", asset: "USDC", amount: 300 });
    await request(app)
      .post("/api/v1/settlements")
      .send({ anchor: "anchorA", asset: "USDC", amount: 100 });

    const asc = await request(app).get(
      "/api/v1/settlements?sort=amount&order=asc",
    );
    expect(asc.status).toBe(200);
    expect(
      asc.body.settlements.map((s: { amount: string }) => Number(s.amount)),
    ).toEqual([100, 300]);

    const desc = await request(app).get(
      "/api/v1/settlements?sort=amount&order=desc",
    );
    expect(
      desc.body.settlements.map((s: { amount: string }) => Number(s.amount)),
    ).toEqual([300, 100]);
  });

  it("sorts settlements by amount with 9 and 10 numerically", async () => {
    const app = createApp();
    await setup(app);
    await request(app)
      .post("/api/v1/settlements")
      .send({ anchor: "anchorA", asset: "USDC", amount: "10" });
    await request(app)
      .post("/api/v1/settlements")
      .send({ anchor: "anchorA", asset: "USDC", amount: "9" });
    await request(app)
      .post("/api/v1/settlements")
      .send({ anchor: "anchorA", asset: "USDC", amount: "100" });

    const asc = await request(app).get(
      "/api/v1/settlements?sort=amount&order=asc",
    );
    expect(asc.status).toBe(200);
    expect(
      asc.body.settlements.map((s: { amount: string }) => Number(s.amount)),
    ).toEqual([9, 10, 100]);
  });

  it("sorts settlements by fee", async () => {
    const app = createApp();
    await setup(app);
    const s1 = await request(app)
      .post("/api/v1/settlements")
      .send({ anchor: "anchorA", asset: "USDC", amount: "100" });
    const s2 = await request(app)
      .post("/api/v1/settlements")
      .send({ anchor: "anchorA", asset: "USDC", amount: "50" });
    const s3 = await request(app)
      .post("/api/v1/settlements")
      .send({ anchor: "anchorA", asset: "USDC", amount: "200" });

    const fees = [s1.body.fee, s2.body.fee, s3.body.fee];
    const sortedFees = [...fees].sort((a, b) => a - b);

    const asc = await request(app).get(
      "/api/v1/settlements?sort=fee&order=asc",
    );
    expect(asc.status).toBe(200);
    expect(asc.body.settlements.map((s: { fee: number }) => s.fee)).toEqual(
      sortedFees,
    );
  });

  it("sorts settlements by multiple fields (?sort=status,createdAt)", async () => {
    const app = createApp();
    await setup(app);
    await request(app)
      .post("/api/v1/settlements")
      .send({ anchor: "anchorA", asset: "USDC", amount: 100 });
    const s2 = await request(app)
      .post("/api/v1/settlements")
      .send({ anchor: "anchorA", asset: "USDC", amount: 200 });
    await request(app).post(`/api/v1/settlements/${s2.body.id}/execute`);
    await request(app)
      .post("/api/v1/settlements")
      .send({ anchor: "anchorA", asset: "USDC", amount: 300 });

    const res = await request(app).get(
      "/api/v1/settlements?sort=status,createdAt&order=asc,asc",
    );
    expect(res.status).toBe(200);
    expect(
      res.body.settlements.map((s: { status: string }) => s.status),
    ).toEqual(["executed", "pending", "pending"]);
  });

  it("returns 400 for an unknown sort field", async () => {
    const app = createApp();
    await setup(app);

    const res = await request(app).get("/api/v1/settlements?sort=bogus");
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("BAD_REQUEST");
  });

  it("exports the settlement list as CSV via ?format=csv, ignoring pagination", async () => {
    const app = createApp();
    await setup(app);
    const opened = await request(app)
      .post("/api/v1/settlements")
      .send({ anchor: "anchorA", asset: "USDC", amount: 400 });

    const res = await request(app).get(
      "/api/v1/settlements?format=csv&pageSize=1",
    );

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/csv/);
    expect(res.text).toBe(
      "id,anchor,asset,amount,fee,status,createdAt,cancelReason\n" +
        `${opened.body.id},anchorA,USDC,400,${opened.body.fee},pending,${opened.body.createdAt},\n`,
    );
  });

  it("returns 400 for exotic invalid IDs (NaN, Infinity, -0, true, array, object, unsafe integer)", async () => {
    const app = createApp();
    await setup(app);
    const badIds = [
      NaN,
      Infinity,
      -Infinity,
      -0,
      "NaN",
      "Infinity",
      "9007199254740992",
      "9007199254740993",
    ];
    for (const id of badIds) {
      const resGet = await request(app).get(`/api/v1/settlements/${id}`);
      expect(resGet.status).toBe(400);
      expect(resGet.body.error.code).toBe("BAD_REQUEST");

      const resExec = await request(app).post(
        `/api/v1/settlements/${id}/execute`,
      );
      expect(resExec.status).toBe(400);
      expect(resExec.body.error.code).toBe("BAD_REQUEST");
    }
  });
});

describe("GET /api/v1/settlements/:id/audit", () => {
  it("returns audit entries whose path references the settlement id", async () => {
    const app = createApp();
    await setup(app);
    const open = await request(app)
      .post("/api/v1/settlements")
      .send({ anchor: "anchorA", asset: "USDC", amount: 100 });
    const id = open.body.id;

    await request(app).post(`/api/v1/settlements/${id}/execute`);

    const res = await request(app).get(`/api/v1/settlements/${id}/audit`);
    expect(res.status).toBe(200);
    expect(res.body.entries).toBeInstanceOf(Array);
    for (const entry of res.body.entries) {
      expect(entry.path).toMatch(
        new RegExp(`^/api/v1/settlements/${id}(/|$)`),
      );
    }
  });

  it("returns an empty array when the settlement exists but has no matching audit entries", async () => {
    const app = createApp();
    await setup(app);
    const open = await request(app)
      .post("/api/v1/settlements")
      .send({ anchor: "anchorA", asset: "USDC", amount: 100 });
    const id = open.body.id;

    const res = await request(app).get(`/api/v1/settlements/${id}/audit`);
    expect(res.status).toBe(200);
    expect(res.body.entries).toEqual([]);
  });

  it("returns 404 for an unknown settlement id", async () => {
    const app = createApp();
    await setup(app);
    const res = await request(app).get("/api/v1/settlements/99999/audit");
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
  });

  it("returns 400 for an invalid settlement id", async () => {
    const app = createApp();
    const res = await request(app).get("/api/v1/settlements/NaN/audit");
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("BAD_REQUEST");
  });
});

describe("GET /api/v1/settlements?format=csv — column coverage", () => {
  /** The exact header the settlement CSV export is contracted to emit, in order. */
  const EXPECTED_SETTLEMENT_COLUMNS = [
    "id",
    "anchor",
    "asset",
    "amount",
    "fee",
    "status",
    "createdAt",
    "cancelReason",
  ];

  it("emits exactly the expected header columns, in order", async () => {
    const app = createApp();
    await setup(app);
    await request(app)
      .post("/api/v1/settlements")
      .send({ anchor: "anchorA", asset: "USDC", amount: 400 });

    const res = await request(app).get("/api/v1/settlements?format=csv");

    expect(res.status).toBe(200);
    expect(parseHeaderRow(res.text)).toEqual(EXPECTED_SETTLEMENT_COLUMNS);
  });

  it("emits the header even when no settlements exist", async () => {
    const res = await request(createApp()).get(
      "/api/v1/settlements?format=csv",
    );

    expect(res.status).toBe(200);
    expect(parseHeaderRow(res.text)).toEqual(EXPECTED_SETTLEMENT_COLUMNS);
  });

  // The drift guard: compares the header against the keys of a real serialized
  // settlement instead of a second hardcoded list, so a new `Settlement` field
  // surfaced by the API fails here even if the list above is not updated.
  // A cancelled settlement is used because `cancelReason` is optional and only
  // present once a reason has been recorded.
  it("covers every field of the JSON settlement representation", async () => {
    const app = createApp();
    await setup(app);
    const opened = await request(app)
      .post("/api/v1/settlements")
      .send({ anchor: "anchorA", asset: "USDC", amount: 400 });
    const cancelled = await request(app)
      .post(`/api/v1/settlements/${opened.body.id}/cancel`)
      .send({ reason: "operator requested" });

    const res = await request(app).get("/api/v1/settlements?format=csv");

    expect(parseHeaderRow(res.text).sort()).toEqual(
      Object.keys(cancelled.body).sort(),
    );
  });

  it("emits one value cell per header column for each data row", async () => {
    const app = createApp();
    await setup(app);
    await request(app)
      .post("/api/v1/settlements")
      .send({ anchor: "anchorA", asset: "USDC", amount: 100 });
    await request(app)
      .post("/api/v1/settlements")
      .send({ anchor: "anchorA", asset: "USDC", amount: 200 });

    const res = await request(app).get("/api/v1/settlements?format=csv");
    const [header, ...rows] = res.text.trimEnd().split("\n");

    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.split(",")).toHaveLength(header.split(",").length);
    }
  });
});

describe("GET /api/v1/settlements — pagination validation (#108)", () => {
  it("returns 400 for ?page=abc", async () => {
    const app = createApp();
    const res = await request(app).get("/api/v1/settlements?page=abc");
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("BAD_REQUEST");
    expect(res.body.error.message).toMatch(/"page" must be a positive integer/);
  });

  it("returns 400 for ?pageSize=xyz", async () => {
    const app = createApp();
    const res = await request(app).get("/api/v1/settlements?pageSize=xyz");
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("BAD_REQUEST");
  });

  it("returns 200 with default page for omitted params", async () => {
    const app = createApp();
    const res = await request(app).get("/api/v1/settlements");
    expect(res.status).toBe(200);
    expect(res.body.pagination.page).toBe(1);
    expect(res.body.pagination.pageSize).toBe(20);
  });

  it("returns 200 with default page for empty params", async () => {
    const app = createApp();
    const res = await request(app).get("/api/v1/settlements?page=&pageSize=");
    expect(res.status).toBe(200);
    expect(res.body.pagination.page).toBe(1);
  });
});
