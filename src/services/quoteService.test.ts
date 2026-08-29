import { QuoteService } from "./quoteService";
import { LiquidityService } from "./liquidityService";
import { LiquidityRepository } from "../repositories/liquidityRepository";
import { ApiError } from "../errors/ApiError";

function seed() {
  const repo = new LiquidityRepository();
  const liquidity = new LiquidityService(repo);
  liquidity.addLiquidity({ anchor: "big", asset: "USDC", amount: 1000n });
  liquidity.addLiquidity({ anchor: "mid", asset: "USDC", amount: 400n });
  liquidity.addLiquidity({ anchor: "small", asset: "USDC", amount: 100n });
  return repo;
}

function repoWithTiedBalances(anchors: string[]) {
  const repo = new LiquidityRepository();
  const liquidity = new LiquidityService(repo);
  for (const anchor of anchors) {
    liquidity.addLiquidity({ anchor, asset: "USDC", amount: 100n });
  }
  return repo;
}

describe("QuoteService", () => {
  it("routes through the largest anchor first with the exact portion", () => {
    const quote = new QuoteService(seed()).quote({
      asset: "USDC",
      amount: 500n,
    });

    expect(quote.route).toEqual([{ anchor: "big", portion: 500n }]);
  });

  it("adds more anchors until the amount is covered with correct portions", () => {
    const quote = new QuoteService(seed()).quote({
      asset: "USDC",
      amount: 1200n,
    });

    expect(quote.route).toEqual([
      { anchor: "big", portion: 1000n },
      { anchor: "mid", portion: 200n },
    ]);
  });

  it("uses a fraction of an anchor when its balance exceeds remaining need", () => {
    const quote = new QuoteService(seed()).quote({
      asset: "USDC",
      amount: 50n,
    });

    expect(quote.route).toEqual([{ anchor: "big", portion: 50n }]);
  });

  it("drains all anchors when the amount equals the full pool", () => {
    const quote = new QuoteService(seed()).quote({
      asset: "USDC",
      amount: 1500n,
    });

    expect(quote.route).toEqual([
      { anchor: "big", portion: 1000n },
      { anchor: "mid", portion: 400n },
      { anchor: "small", portion: 100n },
    ]);
  });

  it("sum of portions equals the requested amount", () => {
    const quote = new QuoteService(seed()).quote({
      asset: "USDC",
      amount: 1200n,
    });

    const total = quote.route.reduce((s, e) => s + e.portion, 0n);
    expect(total).toBe(1200n);
  });

  it("applies the protocol fee and reports the deliverable", () => {
    const repo = new LiquidityRepository();
    new LiquidityService(repo).addLiquidity({
      anchor: "whale",
      asset: "USDC",
      amount: 50_000n,
    });

    const quote = new QuoteService(repo, 10n).quote({
      asset: "USDC",
      amount: 10_000n,
    });

    expect(quote.fee).toBe(10n);
    expect(quote.deliverable).toBe(9990n);
  });

  it("rounds the fee up for small amounts", () => {
    const quote = new QuoteService(seed(), 10n).quote({
      asset: "USDC",
      amount: 100n,
    });

    expect(quote.fee).toBe(1n);
  });

  it("orders tied anchor balances by anchor id regardless of insertion order", () => {
    const quoteWithAlphaInsertedFirst = new QuoteService(
      repoWithTiedBalances(["alpha", "bravo"]),
    ).quote({ asset: "USDC", amount: 200n });
    const quoteWithBravoInsertedFirst = new QuoteService(
      repoWithTiedBalances(["bravo", "alpha"]),
    ).quote({ asset: "USDC", amount: 200n });

    const expectedRoute = [
      { anchor: "alpha", portion: 100n },
      { anchor: "bravo", portion: 100n },
    ];
    expect(quoteWithAlphaInsertedFirst.route).toEqual(expectedRoute);
    expect(quoteWithBravoInsertedFirst.route).toEqual(expectedRoute);
  });

  it("rejects requests that exceed available liquidity", () => {
    expect(() =>
      new QuoteService(seed()).quote({ asset: "USDC", amount: 5000n }),
    ).toThrow(ApiError);
  });
});
