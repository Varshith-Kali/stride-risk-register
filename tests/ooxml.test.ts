import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { readWorkbook, OoxmlError } from "@/core/ooxml";

const FIXTURE = new URL("./fixtures/sample-threat-model.xlsx", import.meta.url);

function fixtureBuffer(): Buffer {
  return readFileSync(FIXTURE);
}

describe("ooxml reader — fixture round-trip", () => {
  it("reads sheet names in workbook order", () => {
    const wb = readWorkbook(fixtureBuffer());
    expect(wb.sheets.map((s) => s.name)).toEqual(["STRIDE", "Notes"]);
  });

  it("preserves the exact header row of the STRIDE GPT export", () => {
    const wb = readWorkbook(fixtureBuffer());
    expect(wb.sheets[0].rows[0]).toEqual([
      "S.No",
      "STRIDE Category",
      "Threat Description",
      "MITRE ATT&CK Mapping",
      "Risk Level",
      "Existing Controls",
      "Safety Metrics",
    ]);
  });

  it("yields 12 non-empty data rows and preserves original row numbers", () => {
    const wb = readWorkbook(fixtureBuffer());
    const rows = wb.sheets[0].rows;
    // header (row 1) + 12 threat rows + 1 blank row = 14 physical rows
    expect(rows).toHaveLength(14);
    const dataRows = rows.slice(1).filter((r) => r.some((c) => c.trim() !== ""));
    expect(dataRows).toHaveLength(12);
    // Excel row 2 -> rows[1]; numeric S.No cell arrives as a string
    expect(rows[1][0]).toBe("1");
    expect(rows[1][1]).toBe("Spoofing");
    expect(rows[12][0]).toBe("12"); // last threat row
  });

  it("represents empty cells as empty strings", () => {
    const wb = readWorkbook(fixtureBuffer());
    const rows = wb.sheets[0].rows;
    const emptyRisk = rows.find((r) => r[0] === "12");
    expect(emptyRisk).toBeDefined();
    expect(emptyRisk![4] ?? "").toBe("");
  });

  it("preserves multi-line cell content (title\\ndescription)", () => {
    const wb = readWorkbook(fixtureBuffer());
    const desc = wb.sheets[0].rows[1][2];
    expect(desc).toContain("\n");
    expect(desc.split("\n")[0]).toBe(
      "Login API allows unlimited credential-stuffing attempts"
    );
  });
});

describe("ooxml reader — guards", () => {
  it("throws OoxmlError on malformed input", () => {
    expect(() => readWorkbook(Buffer.from("this is not a zip file"))).toThrow(
      OoxmlError
    );
    expect(() => readWorkbook(Buffer.alloc(0))).toThrow(OoxmlError);
  });

  it("rejects oversized input (> 10 MiB)", () => {
    const tooBig = Buffer.alloc(10 * 1024 * 1024 + 1);
    expect(() => readWorkbook(tooBig)).toThrow(OoxmlError);
  });
});
