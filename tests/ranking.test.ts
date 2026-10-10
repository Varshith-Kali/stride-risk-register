import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { readWorkbook } from "@/core/ooxml";
import { suggestMapping } from "@/core/columns";
import { parseThreats } from "@/core/excel";
import { rankThreats } from "@/core/ranking";
import type { ParsedThreat } from "@/core/types";

const FIXTURE = new URL("./fixtures/sample-threat-model.xlsx", import.meta.url);

const workbook = readWorkbook(readFileSync(FIXTURE));
const strideSheet = workbook.sheets.find((s) => s.name === "STRIDE")!;
const mapping = suggestMapping(strideSheet.rows[0]).mapping;
const { threats } = parseThreats([strideSheet], mapping);

describe("rankThreats — transparent scoring", () => {
  it("scores Critical 100 > High 75 > Medium 50 > Low 25 > missing 0", () => {
    const ranks = rankThreats(threats);
    expect(ranks).toHaveLength(threats.length);
    threats.forEach((t, i) => {
      const expected: Record<string, number> = {
        Critical: 100,
        High: 75,
        Medium: 50,
        Low: 25,
        "": 0,
      };
      expect(ranks[i].score).toBe(expected[t.risk]);
    });
  });

  it("adds +10 when a severityScore >= 7 is present, nothing otherwise", () => {
    const withSev: ParsedThreat = { ...threats[0], severityScore: 9 };
    const lowSev: ParsedThreat = { ...threats[0], severityScore: 6 };
    expect(rankThreats([withSev])[0].score).toBe(110);
    expect(rankThreats([lowSev])[0].score).toBe(100);
  });

  it("says \"Not provided\" in the explanation when risk is missing", () => {
    const ranks = rankThreats(threats);
    const missingIdx = threats.findIndex((t) => t.risk === "");
    expect(missingIdx).toBeGreaterThanOrEqual(0);
    expect(ranks[missingIdx].explanation.toLowerCase()).toContain(
      "not provided"
    );
  });

  it("explains the base score for a known risk level", () => {
    const ranks = rankThreats(threats);
    const highIdx = threats.findIndex((t) => t.risk === "High");
    const explanation = ranks[highIdx].explanation;
    expect(explanation).toContain("75");
    expect(explanation.length).toBeGreaterThan(0);
  });
});
