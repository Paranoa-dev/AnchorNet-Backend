import { SettlementRepository } from "./settlementRepository";
import { Settlement } from "../models/settlement";

function draft(anchor: string, amount: bigint): Omit<Settlement, "id"> {
  return {
    anchor,
    asset: "USDC",
    amount,
    fee: 0n,
    status: "pending",
    createdAt: "2024-01-01T00:00:00.000Z",
  };
}

describe("SettlementRepository Anchor Index", () => {
  it("returns empty array for unknown anchor", () => {
    const repo = new SettlementRepository();
    expect(repo.byAnchor("nonexistent")).toEqual([]);
  });

  it("returns settlements for an anchor sorted most recent first", () => {
    const repo = new SettlementRepository();
    repo.create(draft("anchorA", 100n)); // id 1
    repo.create(draft("anchorA", 200n)); // id 2
    repo.create(draft("anchorB", 300n)); // id 3
    const result = repo.byAnchor("anchorA");
    expect(result.map((s) => s.id)).toEqual([2, 1]);
    expect(result).toHaveLength(2);
    expect(repo.byAnchor("anchorB").map((s) => s.id)).toEqual([3]);
  });

  it("maintains index after save without anchor change", () => {
    const repo = new SettlementRepository();
    const created = repo.create(draft("anchorA", 100n)); // id 1
    repo.save({ ...created, status: "executed" });
    const byAnchor = repo.byAnchor("anchorA");
    expect(byAnchor).toHaveLength(1);
    expect(byAnchor[0].status).toBe("executed");
  });
});
