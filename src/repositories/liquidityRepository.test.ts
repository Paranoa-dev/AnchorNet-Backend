import { LiquidityRepository } from "./liquidityRepository";
import { LiquidityEntry } from "../models/liquidity";

function entry(
  anchor: string,
  asset: string,
  amount: bigint,
): LiquidityEntry {
  return { anchor, asset, amount, updatedAt: "2024-01-01T00:00:00.000Z" };
}

describe("LiquidityRepository", () => {
  it("upserts and retrieves entries by anchor and asset", () => {
    const repo = new LiquidityRepository();
    repo.upsert(entry("anchorA", "USDC", 100n));

    expect(repo.get("anchorA", "USDC")?.amount).toBe(100n);
    expect(repo.get("anchorA", "EURC")).toBeUndefined();
  });

  it("replaces an existing entry on upsert", () => {
    const repo = new LiquidityRepository();
    repo.upsert(entry("anchorA", "USDC", 100n));
    repo.upsert(entry("anchorA", "USDC", 250n));

    expect(repo.all()).toHaveLength(1);
    expect(repo.get("anchorA", "USDC")?.amount).toBe(250n);
  });

  it("filters entries by asset", () => {
    const repo = new LiquidityRepository();
    repo.upsert(entry("anchorA", "USDC", 100n));
    repo.upsert(entry("anchorB", "USDC", 50n));
    repo.upsert(entry("anchorA", "EURC", 75n));

    expect(repo.byAsset("USDC")).toHaveLength(2);
    expect(repo.byAsset("EURC")).toHaveLength(1);
  });

  it("filters entries by anchor", () => {
    const repo = new LiquidityRepository();
    repo.upsert(entry("anchorA", "USDC", 100n));
    repo.upsert(entry("anchorB", "USDC", 50n));
    repo.upsert(entry("anchorA", "EURC", 75n));

    expect(repo.byAnchor("anchorA")).toHaveLength(2);
    expect(repo.byAnchor("anchorB")).toHaveLength(1);
    expect(repo.byAnchor("anchorC")).toHaveLength(0);
  });

  it("aggregates pools per asset", () => {
    const repo = new LiquidityRepository();
    repo.upsert({ ...entry("anchorA", "USDC", 100n), updatedAt: "2024-01-01T00:00:00.000Z" });
    repo.upsert({ ...entry("anchorB", "USDC", 50n), updatedAt: "2024-01-02T00:00:00.000Z" });

    const pools = repo.pools();
    const usdc = pools.find((p) => p.asset === "USDC");
    expect(usdc).toEqual({ asset: "USDC", total: 150n, anchors: 2, lastUpdated: "2024-01-02T00:00:00.000Z" });
  });

  it("removes entries", () => {
    const repo = new LiquidityRepository();
    repo.upsert(entry("anchorA", "USDC", 100n));

    expect(repo.remove("anchorA", "USDC")).toBe(true);
    expect(repo.remove("anchorA", "USDC")).toBe(false);
    expect(repo.all()).toHaveLength(0);
  });
});
