import { describe, expect, it } from "vitest";
import {
  computeRiskPosture,
  computeStrideCounts,
  computeTopRisks,
  buildCondensedReview,
  parseCondensedReview,
} from "@/core/condense";
import { buildCondensePrompt } from "@/llm/prompts";
import { validateCondense } from "@/llm/schemas";
import { rankThreats } from "@/core/ranking";
import { LlmError } from "@/llm/openai";
import type {
  ParsedThreat,
  ParsedRecommendation,
  RiskLevel,
  StrideCategory,
} from "@/core/types";

function threat(
  partial: Partial<ParsedThreat> & { risk: RiskLevel; stride: StrideCategory },
): ParsedThreat {
  return {
    sheet: "STRIDE",
    row: 2,
    ref: "T-001",
    title: "A threat",
    description: "",
    component: "",
    mitre: [],
    existingControls: "",
    safetyMetrics: "",
    severityScore: null,
    raw: {},
    ...partial,
  };
}

function reco(index: number, text: string): ParsedRecommendation {
  return { index, text, owner: "", priority: "", timeline: "" };
}

describe("computeRiskPosture — deterministic, code-owned", () => {
  it("counts each risk level and ignores unknown risk", () => {
    const threats = [
      threat({ risk: "Critical", stride: "Spoofing" }),
      threat({ risk: "Critical", stride: "Tampering" }),
      threat({ risk: "High", stride: "Repudiation" }),
      threat({ risk: "Medium", stride: "Denial of Service" }),
      threat({ risk: "Low", stride: "Spoofing" }),
      threat({ risk: "", stride: "" }),
    ];
    expect(computeRiskPosture(threats)).toEqual({
      critical: 2,
      high: 1,
      medium: 1,
      low: 1,
    });
  });

  it("is all-zero for an empty set", () => {
    expect(computeRiskPosture([])).toEqual({
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
    });
  });
});

describe("computeStrideCounts — all six categories always present", () => {
  it("groups by STRIDE category and routes unknown into the empty key", () => {
    const threats = [
      threat({ risk: "High", stride: "Spoofing" }),
      threat({ risk: "High", stride: "Spoofing" }),
      threat({ risk: "Low", stride: "Elevation of Privilege" }),
      threat({ risk: "Low", stride: "" }),
    ];
    const counts = computeStrideCounts(threats);
    expect(counts["Spoofing"]).toBe(2);
    expect(counts["Elevation of Privilege"]).toBe(1);
    expect(counts[""]).toBe(1);
    expect(counts["Tampering"]).toBe(0);
    // every canonical key is present
    expect(Object.keys(counts).sort()).toEqual(
      [
        "",
        "Denial of Service",
        "Elevation of Privilege",
        "Information Disclosure",
        "Repudiation",
        "Spoofing",
        "Tampering",
      ].sort(),
    );
  });
});

describe("computeTopRisks — ranked by score, stable on ties", () => {
  it("returns the highest-scoring threats first, capped at the limit", () => {
    const threats = [
      threat({ risk: "Low", stride: "Spoofing", title: "low-1" }),
      threat({ risk: "Critical", stride: "Tampering", title: "crit-1" }),
      threat({ risk: "High", stride: "Repudiation", title: "high-1" }),
    ];
    const ranks = rankThreats(threats);
    const top = computeTopRisks(threats, ranks, 2);
    expect(top).toHaveLength(2);
    expect(top[0]).toEqual({ title: "crit-1", risk: "Critical" });
    expect(top[1]).toEqual({ title: "high-1", risk: "High" });
  });

  it("breaks score ties by original input order", () => {
    const threats = [
      threat({ risk: "High", stride: "Spoofing", title: "first" }),
      threat({ risk: "High", stride: "Tampering", title: "second" }),
    ];
    const ranks = rankThreats(threats);
    const top = computeTopRisks(threats, ranks, 2);
    expect(top.map((t) => t.title)).toEqual(["first", "second"]);
  });
});

describe("buildCondensedReview — assembles narrative + deterministic numbers", () => {
  const threats = [
    threat({ risk: "Critical", stride: "Spoofing", title: "crit" }),
    threat({ risk: "Low", stride: "Tampering", title: "low" }),
  ];
  const ranks = rankThreats(threats);
  const recos = [reco(1, "Patch the auth service")];

  it("marks aiGenerated true and carries the narrative when supplied", () => {
    const review = buildCondensedReview(threats, ranks, recos, {
      headline: "Overall posture is concerning",
      observations: ["Spoofing dominates"],
      keyRecommendations: ["Patch auth"],
    });
    expect(review.aiGenerated).toBe(true);
    expect(review.headline).toBe("Overall posture is concerning");
    expect(review.observations).toEqual(["Spoofing dominates"]);
    expect(review.riskPosture).toEqual({
      critical: 1,
      high: 0,
      medium: 0,
      low: 1,
    });
    expect(review.threatCount).toBe(2);
    expect(review.recoCount).toBe(1);
  });

  it("stays valid with aiGenerated false and empty narrative when no AI ran", () => {
    const review = buildCondensedReview(threats, ranks, recos, null);
    expect(review.aiGenerated).toBe(false);
    expect(review.headline).toBe("");
    expect(review.observations).toEqual([]);
    expect(review.keyRecommendations).toEqual([]);
    // deterministic numbers are still present
    expect(review.riskPosture.critical).toBe(1);
    expect(review.threatCount).toBe(2);
  });
});

describe("buildCondensePrompt — grounded, capped, no counts asked", () => {
  it("includes supplied threats and recommendations verbatim", () => {
    const prompt = buildCondensePrompt(
      [
        {
          title: "SQL injection",
          description: "unparameterized query",
          stride: "Tampering",
          risk: "High",
          component: "API",
        },
      ],
      [{ index: 1, text: "Use parameterized queries" }],
    );
    expect(prompt).toContain("SQL injection");
    expect(prompt).toContain("Tampering");
    expect(prompt).toContain("R1: Use parameterized queries");
    expect(prompt).toContain("Never invent");
    expect(prompt.toLowerCase()).toContain("do not include any counts");
  });

  it("renders placeholders when nothing is provided", () => {
    const prompt = buildCondensePrompt([], []);
    expect(prompt).toContain("(none provided)");
  });
});

describe("validateCondense — drops bad items, throws on unusable payloads", () => {
  it("keeps valid strings and drops non-string array items", () => {
    const out = validateCondense({
      headline: "  Posture summary  ",
      observations: ["one", 42, "", "two", null],
      keyRecommendations: ["do a thing"],
    });
    expect(out.headline).toBe("Posture summary");
    expect(out.observations).toEqual(["one", "two"]);
    expect(out.keyRecommendations).toEqual(["do a thing"]);
  });

  it("throws LlmError on a non-record payload", () => {
    expect(() => validateCondense(["not", "a", "record"])).toThrow(LlmError);
  });

  it("throws LlmError when the headline is missing or empty", () => {
    expect(() => validateCondense({ observations: ["x"] })).toThrow(LlmError);
    expect(() => validateCondense({ headline: "   " })).toThrow(LlmError);
  });
});

describe("parseCondensedReview — tolerant of legacy/empty/bad rows", () => {
  it("returns safe defaults for '{}' and malformed JSON", () => {
    const empty = parseCondensedReview("{}");
    expect(empty.headline).toBe("");
    expect(empty.observations).toEqual([]);
    expect(empty.riskPosture).toEqual({
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
    });
    expect(empty.aiGenerated).toBe(false);

    const broken = parseCondensedReview("{not valid json");
    expect(broken.threatCount).toBe(0);
    expect(broken.aiGenerated).toBe(false);
  });

  it("round-trips a stored review and coerces bad numeric fields to 0", () => {
    const stored = JSON.stringify({
      headline: "H",
      observations: ["a", "b"],
      keyRecommendations: ["r"],
      riskPosture: { critical: 3, high: "nope", medium: 1, low: 0 },
      strideCounts: { Spoofing: 2 },
      topRisks: [{ title: "t", risk: "High" }, "garbage"],
      threatCount: 5,
      recoCount: 2,
      aiGenerated: true,
    });
    const parsed = parseCondensedReview(stored);
    expect(parsed.headline).toBe("H");
    expect(parsed.observations).toEqual(["a", "b"]);
    expect(parsed.riskPosture).toEqual({
      critical: 3,
      high: 0,
      medium: 1,
      low: 0,
    });
    expect(parsed.strideCounts["Spoofing"]).toBe(2);
    expect(parsed.strideCounts["Tampering"]).toBe(0);
    expect(parsed.topRisks).toEqual([{ title: "t", risk: "High" }]);
    expect(parsed.threatCount).toBe(5);
    expect(parsed.aiGenerated).toBe(true);
  });
});
