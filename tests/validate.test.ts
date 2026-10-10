import { describe, expect, it } from "vitest";
import {
  assertTraceable,
  findUnmappedThreats,
  findUnmappedRecos,
} from "@/core/validate";
import type {
  ParsedRecommendation,
  ParsedThreat,
  ProposedLink,
} from "@/core/types";

/**
 * Agent A split the spec's `findUnmapped(...)` helper into two focused
 * functions, both taking the collection first and links second:
 *   findUnmappedThreats(threats, links)  -> ParsedThreat[]   ("No Reviewer Response")
 *   findUnmappedRecos(recos, links)      -> ParsedRecommendation[] ("Unmapped Recommendation")
 * Links reference threats by `threatRow` and recommendations by `recoIndex`
 * (matching ParsedRecommendation.index).
 */

function baseThreat(over: Partial<ParsedThreat>): ParsedThreat {
  return {
    sheet: "STRIDE",
    row: 2,
    ref: "1",
    title: "",
    description: "",
    stride: "",
    component: "",
    mitre: [],
    risk: "",
    existingControls: "",
    safetyMetrics: "",
    severityScore: null,
    raw: {},
    ...over,
  };
}

const threats: ParsedThreat[] = [
  baseThreat({
    row: 2,
    ref: "1",
    title: "Login API allows unlimited credential-stuffing attempts",
    description: "No rate limiting on /api/v1/auth/login; failed attempts not logged.",
    stride: "Spoofing",
    mitre: ["T1078"],
    risk: "Critical",
  }),
  baseThreat({
    row: 3,
    ref: "2",
    title: "Verbose error responses return full PII records",
    description: "Unhandled exceptions serialize the user object into HTTP 500 bodies.",
    stride: "Information Disclosure",
    risk: "High",
  }),
];

const recos: ParsedRecommendation[] = [
  {
    index: 0,
    text: "Enforce MFA and add rate limiting on the login API.",
    owner: "",
    priority: "",
    timeline: "",
  },
  {
    index: 1,
    text: "Sanitize error responses to remove PII fields before serialization.",
    owner: "",
    priority: "",
    timeline: "",
  },
  {
    index: 2,
    text: "Consider a quarterly board game night for team morale.",
    owner: "",
    priority: "",
    timeline: "",
  },
];

describe("assertTraceable — no-hallucination guard", () => {
  it("passes for a link whose quote is a substring of the source text", () => {
    const link: ProposedLink = {
      threatRow: 2,
      recoIndex: 0,
      confidence: "High",
      rationale: "The recommendation directly addresses the login API threat.",
      quote: "add rate limiting on the login API",
    };
    expect(() => assertTraceable([link], threats, recos)).not.toThrow();
  });

  it("matches quotes case-insensitively", () => {
    const link: ProposedLink = {
      threatRow: 3,
      recoIndex: 1,
      confidence: "Medium",
      rationale: "The recommendation targets the PII disclosure threat.",
      quote: "SANITIZE ERROR RESPONSES",
    };
    expect(() => assertTraceable([link], threats, recos)).not.toThrow();
  });

  it("accepts quotes drawn from the threat text itself", () => {
    const link: ProposedLink = {
      threatRow: 2,
      recoIndex: 0,
      confidence: "Low",
      rationale: "Weak lexical link, kept for human review.",
      quote: "credential-stuffing attempts",
    };
    expect(() => assertTraceable([link], threats, recos)).not.toThrow();
  });

  it("throws when a link's quote appears in NEITHER source text (fabricated link)", () => {
    const bad: ProposedLink = {
      threatRow: 2,
      recoIndex: 2,
      confidence: "High",
      rationale: "Fabricated rationale for a hallucinated link.",
      quote: "rotate all database passwords weekly",
    };
    expect(() => assertTraceable([bad], threats, recos)).toThrow();
  });

  it("throws when a link references a non-existent threat row or reco index", () => {
    const dangling: ProposedLink = {
      threatRow: 99,
      recoIndex: 0,
      confidence: "High",
      rationale: "Points at a threat row that does not exist.",
      quote: "add rate limiting on the login API",
    };
    expect(() => assertTraceable([dangling], threats, recos)).toThrow();
  });
});

describe("findUnmappedThreats / findUnmappedRecos — coverage-gap visibility", () => {
  const links: ProposedLink[] = [
    {
      threatRow: 2,
      recoIndex: 0,
      confidence: "High",
      rationale: "Direct address of the login API threat.",
      quote: "add rate limiting on the login API",
    },
  ];

  it("an unrelated recommendation stays unmapped (never force-linked)", () => {
    const unmapped = findUnmappedRecos(recos, links);
    const indexes = unmapped.map((r) => r.index);
    expect(indexes).toContain(1); // valid reco, simply not linked yet
    expect(indexes).toContain(2); // unrelated reco: "board game night"
  });

  it("threats with no linked recommendation are reported as unmapped", () => {
    const unmapped = findUnmappedThreats(threats, links);
    expect(unmapped.map((t) => t.ref)).toEqual(["2"]);
  });

  it("everything linked means nothing unmapped", () => {
    const allLinked: ProposedLink[] = [
      ...links,
      {
        threatRow: 3,
        recoIndex: 1,
        confidence: "High",
        rationale: "Direct address of the PII disclosure threat.",
        quote: "Sanitize error responses",
      },
      {
        threatRow: 3,
        recoIndex: 2,
        confidence: "Low",
        rationale: "Reviewer explicitly linked it; human decision wins.",
        quote: "board game night",
      },
    ];
    expect(findUnmappedThreats(threats, allLinked)).toHaveLength(0);
    expect(findUnmappedRecos(recos, allLinked)).toHaveLength(0);
  });
});
