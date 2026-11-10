import { describe, it, expect } from "vitest";
import {
  evaluateRefundPolicy,
  lastDayOfRefundWindow,
  RefundIneligibility,
  WATCH_LIMIT_SECONDS,
  REFUND_WINDOW_DAYS,
  type RefundPolicyFacts,
} from "./refunds.server";

// Local-time construction, matching how the policy compares calendar days.
const purchased = new Date(2026, 0, 10, 23, 0, 0);

function facts(overrides: Partial<RefundPolicyFacts> = {}): RefundPolicyFacts {
  return {
    purchasedAt: purchased.toISOString(),
    today: new Date(2026, 0, 12, 12, 0, 0),
    hasOpenRefundRequest: false,
    hasClaimedSeat: false,
    watched: 0,
    ...overrides,
  };
}

function daysAfterPurchase(days: number, hour = 12) {
  const when = new Date(purchased);
  when.setDate(when.getDate() + days);
  when.setHours(hour, 0, 0, 0);
  return when;
}

describe("evaluateRefundPolicy", () => {
  it("is eligible when every rule holds", () => {
    expect(evaluateRefundPolicy(facts())).toEqual({
      eligible: true,
      lastDayInWindow: lastDayOfRefundWindow(purchased.toISOString()),
    });
  });

  // ─── Refund Window ───

  it("counts the window in whole days: the last day is in, even late at night", () => {
    const result = evaluateRefundPolicy(
      facts({ today: daysAfterPurchase(REFUND_WINDOW_DAYS, 23) })
    );
    expect(result.eligible).toBe(true);
  });

  it("closes the window the morning after the last day", () => {
    const result = evaluateRefundPolicy(
      facts({ today: daysAfterPurchase(REFUND_WINDOW_DAYS + 1, 0) })
    );
    expect(result).toEqual({
      eligible: false,
      reason: RefundIneligibility.WindowClosed,
    });
  });

  it("treats a purchase dated in the future as outside the window", () => {
    const result = evaluateRefundPolicy(
      facts({ today: daysAfterPurchase(-1) })
    );
    expect(result).toEqual({
      eligible: false,
      reason: RefundIneligibility.WindowClosed,
    });
  });

  // ─── Watch Limit ───

  it("allows one second under the Watch Limit", () => {
    const result = evaluateRefundPolicy(
      facts({ watched: WATCH_LIMIT_SECONDS - 1 })
    );
    expect(result.eligible).toBe(true);
  });

  it("refuses at exactly the Watch Limit", () => {
    const result = evaluateRefundPolicy(
      facts({ watched: WATCH_LIMIT_SECONDS })
    );
    expect(result).toEqual({
      eligible: false,
      reason: RefundIneligibility.WatchLimitReached,
    });
  });

  // ─── Ownership ───

  it("refuses a Team Licence with a Claimed Seat", () => {
    expect(evaluateRefundPolicy(facts({ hasClaimedSeat: true }))).toEqual({
      eligible: false,
      reason: RefundIneligibility.ClaimedSeat,
    });
  });

  it("refuses while a Refund Request is open, before any other rule", () => {
    const result = evaluateRefundPolicy(
      facts({
        hasOpenRefundRequest: true,
        hasClaimedSeat: true,
        today: daysAfterPurchase(REFUND_WINDOW_DAYS + 30),
      })
    );
    expect(result).toEqual({
      eligible: false,
      reason: RefundIneligibility.OpenRefundRequest,
    });
  });
});
