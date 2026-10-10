import { describe, expect, it } from "vitest";
import { parseRecommendations } from "@/core/recommendations";

describe("parseRecommendations — splitting", () => {
  it("splits numbered lists (1. / 1) forms) and preserves wording", () => {
    const recos = parseRecommendations(
      "1. Enforce MFA on all admin accounts.\n2) Add rate limiting to the login API.\n3. Rotate the weak JWT signing secret."
    );
    expect(recos).toHaveLength(3);
    // Items are numbered 1-based (matching the human-facing list); AI link
    // proposals must use the same convention for recoIndex.
    expect(recos[0].index).toBe(1);
    expect(recos[0].text).toContain("Enforce MFA on all admin accounts.");
    expect(recos[2].index).toBe(3);
    expect(recos[2].text).toContain("Rotate the weak JWT signing secret.");
  });

  it("splits bulleted lists (-, *, •)", () => {
    const recos = parseRecommendations(
      "- Enforce MFA on all admin accounts.\n* Add rate limiting to the login API.\n• Rotate the weak JWT signing secret."
    );
    expect(recos).toHaveLength(3);
  });

  it("splits blank-line-separated paragraphs", () => {
    const recos = parseRecommendations(
      "Enforce MFA on all admin accounts.\n\nAdd rate limiting to the login API."
    );
    expect(recos).toHaveLength(2);
    expect(recos[1].text).toContain("Add rate limiting");
  });

  it("ignores empty input gracefully", () => {
    expect(parseRecommendations("")).toEqual([]);
    expect(parseRecommendations("   \n  ")).toEqual([]);
  });
});

describe("parseRecommendations — explicit extraction only", () => {
  it("extracts an explicitly stated owner", () => {
    const recos = parseRecommendations(
      "1. Enforce MFA on all admin accounts. Owner: Varshith Puli"
    );
    expect(recos[0].owner).toBe("Varshith Puli");
  });

  it("extracts 'owned by X' phrasing (capitalized names)", () => {
    // The parser requires a capitalized name after "owned by" to avoid
    // capturing sentence fragments — a deliberate precision trade-off.
    const recos = parseRecommendations(
      "1. Add rate limiting to the login API. This work is owned by Varshith Puli."
    );
    expect(recos[0].owner).toBe("Varshith Puli");
  });

  it("extracts explicit priority markers (P0, High priority:)", () => {
    const recos = parseRecommendations(
      "1. P0: patch the payment tampering issue.\n2. High priority: add audit logging for admin actions."
    );
    expect(recos[0].priority).toContain("P0");
    expect(recos[1].priority).toContain("High");
  });

  it("extracts date-like timeline tokens", () => {
    const recos = parseRecommendations(
      "1. Complete the report-export throttling rollout by 2026-12-31."
    );
    expect(recos[0].timeline).toContain("2026-12-31");
  });

  it("infers nothing: owner/priority/timeline are \"\" when not stated", () => {
    const recos = parseRecommendations(
      "1. Consider reviewing the caching layer for stale pricing."
    );
    expect(recos).toHaveLength(1);
    expect(recos[0].owner).toBe("");
    expect(recos[0].priority).toBe("");
    expect(recos[0].timeline).toBe("");
  });
});
