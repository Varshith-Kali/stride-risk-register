import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { readWorkbook, OoxmlError } from "@/core/ooxml";

const FIXTURE = new URL("./fixtures/sample-threat-model.xlsx", import.meta.url);

function fixtureBuffer(): Buffer {
  return readFileSync(FIXTURE);
}

describe("ooxml reader — fixture round-trip", () => {
  it("reads sheet names in workbook order", async () => {
    const wb = await readWorkbook(fixtureBuffer());
    expect(wb.sheets.map((s) => s.name)).toEqual(["STRIDE", "Notes"]);
  });

  it("preserves the exact header row of the STRIDE GPT export", async () => {
    const wb = await readWorkbook(fixtureBuffer());
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

  it("yields 12 non-empty data rows and preserves original row numbers", async () => {
    const wb = await readWorkbook(fixtureBuffer());
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

  it("represents empty cells as empty strings", async () => {
    const wb = await readWorkbook(fixtureBuffer());
    const rows = wb.sheets[0].rows;
    const emptyRisk = rows.find((r) => r[0] === "12");
    expect(emptyRisk).toBeDefined();
    expect(emptyRisk![4] ?? "").toBe("");
  });

  it("preserves multi-line cell content (title\\ndescription)", async () => {
    const wb = await readWorkbook(fixtureBuffer());
    const desc = wb.sheets[0].rows[1][2];
    expect(desc).toContain("\n");
    expect(desc.split("\n")[0]).toBe(
      "Login API allows unlimited credential-stuffing attempts"
    );
  });
});

describe("ooxml reader — guards", () => {
  it("throws OoxmlError on malformed input", async () => {
    await expect(readWorkbook(Buffer.from("this is not a zip file"))).rejects.toThrow(
      OoxmlError
    );
    await expect(readWorkbook(Buffer.alloc(0))).rejects.toThrow(OoxmlError);
  });

  it("rejects oversized input (> 10 MiB)", async () => {
    const tooBig = Buffer.alloc(10 * 1024 * 1024 + 1);
    await expect(readWorkbook(tooBig)).rejects.toThrow(OoxmlError);
  });

  it("rejects a zip bomb without runaway allocation (streaming budget)", async () => {
    // Minimal xlsx whose sheet1 part is highly-compressible data that would
    // expand past the 100 MiB budget. The streaming inflater must reject it
    // once the budget is exceeded — without allocating the full expansion.
    const { deflateRawSync } = await import("node:zlib");
    const bombXml =
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
      `<sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>` +
      "A".repeat(120 * 1024 * 1024) +
      `</t></is></c></row></sheetData></worksheet>`;
    const rels =
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
      `</Relationships>`;
    const workbook =
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
      `<sheets><sheet name="S" sheetId="1" r:id="rId1"/></sheets></workbook>`;
    const wbRels =
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>` +
      `</Relationships>`;
    const files: Array<[string, string]> = [
      ["_rels/.rels", rels],
      ["xl/workbook.xml", workbook],
      ["xl/_rels/workbook.xml.rels", wbRels],
      ["xl/worksheets/sheet1.xml", bombXml],
    ];
    // Assemble a minimal zip (stored or deflated per entry).
    const chunks: Buffer[] = [];
    const central: Buffer[] = [];
    let offset = 0;
    for (const [name, content] of files) {
      const raw = Buffer.from(content, "utf8");
      const isBomb = name.endsWith("sheet1.xml");
      const comp = isBomb ? deflateRawSync(raw) : raw;
      const method = isBomb ? 8 : 0;
      const nameBuf = Buffer.from(name, "utf8");
      const lh = Buffer.alloc(30);
      lh.writeUInt32LE(0x04034b50, 0);
      lh.writeUInt16LE(20, 4);
      lh.writeUInt16LE(method, 8);
      lh.writeUInt32LE(comp.length, 18);
      lh.writeUInt32LE(raw.length, 22);
      lh.writeUInt16LE(nameBuf.length, 26);
      chunks.push(lh, nameBuf, comp);
      const ch = Buffer.alloc(46);
      ch.writeUInt32LE(0x02014b50, 0);
      ch.writeUInt16LE(method, 10);
      ch.writeUInt32LE(comp.length, 20);
      ch.writeUInt32LE(raw.length, 24);
      ch.writeUInt16LE(nameBuf.length, 28);
      ch.writeUInt32LE(offset, 42);
      central.push(ch, nameBuf);
      offset += 30 + nameBuf.length + comp.length;
    }
    const cdStart = offset;
    const cdBuf = Buffer.concat(central);
    chunks.push(cdBuf);
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(files.length, 8);
    eocd.writeUInt16LE(files.length, 10);
    eocd.writeUInt32LE(cdBuf.length, 12);
    eocd.writeUInt32LE(cdStart, 16);
    chunks.push(eocd);
    const zip = Buffer.concat(chunks);

    const before = process.memoryUsage().heapUsed;
    await expect(readWorkbook(zip)).rejects.toThrow(/100 MiB/);
    const after = process.memoryUsage().heapUsed;
    // Must not have allocated anywhere near the 120 MiB expansion.
    expect(after - before).toBeLessThan(50 * 1024 * 1024);
  });
});
