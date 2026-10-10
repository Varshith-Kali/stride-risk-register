/**
 * Shared domain types for the STRIDE Risk Register platform.
 * Pure types only — no runtime imports, no side effects.
 */

export type StrideCategory =
  | "Spoofing"
  | "Tampering"
  | "Repudiation"
  | "Information Disclosure"
  | "Denial of Service"
  | "Elevation of Privilege"
  | "";

export type RiskLevel = "Critical" | "High" | "Medium" | "Low" | "";

export type ThreatStatus =
  | "Open"
  | "In Progress"
  | "Mitigated"
  | "Accepted Risk"
  | "Deferred"
  | "Rejected/Not Applicable";

export type Confidence = "High" | "Medium" | "Low";

export type LinkDecision = "proposed" | "accepted" | "rejected";

export interface ParsedThreat {
  sheet: string;
  /** 1-based Excel row (header = row 1). */
  row: number;
  /** S.No value, or "T-001" style fallback when the ref column is absent/empty. */
  ref: string;
  title: string;
  description: string;
  stride: StrideCategory;
  component: string;
  mitre: string[];
  risk: RiskLevel;
  existingControls: string;
  safetyMetrics: string;
  severityScore: number | null;
  /** Original cell values keyed by header name, for audit/drill-down. */
  raw: Record<string, string>;
}

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
  // values = EXCEL HEADER NAMES exactly as they appear
}

export interface ParsedRecommendation {
  /** 1-based position in the parsed list. */
  index: number;
  text: string;
  /** Only when explicitly stated in the text; "" otherwise. */
  owner: string;
  /** Only when explicitly stated in the text; "" otherwise. */
  priority: string;
  /** Only when explicitly stated in the text; "" otherwise. */
  timeline: string;
}

export interface ProposedLink {
  /** 1-based Excel row of the threat (header = row 1). */
  threatRow: number;
  /** 1-based index of the recommendation. */
  recoIndex: number;
  confidence: Confidence;
  rationale: string;
  /** Exact span quoted from the source text (reco or threat). */
  quote: string;
}
