import { describe, expect, it } from "vitest";
import { suggestMapping, fingerprint } from "@/core/columns";

/** Exact headers of the real STRIDE GPT export (code truth, not README). */
const STRIDE_GPT_HEADERS = [
  "S.No",
  "STRIDE Category",
  "Threat Description",
  "MITRE ATT&CK Mapping",
  "Risk Level",
  "Existing Controls",
  "Safety Metrics",
];

describe("suggestMapping", () => {
  it("maps the exact STRIDE GPT headers with high confidence", () => {
    const { mapping, confidence, notes } = suggestMapping(STRIDE_GPT_HEADERS);
    expect(confidence).toBe("high");
    expect(mapping.ref).toBe("S.No");
    expect(mapping.stride).toBe("STRIDE Category");
    expect(mapping.title).toBe("Threat Description");
    expect(mapping.mitre).toBe("MITRE ATT&CK Mapping");
    expect(mapping.risk).toBe("Risk Level");
    expect(mapping.existingControls).toBe("Existing Controls");
    expect(mapping.safetyMetrics).toBe("Safety Metrics");
    expect(Array.isArray(notes)).toBe(true);
  });

  it("maps fuzzy headers via normalized aliases", () => {
    const { mapping, confidence } = suggestMapping([
      "s.no",
      "STRIDE Category ", // trailing space
      "Threat", // cf. STRIDE GPT's own CSV export, where "Threat" is the threat-title column
      "Risk",
      "existing_controls",
      "misc",
    ]);
    expect(mapping.ref).toBe("s.no");
    expect(mapping.stride).toBe("STRIDE Category ");
    expect(mapping.title).toBe("Threat");
    expect(mapping.risk).toBe("Risk");
    expect(mapping.existingControls).toBe("existing_controls");
    expect(confidence === "high" || confidence === "medium").toBe(true);
  });

  it("matches risk via the documented alias set (risk/risklevel/severity/rating)", () => {
    expect(suggestMapping(["Severity"]).mapping.risk).toBe("Severity");
    expect(suggestMapping(["RiskLevel"]).mapping.risk).toBe("RiskLevel");
    expect(suggestMapping(["Rating"]).mapping.risk).toBe("Rating");
  });

  it("leaves unmappable fields empty and reports notes", () => {
    const { mapping, notes } = suggestMapping(["Something", "Else"]);
    // Agent A may use undefined or "" for "no match" — either means "not mapped".
    expect(mapping.title == null || mapping.title === "").toBe(true);
    expect(mapping.risk == null || mapping.risk === "").toBe(true);
    expect(notes.length).toBeGreaterThan(0);
  });
});

describe("fingerprint", () => {
  it("is stable for identical header lists and differs for different ones", () => {
    const a = fingerprint(STRIDE_GPT_HEADERS);
    expect(a).toBe(fingerprint([...STRIDE_GPT_HEADERS]));
    expect(a).not.toBe(fingerprint(["S.No", "STRIDE Category"]));
    expect(a).toMatch(/^[0-9a-f]{64}$/); // sha256 hex
  });

  it("ignores case/whitespace-only differences", () => {
    expect(fingerprint([" Risk Level "])).toBe(fingerprint(["risk level"]));
  });
});
