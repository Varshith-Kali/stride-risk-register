import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, handleError } from "@/lib/api-utils";
import { listActiveReviewers } from "@/db";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function GET(req: NextRequest) {
  const rl = checkRateLimit(req);
  if (rl) return rl;
  try {
    const reviewers = listActiveReviewers().map((r) => ({
      id: r.id,
      name: r.name,
      role: r.role,
    }));
    return NextResponse.json({ ok: true, data: { reviewers } });
  } catch (e) {
    return handleError(e);
  }
}
