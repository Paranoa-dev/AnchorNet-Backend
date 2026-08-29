
import request from "supertest";
import { createApp } from "../app";

/**
 * Returns the header row of a CSV payload as a list of column names.
 *
 * Kept deliberately simple: `toCsv` only quotes a field when it contains a
 * comma, quote, or newline, and no column name does, so a plain split is
 * exact for the header row.
 */

describe("anchor routes", () => {


  it("rejects a repeated dryRun query param with 400", async () => {
    const app = createApp();

    const res = await request(app)
      .post("/api/v1/anchors/bulk?dryRun=true&dryRun=true")
      .send({ anchors: [{ id: "anchorA" }] });

    expect(res.status).toBe(400);

    const list = await request(app).get("/api/v1/anchors");
    expect(list.body.anchors).toHaveLength(0);
  });

  it("treats a bare ?dryRun (no value) as invalid rather than a real write", async () => {
    const app = createApp();

    const res = await request(app)
      .post("/api/v1/anchors/bulk?dryRun")
      .send({ anchors: [{ id: "anchorA" }] });

    expect(res.status).toBe(400);

    const list = await request(app).get("/api/v1/anchors");
    expect(list.body.anchors).toHaveLength(0);
  });

  it("lets a dry run be followed by a real commit of the same batch", async () => {
    const app = createApp();
    const body = { anchors: [{ id: "anchorA" }, { id: "anchorB" }] };

    const dry = await request(app)
      .post("/api/v1/anchors/bulk?dryRun=true")
      .send(body);
    expect(dry.status).toBe(201);

    const real = await request(app).post("/api/v1/anchors/bulk").send(body);
    expect(real.status).toBe(201);

    const list = await request(app).get("/api/v1/anchors");
    expect(list.body.anchors).toHaveLength(2);
});

});
