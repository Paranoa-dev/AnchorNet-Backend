import { SettlementRepository } from "./settlementRepository";
import { Settlement, isSettlementStatus } from "../models/settlement";

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

describe("SettlementRepository", () => {
  it("assigns incrementing ids", () => {
    const repo = new SettlementRepository();
    const first = repo.create(draft("anchorA", 100n));
    const second = repo.create(draft("anchorB", 200n));

    expect(first.id).toBe(1);
    expect(second.id).toBe(2);
    expect(repo.peekNextId()).toBe(3);
  });

  describe("save anchor reindex", () => {
    it("rebuilds the anchor index when save() changes the anchor", () => {
      const repo = new SettlementRepository();
      const created = repo.create(draft("anchorA", 100n)); // id 1, indexed under anchorA

      repo.save({ ...created, anchor: "anchorB" }); // anchor changes

      expect(repo.get(created.id)?.anchor).toBe("anchorB");
      expect(repo.byAnchor("anchorA")).toHaveLength(0);
      expect(repo.byAnchor("anchorB")).toHaveLength(1);
    });
  });

  describe("peekNextId", () => {
    it("previews the id that the immediately following create() yields", () => {
      const repo = new SettlementRepository();

      const previewed = repo.peekNextId();
      const created = repo.create(draft("anchorA", 100n));

      // Locks in the synchronous-only guarantee: peek -> create (no await in
      // between) must return the exact id that was previewed. If this ever
      // regresses (e.g. an async boundary is introduced between peek and
      // create) the contract documented on SettlementRepository.peekNextId()
      // would be violated.
      expect(created.id).toBe(previewed);
      // The counter has advanced exactly once after the create.
      expect(repo.peekNextId()).toBe(previewed + 1);
    });

    it("yields a stable preview when no create() runs in between", () => {
      const repo = new SettlementRepository();
      repo.create(draft("anchorA", 100n));

      const first = repo.peekNextId();
      const second = repo.peekNextId();
      expect(first).toBe(second);
      expect(first).toBe(2);
    });
  });

  it("saves status changes", () => {
    const repo = new SettlementRepository();
    const created = repo.create(draft("anchorA", 100n));
    repo.save({ ...created, status: "executed" });

    expect(repo.get(created.id)?.status).toBe("executed");
  });

  it("lists settlements most recent first", () => {
    const repo = new SettlementRepository();
    repo.create(draft("anchorA", 100n));
    repo.create(draft("anchorB", 200n));

    expect(repo.all().map((s) => s.id)).toEqual([2, 1]);
  });

  it("filters by anchor", () => {
    const repo = new SettlementRepository();
    repo.create(draft("anchorA", 100n));
    repo.create(draft("anchorB", 200n));
    repo.create(draft("anchorA", 300n));

    expect(repo.byAnchor("anchorA")).toHaveLength(2);
    expect(repo.count()).toBe(3);
  });

  describe("remove", () => {
    it("removes an existing settlement and returns true", () => {
      const repo = new SettlementRepository();
      const s = repo.create(draft("anchorA", 100n));
      expect(repo.count()).toBe(1);

      const result = repo.remove(s.id);
      expect(result).toBe(true);
      expect(repo.get(s.id)).toBeUndefined();
      expect(repo.count()).toBe(0);
      expect(repo.all()).toHaveLength(0);
      expect(repo.byAnchor("anchorA")).toHaveLength(0);
    });

    it("returns false when removing a non-existent id", () => {
      const repo = new SettlementRepository();
      repo.create(draft("anchorA", 100n));

      const result = repo.remove(999);
      expect(result).toBe(false);
      expect(repo.count()).toBe(1);
    });
  });
});

describe("isSettlementStatus", () => {
  it("accepts all valid statuses", () => {
    expect(isSettlementStatus("pending")).toBe(true);
    expect(isSettlementStatus("executed")).toBe(true);
    expect(isSettlementStatus("cancelled")).toBe(true);
  });

  it("rejects invalid strings", () => {
    expect(isSettlementStatus("unknown")).toBe(false);
    expect(isSettlementStatus("")).toBe(false);
  });

  it("rejects near-miss strings (exact match only)", () => {
    expect(isSettlementStatus("Pending")).toBe(false);
    expect(isSettlementStatus("pending ")).toBe(false);
    expect(isSettlementStatus("PENDING")).toBe(false);
  });

  it("rejects non-string values", () => {
    expect(isSettlementStatus(123)).toBe(false);
    expect(isSettlementStatus(null)).toBe(false);
    expect(isSettlementStatus(undefined)).toBe(false);
    expect(isSettlementStatus({})).toBe(false);
  });
});

describe("SettlementRepository rejects invalid status", () => {
  it("save throws on invalid status", () => {
    const repo = new SettlementRepository();
    const created = repo.create(draft("anchorA", 100n));
    const invalid = { ...created, status: "bogus" } as unknown as Settlement;

    expect(() => repo.save(invalid)).toThrow(/Invalid settlement status/);
  });

  it("create throws on invalid status", () => {
    const repo = new SettlementRepository();
    const invalid = {
      ...draft("anchorA", 100n),
      status: "bogus",
    } as unknown as Omit<Settlement, "id">;

    expect(() => repo.create(invalid)).toThrow(/Invalid settlement status/);
  });
});

