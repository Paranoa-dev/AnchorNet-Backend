import { SettlementService } from "./settlementService";
import { LiquidityService } from "./liquidityService";
import { LiquidityRepository } from "../repositories/liquidityRepository";
import { SettlementRepository } from "../repositories/settlementRepository";
import { AnchorService } from "./anchorService";
import { AnchorRepository } from "../repositories/anchorRepository";
import { ApiError } from "../errors/ApiError";

function harness(liquidity = 1000n) {
  const liquidityRepo = new LiquidityRepository();
  const anchors = new AnchorService(new AnchorRepository());
  anchors.register({ id: "anchorA" });
  new LiquidityService(liquidityRepo).addLiquidity({
    anchor: "anchorA",
    asset: "USDC",
    amount: liquidity,
  });
  const service = new SettlementService(
    new SettlementRepository(),
    liquidityRepo,
    anchors,
    10n,
  );
  return { service, anchors };
}

describe("SettlementService", () => {
  it("opens a settlement and reserves liquidity", () => {
    const { service } = harness(1000n);
    const settlement = service.open({
      anchor: "anchorA",
      asset: "USDC",
      amount: 400n,
    });

    expect(settlement.status).toBe("pending");
    expect(settlement.fee.toString()).toBe("1"); // 10 bps of 400, rounded up
    expect(service.available("USDC").toString()).toBe("600");
  });

  it("rejects settlement above available liquidity", () => {
    const { service } = harness(100n);
    expect(() =>
      service.open({ anchor: "anchorA", asset: "USDC", amount: 500n }),
    ).toThrow(ApiError);
  });

  it("rejects settlement from an inactive anchor", () => {
    const { service, anchors } = harness(1000n);
    anchors.deregister("anchorA");

    expect(() =>
      service.open({ anchor: "anchorA", asset: "USDC", amount: 100n }),
    ).toThrow(ApiError);
  });

  it("releases reserved liquidity on cancel", () => {
    const { service } = harness(1000n);
    const settlement = service.open({
      anchor: "anchorA",
      asset: "USDC",
      amount: 400n,
    });
    expect(service.available("USDC").toString()).toBe("600");

    service.cancel(settlement.id);
    expect(service.available("USDC").toString()).toBe("1000");
  });

  it("records an optional reason when cancelling", () => {
    const { service } = harness(1000n);
    const settlement = service.open({
      anchor: "anchorA",
      asset: "USDC",
      amount: 400n,
    });

    const cancelled = service.cancel(settlement.id, "duplicate request");
    expect(cancelled.cancelReason).toBe("duplicate request");
  });

  it("leaves cancelReason undefined when none is given", () => {
    const { service } = harness(1000n);
    const settlement = service.open({
      anchor: "anchorA",
      asset: "USDC",
      amount: 400n,
    });

    const cancelled = service.cancel(settlement.id);
    expect(cancelled.cancelReason).toBeUndefined();
  });

  it("rejects a blank cancel reason", () => {
    const { service } = harness(1000n);
    const settlement = service.open({
      anchor: "anchorA",
      asset: "USDC",
      amount: 400n,
    });

    expect(() => service.cancel(settlement.id, "   ")).toThrow(ApiError);
  });

  it("rejects a cancel reason exceeding 500 characters", () => {
    const { service } = harness(1000n);
    const settlement = service.open({
      anchor: "anchorA",
      asset: "USDC",
      amount: 400n,
    });

    const longReason = "a".repeat(501);
    expect(() => service.cancel(settlement.id, longReason)).toThrow(ApiError);
  });

  it("accepts a cancel reason at exactly 500 characters", () => {
    const { service } = harness(1000n);
    const settlement = service.open({
      anchor: "anchorA",
      asset: "USDC",
      amount: 400n,
    });

    const maxReason = "a".repeat(500);
    const cancelled = service.cancel(settlement.id, maxReason);
    expect(cancelled.cancelReason).toBe(maxReason);
  });

  it("consumes liquidity on execute", () => {
    const { service } = harness(1000n);
    const settlement = service.open({
      anchor: "anchorA",
      asset: "USDC",
      amount: 400n,
    });

    service.execute(settlement.id);
    expect(service.get(settlement.id).status).toBe("executed");
    // Executed liquidity does not return to the available pool.
    expect(service.available("USDC").toString()).toBe("600");
  });

  it("rejects executing a non-pending settlement", () => {
    const { service } = harness(1000n);
    const settlement = service.open({
      anchor: "anchorA",
      asset: "USDC",
      amount: 100n,
    });
    service.execute(settlement.id);

    expect(() => service.execute(settlement.id)).toThrow(ApiError);
  });

  it("throws 404 for an unknown settlement", () => {
    const { service } = harness(1000n);
    expect(() => service.get(999)).toThrow(ApiError);
  });

  it("filters settlements by asset", () => {
    const { service } = harness(1000n);
    service.open({ anchor: "anchorA", asset: "USDC", amount: 100n });

    expect(service.list({ asset: "USDC" })).toHaveLength(1);
    expect(service.list({ asset: "EURC" })).toHaveLength(0);
  });

  it("combines anchor and asset filters", () => {
    const { service } = harness(1000n);
    service.open({ anchor: "anchorA", asset: "USDC", amount: 100n });

    expect(service.list({ anchor: "anchorA", asset: "USDC" })).toHaveLength(
      1,
    );
    expect(service.list({ anchor: "anchorA", asset: "EURC" })).toHaveLength(
      0,
    );
  });
});
