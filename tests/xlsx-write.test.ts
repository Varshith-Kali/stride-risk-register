import { describe, expect, it } from "vitest";
import { buildXlsx } from "@/core/xlsx-write";
import { readWorkbook } from "@/core/ooxml";

/**
 * The writer must produce a workbook the (independent) reader accepts — a strong
 * proxy for "opens cleanly in Excel with no repair prompt". We round-trip a
 * header row + mixed text/number data and assert the cells survive intact.
 */
describe("xlsx writer — round-trip through the reader", () => {
  const headers = ["Reviewer", "Project", "Critical", "Summary"];
  const rows = [
    ["Varshith Puli", "ACME payments", 3, 'Quotes "x", commas, & <tags>'],
    ["Dana Lee", "KILIA", 0, "Clean, no AI summary"],
  ];

  it("builds a buffer the reader parses back to the same grid", async () => {
    const buf = buildXlsx({ sheetName: "Reviews", headers, rows });
    const wb = await readWorkbook(buf);

    expect(wb.sheets).toHaveLength(1);
    expect(wb.sheets[0].name).toBe("Reviews");

    const grid = wb.sheets[0].rows;
    expect(grid[0]).toEqual(headers);
    expect(grid[1]).toEqual([
      "Varshith Puli",
      "ACME payments",
      "3",
      'Quotes "x", commas, & <tags>',
    ]);
    expect(grid[2]).toEqual(["Dana Lee", "KILIA", "0", "Clean, no AI summary"]);
  });

  it("escapes XML-special characters without corrupting the file", async () => {
    const buf = buildXlsx({
      sheetName: "T",
      headers: ["A"],
      rows: [["<&>'\""], ["  leading/trailing  "]],
    });
    const wb = await readWorkbook(buf);
    expect(wb.sheets[0].rows[1]).toEqual(["<&>'\""]);
    expect(wb.sheets[0].rows[2]).toEqual(["  leading/trailing  "]);
  });

  it("sanitizes invalid sheet names to a safe, length-capped value", async () => {
    const buf = buildXlsx({
      sheetName: "a/b:c*d?e[f]".repeat(5),
      headers: ["A"],
      rows: [["x"]],
    });
    const wb = await readWorkbook(buf);
    expect(wb.sheets[0].name.length).toBeLessThanOrEqual(31);
    expect(wb.sheets[0].name).not.toMatch(/[:\\/?*[\]]/);
  });
});
