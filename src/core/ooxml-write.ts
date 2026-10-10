/**
 * Minimal zero-dependency OOXML (.xlsx) writer.
 *
 * Mirrors the STRIDE GPT export-utils.ts approach (custom OOXML/ZIP writer,
 * SheetJS deliberately avoided): builds a shared-strings workbook with plain
 * string/number cells, then packs the XML parts into a valid ZIP archive with
 * node:zlib deflateRawSync. No styling — plain data cells, which is all the
 * register export needs.
 *
 * Usage:
 *   import { writeWorkbook } from "@/core/ooxml-write";
 *   const buf = writeWorkbook([{ name: "Register", rows: [["a","b"],[1,2]] }]);
 */

import { deflateRawSync } from "node:zlib";

export interface WorkbookSheet {
  /** Worksheet tab name (truncated to 31 chars per OOXML limits). */
  name: string;
  /** Optional header row, written as row 1 above `rows`. */
  headers?: string[];
  /** Rows of cells. Strings → shared-string cells, finite numbers → number
   *  cells, null/undefined/"" → empty cells. */
  rows: Array<Array<string | number | null | undefined>>;
}

/* ─── CRC32 (required by the ZIP format) ─────────────────────────────────── */

const CRC_TABLE: Uint32Array = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

/* ─── XML helpers ────────────────────────────────────────────────────────── */

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function colLetter(i: number): string {
  let s = "";
  i += 1;
  while (i > 0) {
    const m = (i - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    i = Math.floor((i - 1) / 26);
  }
  return s;
}

/* ─── ZIP packing ────────────────────────────────────────────────────────── */

interface ZipEntry {
  name: string;
  data: Buffer;
}

function buildZip(entries: ZipEntry[]): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const deflated = deflateRawSync(entry.data);
    const crc = crc32(entry.data);

    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); // local file header signature
    lh.writeUInt16LE(20, 4); // version needed
    lh.writeUInt16LE(0, 6); // flags
    lh.writeUInt16LE(8, 8); // method: deflate
    lh.writeUInt16LE(0, 10); // mod time
    lh.writeUInt16LE(0x5621, 12); // mod date (fixed)
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(deflated.length, 18);
    lh.writeUInt32LE(entry.data.length, 22);
    lh.writeUInt16LE(name.length, 26);
    lh.writeUInt16LE(0, 28); // extra length
    localParts.push(lh, name, deflated);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0); // central directory signature
    cd.writeUInt16LE(20, 4); // version made by
    cd.writeUInt16LE(20, 6); // version needed
    cd.writeUInt16LE(0, 8); // flags
    cd.writeUInt16LE(8, 10); // method
    cd.writeUInt16LE(0, 12); // mod time
    cd.writeUInt16LE(0x5621, 14); // mod date
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(deflated.length, 20);
    cd.writeUInt32LE(entry.data.length, 24);
    cd.writeUInt16LE(name.length, 28);
    cd.writeUInt16LE(0, 30); // extra length
    cd.writeUInt16LE(0, 32); // comment length
    cd.writeUInt16LE(0, 34); // disk number
    cd.writeUInt16LE(0, 36); // internal attrs
    cd.writeUInt32LE(0, 38); // external attrs
    cd.writeUInt32LE(offset, 42); // local header offset
    centralParts.push(cd, name);

    offset += lh.length + name.length + deflated.length;
  }

  const central = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); // end of central directory
  end.writeUInt16LE(0, 4); // disk number
  end.writeUInt16LE(0, 6); // central dir disk
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20); // comment length

  return Buffer.concat([...localParts, central, end]);
}

/* ─── Workbook construction ──────────────────────────────────────────────── */

function contentTypesXml(sheetCount: number): string {
  let overrides = "";
  for (let i = 1; i <= sheetCount; i++) {
    overrides +=
      `<Override PartName="/xl/worksheets/sheet${i}.xml" ` +
      `ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`;
  }
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="xml" ContentType="application/xml"/>` +
    `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
    `<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>` +
    overrides +
    `</Types>`
  );
}

const RELS_ROOT =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
  `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
  `</Relationships>`;

function workbookRelsXml(sheetCount: number): string {
  let rels =
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>`;
  for (let i = 1; i <= sheetCount; i++) {
    rels +=
      `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i}.xml"/>`;
  }
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    rels +
    `</Relationships>`
  );
}

function workbookXml(sheets: WorkbookSheet[]): string {
  const seen = new Set<string>();
  const tabs = sheets
    .map((s, i) => {
      let name = s.name.replace(/[\\/*?:[\]]/g, " ").trim().slice(0, 31) || `Sheet${i + 1}`;
      // Excel requires unique sheet names (case-insensitive).
      if (seen.has(name.toLowerCase())) {
        let n = 2;
        let candidate = name;
        do {
          const suffix = ` (${n})`;
          candidate = `${name.slice(0, 31 - suffix.length)}${suffix}`;
          n++;
        } while (seen.has(candidate.toLowerCase()));
        name = candidate;
      }
      seen.add(name.toLowerCase());
      return `<sheet name="${esc(name)}" sheetId="${i + 1}" r:id="rId${i + 2}"/>`;
    })
    .join("");
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ` +
    `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<sheets>${tabs}</sheets>` +
    `</workbook>`
  );
}

const MAX_CELLS = 250_000;

/**
 * Build a valid .xlsx file as a Buffer.
 * Guards: at least one sheet, ≤ 250k cells total (memory safety).
 */
export function writeWorkbook(sheets: WorkbookSheet[]): Buffer {
  if (!sheets.length) throw new Error("writeWorkbook requires at least one sheet");

  let cellCount = 0;
  for (const s of sheets) {
    for (const r of s.rows) cellCount += r.length;
  }
  if (cellCount > MAX_CELLS) {
    throw new Error(`Workbook too large (${cellCount} cells, max ${MAX_CELLS}).`);
  }

  // Shared-string table: register every distinct string first.
  const strings: string[] = [];
  const index = new Map<string, number>();
  const stringId = (s: string): number => {
    let id = index.get(s);
    if (id === undefined) {
      id = strings.length;
      strings.push(s);
      index.set(s, id);
    }
    return id;
  };

  const sheetXmls = sheets.map((sheet) => {
    const allRows: Array<Array<string | number | null | undefined>> =
      sheet.headers && sheet.headers.length > 0 ? [sheet.headers, ...sheet.rows] : sheet.rows;
    const body = allRows
      .map((row, r) => {
        const cells = row
          .map((cell, c) => {
            const ref = `${colLetter(c)}${r + 1}`;
            if (cell === null || cell === undefined || cell === "") {
              return `<c r="${ref}"/>`;
            }
            if (typeof cell === "number" && Number.isFinite(cell)) {
              return `<c r="${ref}"><v>${cell}</v></c>`;
            }
            return `<c r="${ref}" t="s"><v>${stringId(String(cell))}</v></c>`;
          })
          .join("");
        return `<row r="${r + 1}">${cells}</row>`;
      })
      .join("");
    return (
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
      `<sheetData>${body}</sheetData></worksheet>`
    );
  });

  const sst =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ` +
    `count="${strings.length}" uniqueCount="${strings.length}">` +
    strings.map((s) => `<si><t xml:space="preserve">${esc(s)}</t></si>`).join("") +
    `</sst>`;

  const entries: ZipEntry[] = [
    { name: "[Content_Types].xml", data: Buffer.from(contentTypesXml(sheets.length), "utf8") },
    { name: "_rels/.rels", data: Buffer.from(RELS_ROOT, "utf8") },
    { name: "xl/workbook.xml", data: Buffer.from(workbookXml(sheets), "utf8") },
    { name: "xl/_rels/workbook.xml.rels", data: Buffer.from(workbookRelsXml(sheets.length), "utf8") },
    { name: "xl/sharedStrings.xml", data: Buffer.from(sst, "utf8") },
    ...sheetXmls.map((xml, i) => ({
      name: `xl/worksheets/sheet${i + 1}.xml`,
      data: Buffer.from(xml, "utf8") as Buffer,
    })),
  ];

  return buildZip(entries);
}
