/**
 * Risk-domain presentation constants shared by all STRIDE Risk Register views.
 * (Agent D canonical version — replaces the placeholder shim.)
 *
 * Risk-level colors are a domain addition (not part of the STRIDE GPT theme
 * tokens) and must be used consistently everywhere a risk level appears.
 */

/** Domain risk-level colors — Critical #dc2626, High #ea580c, Medium #ca8a04, Low #16a34a. */
export const RISK_COLORS: Record<string, string> = {
  Critical: "#dc2626",
  High: "#ea580c",
  Medium: "#ca8a04",
  Low: "#16a34a",
};

/**
 * Chart palette: hex approximations of the theme's --chart-1..5 oklch greys
 * (oklch(0.18 0 0), oklch(0.5 0 0), oklch(0.7 0 0), oklch(0.85 0 0),
 * oklch(0.35 0 0)). Used for STRIDE category series.
 */
export const CHART_COLORS: string[] = [
  "#2b2b2b",
  "#808080",
  "#b3b3b3",
  "#d9d9d9",
  "#595959",
];

/** Canonical STRIDE display / tie-break order. */
export const STRIDE_ORDER: string[] = [
  "Spoofing",
  "Tampering",
  "Repudiation",
  "Information Disclosure",
  "Denial of Service",
  "Elevation of Privilege",
];

/** Hex color for a risk level; falls back to a neutral grey. */
export function riskColor(level: string | null | undefined): string {
  return (level && RISK_COLORS[level]) || "#808080";
}

/** Color for the n-th STRIDE category, cycling through the neutral series. */
export function strideColor(index: number): string {
  return CHART_COLORS[index % CHART_COLORS.length];
}

/**
 * Tailwind class string for a risk-level badge (solid fill, white text).
 * Classes are full literals so Tailwind's scanner picks them up.
 * Falls back to a neutral badge for unknown / empty levels.
 */
export function riskBadgeClass(risk: string | null | undefined): string {
  switch (risk) {
    case "Critical":
      return "bg-[#dc2626] text-white border-transparent hover:bg-[#dc2626]/90";
    case "High":
      return "bg-[#ea580c] text-white border-transparent hover:bg-[#ea580c]/90";
    case "Medium":
      return "bg-[#ca8a04] text-white border-transparent hover:bg-[#ca8a04]/90";
    case "Low":
      return "bg-[#16a34a] text-white border-transparent hover:bg-[#16a34a]/90";
    default:
      return "bg-secondary text-secondary-foreground border-transparent";
  }
}

/** Human label for a risk level; empty/missing renders as "Not provided". */
export function riskLabel(risk: string | null | undefined): string {
  return risk && risk.trim() ? risk : "Not provided";
}
