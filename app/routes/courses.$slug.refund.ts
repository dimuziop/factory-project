import { data, redirect } from "react-router";
import { z } from "zod";
import type { Route } from "./+types/courses.$slug.refund";
import { getCurrentUserId } from "~/lib/session";
import { db } from "~/db";
import { courses, refundRequests, users, RefundRequestStatus } from "~/db/schema";
import { eq } from "drizzle-orm";
import { parseFormData, parseParams } from "~/lib/validation";
import { formatPrice } from "~/lib/utils";
import {
  getRefundEligibility,
  RefundIneligibility,
  REFUND_WINDOW_DAYS,
} from "~/lib/refunds.server";

const refundParamsSchema = z.object({
  slug: z.string().min(1),
});

const refundActionSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(10, "Tell us a little more about why you want a refund.")
    .max(1000, "Please keep your reason under 1000 characters."),
});

const INELIGIBILITY_RESPONSES: Record<
  RefundIneligibility,
  { message: string; status: number }
> = {
  [RefundIneligibility.NoPurchase]: {
    message: "You have not bought this course.",
    status: 403,
  },
  [RefundIneligibility.OpenRefundRequest]: {
    message: "You already have an open refund request on this purchase.",
    status: 409,
  },
  [RefundIneligibility.ClaimedSeat]: {
    message: "A team licence with a claimed seat cannot be refunded.",
    status: 403,
  },
  [RefundIneligibility.WindowClosed]: {
    message: `The ${REFUND_WINDOW_DAYS}-day refund window has closed.`,
    status: 403,
  },
  [RefundIneligibility.WatchLimitReached]: {
    message: "You have watched too much of this course to refund it.",
    status: 403,
  },
};

/**
 * The confirmation the buyer gets in their inbox. There is no mail transport
 * wired up yet, so the built message goes to the server log.
 */
function buildRefundRequestReceivedEmail(input: {
  buyerName: string;
  buyerEmail: string;
  courseTitle: string;
  amount: number;
}) {
  return {
    to: input.buyerEmail,
    subject: `Refund request received — ${input.courseTitle}`,
    body: [
      `Hi ${input.buyerName},`,
      "",
      `We have your refund request for "${input.courseTitle}".`,
      `If it is approved, the refund is ${formatPrice(input.amount)}, the full amount you paid.`,
      "",
      "A platform admin reviews every refund request by hand. You do not need to do anything else — we will email you again once it is decided.",
      "",
      "— The Cadence team",
    ].join("\n"),
  };
}

export async function action({ params, request }: Route.ActionArgs) {
  const currentUserId = await getCurrentUserId(request);

  if (!currentUserId) {
    throw data("You must be logged in to request a refund.", { status: 401 });
  }

  const { slug } = parseParams(params, refundParamsSchema);
  const course = db.select().from(courses).where(eq(courses.slug, slug)).get();

  if (!course) {
    throw data("Course not found", { status: 404 });
  }

  const buyer = db
    .select()
    .from(users)
    .where(eq(users.id, currentUserId))
    .get();

  if (!buyer) {
    throw data("User not found", { status: 404 });
  }

  const eligibility = getRefundEligibility(currentUserId, course.id);

  if (!eligibility.eligible) {
    const { message, status } = INELIGIBILITY_RESPONSES[eligibility.reason];
    throw data(message, { status });
  }

  const formData = await request.formData();
  const parsed = parseFormData(formData, refundActionSchema);

  if (!parsed.success) {
    return data({ errors: parsed.errors }, { status: 400 });
  }

  db.insert(refundRequests)
    .values({
      purchaseId: eligibility.purchase.id,
      status: RefundRequestStatus.Open,
      reason: parsed.data.reason,
      amount: eligibility.amount,
    })
    .run();

  const email = buildRefundRequestReceivedEmail({
    buyerName: buyer.name,
    buyerEmail: buyer.email,
    courseTitle: course.title,
    amount: eligibility.amount,
  });

  console.log(
    `[email] to=${email.to} subject=${email.subject}\n${email.body}`
  );

  return redirect("/settings");
}
