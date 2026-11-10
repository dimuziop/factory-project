import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { db } from "~/db";
import {
  coupons,
  lessons,
  modules,
  purchases,
  refundRequests,
  videoWatchEvents,
  RefundRequestStatus,
} from "~/db/schema";

// The Refund Policy. See GLOSSARY.md and docs/domain/refunds.md — this is the
// only place the rules live; the course page and the refund action both come
// here.

export const REFUND_WINDOW_DAYS = 14;
export const WATCH_LIMIT_SECONDS = 2 * 60 * 60;

export enum RefundIneligibility {
  NoPurchase = "no_purchase",
  OpenRefundRequest = "open_refund_request",
  ClaimedSeat = "claimed_seat",
  WindowClosed = "window_closed",
  WatchLimitReached = "watch_limit_reached",
}

export type RefundPolicyFacts = {
  purchasedAt: string;
  today: Date;
  hasOpenRefundRequest: boolean;
  hasClaimedSeat: boolean;
  watched: number;
};

export type RefundPolicyOutcome =
  | { eligible: true; lastDayInWindow: string }
  | { eligible: false; reason: RefundIneligibility };

export type RefundEligibility =
  | {
      eligible: true;
      purchase: typeof purchases.$inferSelect;
      amount: number;
      lastDayInWindow: string;
    }
  | { eligible: false; reason: RefundIneligibility };

// The Refund Window is counted in whole calendar days, not hours — someone
// who buys at 23:00 still gets the whole of their fourteenth day.
export function calendarDay(when: Date): string {
  const month = String(when.getMonth() + 1).padStart(2, "0");
  const day = String(when.getDate()).padStart(2, "0");
  return `${when.getFullYear()}-${month}-${day}`;
}

export function lastDayOfRefundWindow(purchasedAtIso: string): string {
  const deadline = new Date(purchasedAtIso);
  deadline.setDate(deadline.getDate() + REFUND_WINDOW_DAYS);
  return calendarDay(deadline);
}

/**
 * The pure rules. Order matters: the first rule that fails is the reason the
 * buyer sees, so the cheap, permanent reasons come before the ones that
 * might change tomorrow.
 */
export function evaluateRefundPolicy(
  facts: RefundPolicyFacts
): RefundPolicyOutcome {
  if (facts.hasOpenRefundRequest) {
    return { eligible: false, reason: RefundIneligibility.OpenRefundRequest };
  }

  // A Claimed Seat belongs to the Student who claimed it, so the Team Licence
  // it came from can no longer be handed back.
  if (facts.hasClaimedSeat) {
    return { eligible: false, reason: RefundIneligibility.ClaimedSeat };
  }

  const today = calendarDay(facts.today);
  const purchasedDay = calendarDay(new Date(facts.purchasedAt));
  const lastDayInWindow = lastDayOfRefundWindow(facts.purchasedAt);

  if (today < purchasedDay || today > lastDayInWindow) {
    return { eligible: false, reason: RefundIneligibility.WindowClosed };
  }

  if (facts.watched >= WATCH_LIMIT_SECONDS) {
    return { eligible: false, reason: RefundIneligibility.WatchLimitReached };
  }

  return { eligible: true, lastDayInWindow };
}

function getLatestPurchase(userId: number, courseId: number) {
  return db
    .select()
    .from(purchases)
    .where(and(eq(purchases.userId, userId), eq(purchases.courseId, courseId)))
    .orderBy(sql`${purchases.createdAt} desc`)
    .get();
}

/** Whether a Refund Request on this Purchase is still undecided. */
export function hasOpenRefundRequest(purchaseId: number): boolean {
  return (
    db
      .select({ id: refundRequests.id })
      .from(refundRequests)
      .where(
        and(
          eq(refundRequests.purchaseId, purchaseId),
          eq(refundRequests.status, RefundRequestStatus.Open)
        )
      )
      .get() !== undefined
  );
}

function hasClaimedSeat(purchaseId: number): boolean {
  return (
    db
      .select({ id: coupons.id })
      .from(coupons)
      .where(
        and(eq(coupons.purchaseId, purchaseId), isNotNull(coupons.redeemedAt))
      )
      .get() !== undefined
  );
}

/** Watched: the furthest point reached in each lesson of the course, added up. */
function getWatched(userId: number, courseId: number): number {
  const lessonIds = db
    .select({ id: lessons.id })
    .from(lessons)
    .innerJoin(modules, eq(lessons.moduleId, modules.id))
    .where(eq(modules.courseId, courseId))
    .all()
    .map((row) => row.id);

  if (lessonIds.length === 0) return 0;

  return db
    .select({
      furthest: sql<number>`max(${videoWatchEvents.positionSeconds})`,
    })
    .from(videoWatchEvents)
    .where(
      and(
        eq(videoWatchEvents.userId, userId),
        inArray(videoWatchEvents.lessonId, lessonIds)
      )
    )
    .groupBy(videoWatchEvents.lessonId)
    .all()
    .reduce((total, row) => total + row.furthest, 0);
}

/**
 * Whether this buyer's latest Purchase of the course can have a Refund Request
 * raised right now, and what the Refund would be. The Refund is always what
 * was paid — never the list price, never more.
 */
export function getRefundEligibility(
  userId: number,
  courseId: number
): RefundEligibility {
  const purchase = getLatestPurchase(userId, courseId);

  if (!purchase) {
    return { eligible: false, reason: RefundIneligibility.NoPurchase };
  }

  const outcome = evaluateRefundPolicy({
    purchasedAt: purchase.createdAt,
    today: new Date(),
    hasOpenRefundRequest: hasOpenRefundRequest(purchase.id),
    hasClaimedSeat: hasClaimedSeat(purchase.id),
    watched: getWatched(userId, courseId),
  });

  if (!outcome.eligible) return outcome;

  return {
    eligible: true,
    purchase,
    amount: purchase.amountPaid,
    lastDayInWindow: outcome.lastDayInWindow,
  };
}
