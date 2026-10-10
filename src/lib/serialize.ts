/**
 * Serializers: snake_case DB views → camelCase UI DTOs.
 *
 * Every data route returns the DTO shapes declared in `@/lib/dto.ts`. The UI
 * reads camelCase and expects `mitre` as a string[] and `links` as the full
 * link list (incl. proposed, so the register drawer can accept/reject). These
 * helpers are the single place that bridges the two.
 */

import type { Confidence, LinkDecision, Threat, ThreatLink } from "@/lib/dto";
import type { LinkView, ThreatView } from "@/lib/threat-views";

/** Parse the `mitre` TEXT column (JSON array string) into a string[]. */
export function parseMitre(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map((x) => String(x));
  if (typeof raw !== "string" || raw.trim() === "") return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map((x) => String(x)) : [];
  } catch {
    return [];
  }
}

function coerceConfidence(v: unknown): Confidence {
  return v === "High" || v === "Medium" || v === "Low" ? v : "Medium";
}

function coerceDecision(v: unknown): LinkDecision {
  return v === "accepted" || v === "rejected" ? v : "proposed";
}

function coerceSourceLabel(v: unknown): ThreatLink["sourceLabel"] {
  if (v === "From Excel" || v === "From Reviewer" || v === "AI-inferred link") {
    return v;
  }
  // Legacy / manual labels (e.g. "Reviewer-linked") map to the reviewer source.
  if (typeof v === "string" && v.toLowerCase().includes("review")) {
    return "From Reviewer";
  }
  return "AI-inferred link";
}

export function toThreatLink(l: LinkView): ThreatLink {
  return {
    id: l.id,
    recommendationId: l.recommendation_id,
    recommendationText: l.reco_text ?? "",
    confidence: coerceConfidence(l.confidence),
    rationale: l.rationale ?? "",
    quote: l.quote ?? "",
    sourceLabel: coerceSourceLabel(l.source_label),
    decision: coerceDecision(l.decision),
    decidedBy: l.decided_by || null,
  };
}

export function toThreat(t: ThreatView): Threat {
  const links = (t.links ?? []).map(toThreatLink);
  return {
    id: t.id,
    ref: t.threat_ref || `T-${t.id}`,
    title: t.title ?? "",
    description: t.description ?? "",
    stride: t.stride_category ?? "",
    component: t.component ?? "",
    mitre: parseMitre(t.mitre),
    risk: t.risk_level ?? "",
    severityScore: t.severity_score ?? null,
    existingControls: t.existing_controls ?? "",
    safetyMetrics: t.safety_metrics ?? "",
    excelSheet: t.excel_sheet ?? "",
    excelRow: t.excel_row ?? 0,
    projectName: t.project_name ?? "",
    reviewerName: t.reviewer_name ?? "",
    status: t.status as Threat["status"],
    statusReason: null,
    priorityOverride: t.priority_override ?? null,
    priorityOverrideReason: t.priority_override_reason ?? null,
    rankScore: t.rank_score ?? null,
    rankExplanation: t.rank_explanation ?? null,
    linkedCount: t.link_counts?.total ?? links.length,
    links,
  };
}
