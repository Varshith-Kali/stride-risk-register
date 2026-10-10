/**
 * Agent D — API data-transfer types.
 *
 * These mirror the contracts in BUILD_SPEC.md §2 (Agent C routes). They are
 * defined here rather than importing `@/core/types` because Agent A owns that
 * file and its route-envelope shapes are Agent C's to fix; the UI normalises
 * defensively at each call site so a slightly different envelope does not
 * break rendering.
 */

/* ── Reviewers ─────────────────────────────────────────────────────────────── */
export interface Reviewer {
  id: number;
  name: string;
  role: string;
}

/* ── Column mapping ────────────────────────────────────────────────────────── */
export interface ColumnMapping {
  ref?: string;
  title: string;
  description?: string;
  stride: string;
  component?: string;
  mitre?: string;
  risk: string;
  existingControls?: string;
  safetyMetrics?: string;
  severity?: string;
  owner?: string;
  dueDate?: string;
  likelihood?: string;
  impact?: string;
}

export interface MappingSuggestion {
  mapping: ColumnMapping;
  confidence: "high" | "medium" | "low";
  notes: string[];
}

export interface IngestPreview {
  fingerprint: string;
  sheets: { name: string; headers: string[]; sampleRows: string[][] }[];
  suggestedMapping: MappingSuggestion;
  savedMapping: MappingSuggestion | null;
}

export interface SubmissionResult {
  submissionId: number;
  threatCount: number;
  recoCount: number;
  mapping: ColumnMapping;
  warnings: string[];
}

/* ── Threats + links ───────────────────────────────────────────────────────── */
export type ThreatStatus =
  | "Open"
  | "In Progress"
  | "Mitigated"
  | "Accepted Risk"
  | "Deferred"
  | "Rejected/Not Applicable";

export type LinkDecision = "proposed" | "accepted" | "rejected";
export type Confidence = "High" | "Medium" | "Low";

export interface ThreatLink {
  id: number;
  recommendationId: number;
  recommendationText: string;
  confidence: Confidence;
  rationale: string;
  quote: string;
  sourceLabel: "From Excel" | "From Reviewer" | "AI-inferred link";
  decision: LinkDecision;
  decidedBy: string | null;
}

export interface Threat {
  id: number;
  ref: string;
  title: string;
  description: string;
  stride: string;
  component: string;
  mitre: string[];
  risk: string;
  severityScore: number | null;
  existingControls: string;
  safetyMetrics: string;
  excelSheet: string;
  excelRow: number;
  projectName: string;
  reviewerName: string;
  status: ThreatStatus;
  statusReason: string | null;
  priorityOverride: string | null;
  priorityOverrideReason: string | null;
  rankScore: number | null;
  rankExplanation: string | null;
  linkedCount: number;
  links: ThreatLink[];
}

export interface ThreatsResponse {
  threats: Threat[];
}

export const THREAT_STATUSES: ThreatStatus[] = [
  "Open",
  "In Progress",
  "Mitigated",
  "Accepted Risk",
  "Deferred",
  "Rejected/Not Applicable",
];

/* ── Dashboard ─────────────────────────────────────────────────────────────── */
export interface NameValue {
  name: string;
  value: number;
}

export interface DashboardKpis {
  totalThreats: number;
  criticalHigh: number;
  withResponse: number;
  noResponse: number;
  unmappedRecos: number;
  coveragePct: number;
}

export interface DashboardData {
  kpis: DashboardKpis;
  stride: NameValue[];
  risk: NameValue[];
  topThreats: {
    id: number;
    title: string;
    risk: string;
    project: string;
    score?: number;
  }[];
  components: NameValue[];
  coverage: { withResponse: number; noResponse: number };
  reviewers: { name: string; threats: number; submissions: number }[];
}

/* ── Audit ─────────────────────────────────────────────────────────────────── */
export interface AuditEntry {
  id: number;
  entity: string;
  entityId: number | null;
  action: string;
  actor: string;
  detail: string;
  createdAt: string;
}
