import { beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { readWorkbook } from "@/core/ooxml";
import { suggestMapping } from "@/core/columns";
import { parseThreats } from "@/core/excel";
import type { ColumnMapping } from "@/core/types";
import type { WorkbookSheet } from "@/core/ooxml";

const FIXTURE = new URL("./fixtures/sample-threat-model.xlsx", import.meta.url);

let strideSheet!: WorkbookSheet;
let notesSheet!: WorkbookSheet;
let mapping!: ColumnMapping;

beforeAll(async () => {
  const workbook = await readWorkbook(readFileSync(FIXTURE));
  strideSheet = workbook.sheets.find((s) => s.name === "STRIDE")!;
  notesSheet = workbook.sheets.find((s) => s.name === "Notes")!;
  mapping = suggestMapping(strideSheet.rows[0]).mapping;
});

describe("parseThreats — fixture", () => {
  it("parses exactly 12 threats, skipping the blank row", () => {
    const { threats } = parseThreats([strideSheet], mapping);
    expect(threats).toHaveLength(12);
  });

  it("keeps Excel provenance and splits title/description on the first newline", () => {
    const { threats } = parseThreats([strideSheet], mapping);
    const first = threats[0];
    expect(first.sheet).toBe("STRIDE");
    expect(first.row).toBe(2); // 1-based; header is row 1
    expect(first.ref).toBe("1");
    expect(first.stride).toBe("Spoofing");
    expect(first.title).toBe(
      "Login API allows unlimited credential-stuffing attempts"
    );
    expect(first.description).toContain("/api/v1/auth/login");
    expect(first.description).not.toContain(first.title);
  });

  it("parses semicolon-separated MITRE lists into arrays (empty stays empty)", () => {
    const { threats } = parseThreats([strideSheet], mapping);
    expect(threats[0].mitre).toEqual(["T1078", "T1110"]);
    expect(threats[1].mitre).toEqual(["T1078"]);
    expect(threats[3].mitre).toEqual([]);
  });

  it("maps an empty Risk Level to \"\" (never invents one)", () => {
    const { threats } = parseThreats([strideSheet], mapping);
    const noRisk = threats.find((t) => t.ref === "12")!;
    expect(noRisk.risk).toBe("");
    expect(noRisk.stride).toBe("Elevation of Privilege");
  });

  it("covers all 6 STRIDE categories and all 4 risk levels", () => {
    const { threats } = parseThreats([strideSheet], mapping);
    const strides = new Set(threats.map((t) => t.stride));
    expect(strides).toEqual(
      new Set([
        "Spoofing",
        "Tampering",
        "Repudiation",
        "Information Disclosure",
        "Denial of Service",
        "Elevation of Privilege",
      ])
    );
    const risks = new Set(threats.map((t) => t.risk).filter(Boolean));
    expect(risks).toEqual(new Set(["Critical", "High", "Medium", "Low"]));
  });

  it("skips the fully-blank row silently (12 threats, original row numbers kept)", () => {
    const { threats, warnings } = parseThreats([strideSheet], mapping);
    expect(threats).toHaveLength(12);
    expect(threats.some((t) => t.row === 14)).toBe(false); // blank Excel row 14
    expect(threats[11].row).toBe(13); // last threat keeps its real row number
    expect(Array.isArray(warnings)).toBe(true);
  });
});

describe("parseThreats — robustness", () => {
  it("does not crash on ragged rows", () => {
    const ragged = {
      name: "Ragged",
      rows: [
        ["S.No", "STRIDE Category", "Threat Description"],
        ["1"],
        [],
        ["2", "Tampering"],
      ],
    };
    const m = suggestMapping(ragged.rows[0]).mapping;
    expect(() => parseThreats([ragged], m)).not.toThrow();
    const { threats } = parseThreats([ragged], m);
    expect(threats).toHaveLength(2);
    expect(threats[0].ref).toBe("1");
    expect(threats[1].stride).toBe("Tampering");
  });

  it("warns (never crashes) on a sheet whose headers don't match the mapping", () => {
    // Sheet selection happens at the ingest route (per-sheet mapping preview);
    // parseThreats itself degrades gracefully: it warns per missing column.
    const notes = notesSheet;
    let result: ReturnType<typeof parseThreats> | undefined;
    expect(() => {
      result = parseThreats([notes], mapping);
    }).not.toThrow();
    expect(result!.warnings.length).toBeGreaterThan(0);
    expect(result!.warnings.some((w) => w.includes("was not found"))).toBe(
      true
    );
  });
});
