/**
 * API data-transfer types for the client.
 *
 * The platform stores one AI-condensed review per submission; these shapes
 * mirror what the aggregation routes return. The UI normalises defensively at
 * each call site so a slightly different envelope does not break rendering.
 */

/* ── Reviewers ─────────────────────────────────────────────────────────────── */
export interface Reviewer {
  id: number;
  name: string;
  role: string;
}

/* ── Condensed review ──────────────────────────────────────────────────────── */
export interface RiskPosture {
  critical: number;
  high: number;
  medium: number;
  low: number;
}

export interface TopRisk {
  title: string;
  risk: string;
}

export interface CondensedReview {
  headline: string;
  observations: string[];
  keyRecommendations: string[];
  riskPosture: RiskPosture;
  strideCounts: Record<string, number>;
  topRisks: TopRisk[];
  threatCount: number;
  recoCount: number;
  aiGenerated: boolean;
}

/** Submission POST result (intake). */
export interface SubmissionResult {
  submissionId: number;
  version: number;
  threatCount: number;
  recoCount: number;
  aiGenerated: boolean;
  warnings: string[];
}

/* ── Dashboard — the shared visibility hub ─────────────────────────────────── */
export interface NameValue {
  name: string;
  value: number;
}

/** One review as it appears in the dashboard feed. */
export interface ReviewListItem {
  id: number;
  project: string;
  reviewer: string;
  reviewDate: string;
  createdAt: string;
  headline: string;
  riskPosture: RiskPosture;
  threatCount: number;
  recoCount: number;
  aiGenerated: boolean;
}

export interface DashboardData {
  totals: {
    reviews: number;
    threatsReviewed: number;
    recommendations: number;
    reviewers: number;
  };
  riskPosture: RiskPosture;
  stride: NameValue[];
  reviewsByReviewer: NameValue[];
  reviews: ReviewListItem[];
}

/** Full review detail (drawer / ?review=<id>). */
export interface ReviewDetail {
  id: number;
  project: string;
  reviewer: string;
  reviewDate: string;
  createdAt: string;
  version: number;
  notes: string;
  excelFilename: string;
  review: CondensedReview;
}

/* ── Timeline — stock-market-style time series ─────────────────────────────── */
export interface TimelinePoint {
  date: string;
  reviews: number;
  recommendations: number;
  cumulativeReviews: number;
  cumulativeRecommendations: number;
}

/** One review as a dated entry in the chronological activity feed. */
export interface TimelineEvent {
  id: number;
  date: string;
  createdAt: string;
  project: string;
  reviewer: string;
  headline: string;
  threatCount: number;
  recoCount: number;
  riskPosture: RiskPosture;
  aiGenerated: boolean;
}

export interface TimelineData {
  points: TimelinePoint[];
  events: TimelineEvent[];
  reviewers: { name: string; reviews: number }[];
  totals: {
    reviews: number;
    recommendations: number;
    reviewers: number;
    firstActivity: string | null;
    lastActivity: string | null;
  };
}

/* ── Portfolio ─────────────────────────────────────────────────────────────── */
/** One condensed review as it appears in a project's review list. */
export interface PortfolioReview {
  id: number;
  reviewer: string;
  reviewerRole: string;
  reviewDate: string;
  createdAt: string;
  version: number;
  headline: string;
  riskPosture: RiskPosture;
  threatCount: number;
  recoCount: number;
  aiGenerated: boolean;
}

export interface PortfolioProject {
  id: number;
  name: string;
  criticalCount: number;
  highCount: number;
  mediumCount: number;
  lowCount: number;
  reviewCount: number;
  lastReviewDate: string;
  trend: { date: string; severe: number }[];
  /** Every condensed review for this project, newest first. */
  reviews: PortfolioReview[];
}

/* ── Reviewers scorecard ───────────────────────────────────────────────────── */
export interface ReviewerScore {
  id: number;
  name: string;
  role: string;
  reviews: number;
  threatsReviewed: number;
  recommendations: number;
  riskPosture: RiskPosture;
  lastActivity: string;
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

/* ── Report — governance review report (all reviewers, all reviews) ────────── */
/** One condensed review as a row in the report table. */
export interface ReportRow {
  id: number;
  reviewer: string;
  reviewerRole: string;
  project: string;
  reviewDate: string;
  createdAt: string;
  version: number;
  critical: number;
  high: number;
  medium: number;
  low: number;
  threatCount: number;
  recoCount: number;
  headline: string;
  aiGenerated: boolean;
}

export interface ReportData {
  rows: ReportRow[];
  reviewers: string[];
  totals: {
    reviews: number;
    reviewers: number;
    threatsReviewed: number;
    recommendations: number;
  };
}
