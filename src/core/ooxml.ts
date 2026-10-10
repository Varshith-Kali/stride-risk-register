/**
 * Minimal dependency-free .xlsx (OOXML) reader.
 *
 * Reads the raw ZIP container with node:zlib, resolves worksheet parts via
 * xl/workbook.xml (+ workbook.xml.rels), and extracts cell values from
 * xl/sharedStrings.xml and xl/worksheets/sheetN.xml using a small
 * hand-rolled XML scanner.
 *
 * Design notes:
 * - The central directory is parsed first (robust against local headers
 *   that use data descriptors), then only the needed entries are inflated.
 * - Only compression methods 0 (stored) and 8 (deflate) are supported.
 * - Dates are NOT converted — the raw cell text is kept as-is.
 * - Row arrays are indexed so that `rows[i]` is Excel row `i + 1`;
 *   gaps become `[]` so the 1-based row numbers stay stable.
 */
import { inflateRawSync } from "node:zlib";

export class OoxmlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OoxmlError";
  }
}

export interface WorkbookSheet {
  name: string;
  /** rows[i] === Excel row i + 1; gaps are []. */
  rows: string[][];
}

export interface ReadWorkbookResult {
  sheets: WorkbookSheet[];
}

/* ------------------------------------------------------------------ */
/* Limits                                                              */
/* ------------------------------------------------------------------ */

const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MiB
const MAX_SHEETS = 50;
const MAX_CELLS = 200_000;
const MAX_ROWS = 200_000;
const MAX_UNCOMPRESSED_BYTES = 100 * 1024 * 1024; // 100 MiB (zip-bomb check)
const MAX_EXCEL_ROW = 1_048_576;

/* ------------------------------------------------------------------ */
/* Tiny XML helpers                                                    */
/* ------------------------------------------------------------------ */

function decodeXmlEntities(s: string): string {
  return s.replace(
    /&(amp|lt|gt|quot|apos);|&#(\d+);|&#x([0-9a-fA-F]+);/g,
    (m: string, named?: string, dec?: string, hex?: string): string => {
      if (named) {
        switch (named) {
          case "amp":
            return "&";
          case "lt":
            return "<";
          case "gt":
            return ">";
          case "quot":
            return '"';
          case "apos":
            return "'";
          default:
            return m;
        }
      }
      const code = dec !== undefined ? parseInt(dec, 10) : parseInt(hex ?? "", 16);
      if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return m;
      return String.fromCodePoint(code);
    }
  );
}

/** Parse `name="value"` / `name='value'` pairs from a tag's inner text. */
function parseAttrs(tagInner: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /([\w:.-]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(tagInner)) !== null) {
    attrs[m[1]] = decodeXmlEntities(m[3] ?? m[4] ?? "");
  }
  return attrs;
}

/** Excel column letters ("A".."XFD") → 0-based index. */
function colLettersToIndex(letters: string): number {
  let idx = 0;
  for (const ch of letters) {
    const v = ch.charCodeAt(0) - 64; // A=1
    if (v < 1 || v > 26) throw new OoxmlError("Malformed cell reference in worksheet XML.");
    idx = idx * 26 + v;
  }
  return idx - 1;
}

/* ------------------------------------------------------------------ */
/* ZIP container (central-directory first)                             */
/* ------------------------------------------------------------------ */

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_EOCD = 0x06054b50;

interface ZipEntryInfo {
  name: string;
  method: number;
  flags: number;
  compSize: number;
  uncompSize: number;
  localOffset: number;
}

function findEocd(buf: Buffer): number {
  const lo = Math.max(0, buf.length - 22 - 65535);
  for (let i = buf.length - 22; i >= lo; i--) {
    if (buf.readUInt32LE(i) === SIG_EOCD) {
      const commentLen = buf.readUInt16LE(i + 20);
      if (i + 22 + commentLen === buf.length) return i;
    }
  }
  throw new OoxmlError(
    "This file is not a valid Excel (.xlsx) file. Please upload an .xlsx file exported from STRIDE GPT."
  );
}

function readCentralDirectory(buf: Buffer): ZipEntryInfo[] {
  const eocd = findEocd(buf);
  const totalEntries = buf.readUInt16LE(eocd + 10);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  if (cdOffset >= buf.length) {
    throw new OoxmlError("This file is not a valid Excel (.xlsx) file (corrupt central directory).");
  }
  const entries: ZipEntryInfo[] = [];
  let p = cdOffset;
  for (let i = 0; i < totalEntries; i++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== SIG_CENTRAL) {
      throw new OoxmlError("This file is not a valid Excel (.xlsx) file (corrupt central directory).");
    }
    const flags = buf.readUInt16LE(p + 8);
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const uncompSize = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    entries.push({ name, method, flags, compSize, uncompSize, localOffset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

/** Inflate one entry; enforces the zip-bomb budget as it goes. */
function readEntryData(
  buf: Buffer,
  entry: ZipEntryInfo,
  budget: { remaining: number }
): Buffer {
  if (entry.flags & 0x01) {
    throw new OoxmlError(
      `The workbook is password-protected ("${entry.name}"). Please upload an unprotected .xlsx file.`
    );
  }
  if (entry.method !== 0 && entry.method !== 8) {
    throw new OoxmlError(
      `Unsupported compression in "${entry.name}". Please re-save the file in Excel and try again.`
    );
  }
  if (entry.uncompSize === 0xffffffff || entry.compSize === 0xffffffff) {
    throw new OoxmlError("This workbook uses ZIP64, which is not supported. Please re-save the file in Excel.");
  }
  if (entry.uncompSize > budget.remaining) {
    throw new OoxmlError(
      "This file expands to more than 100 MiB when uncompressed. Upload a smaller workbook."
    );
  }
  if (entry.localOffset + 30 > buf.length || buf.readUInt32LE(entry.localOffset) !== SIG_LOCAL) {
    throw new OoxmlError("This file is not a valid Excel (.xlsx) file (corrupt file header).");
  }
  const nameLen = buf.readUInt16LE(entry.localOffset + 26);
  const extraLen = buf.readUInt16LE(entry.localOffset + 28);
  const dataStart = entry.localOffset + 30 + nameLen + extraLen;
  const dataEnd = dataStart + entry.compSize;
  if (dataEnd > buf.length) {
    throw new OoxmlError("This file is not a valid Excel (.xlsx) file (truncated entry).");
  }
  const comp = buf.subarray(dataStart, dataEnd);
  let out: Buffer;
  try {
    out = entry.method === 8 ? inflateRawSync(comp) : Buffer.from(comp);
  } catch {
    throw new OoxmlError(
      `Could not decompress "${entry.name}". The file may be corrupt — please re-save it in Excel.`
    );
  }
  budget.remaining -= out.length;
  if (budget.remaining < 0) {
    throw new OoxmlError(
      "This file expands to more than 100 MiB when uncompressed. Upload a smaller workbook."
    );
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* OOXML part parsing                                                  */
/* ------------------------------------------------------------------ */

interface SheetRef {
  name: string;
  rid: string;
}

/** Sheet names in document order, with their relationship ids. */
function parseWorkbookSheets(workbookXml: string): SheetRef[] {
  const sheets: SheetRef[] = [];
  const re = /<sheet\b([^>]*)>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(workbookXml)) !== null) {
    const attrs = parseAttrs(m[1]);
    if (!attrs.name) {
      throw new OoxmlError("The workbook is missing sheet names. Please re-save the file in Excel.");
    }
    sheets.push({ name: attrs.name, rid: attrs["r:id"] ?? "" });
  }
  return sheets;
}

/** rId → target path (relative to xl/). */
function parseRels(relsXml: string): Map<string, string> {
  const map = new Map<string, string>();
  const re = /<Relationship\b([^>]*)>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(relsXml)) !== null) {
    const attrs = parseAttrs(m[1]);
    if (attrs.Id && attrs.Target) {
      const target = attrs.Target.startsWith("/") ? attrs.Target.slice(1) : `xl/${attrs.Target}`;
      map.set(attrs.Id, target);
    }
  }
  return map;
}

/** officeDocument target from the package rels (fallback: xl/workbook.xml). */
function parseOfficeDocumentTarget(rootRelsXml: string): string {
  const re = /<Relationship\b([^>]*)>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(rootRelsXml)) !== null) {
    const attrs = parseAttrs(m[1]);
    if (attrs.Type && attrs.Type.endsWith("/officeDocument") && attrs.Target) {
      return attrs.Target.startsWith("/") ? attrs.Target.slice(1) : attrs.Target;
    }
  }
  return "xl/workbook.xml";
}

/** Concatenate the <t> runs of every shared string. */
function parseSharedStrings(xml: string): string[] {
  const out: string[] = [];
  const siRe = /<si>([\s\S]*?)<\/si>/g;
  let si: RegExpExecArray | null;
  while ((si = siRe.exec(xml)) !== null) {
    const tRe = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g;
    let t: RegExpExecArray | null;
    let text = "";
    while ((t = tRe.exec(si[1])) !== null) {
      text += decodeXmlEntities(t[1]);
    }
    out.push(text);
  }
  return out;
}

interface CellAcc {
  /** Counts parsed cells across all sheets; throws past the budget. */
  count: number;
}

function parseSheetRows(
  xml: string,
  sharedStrings: string[] | null,
  acc: CellAcc
): string[][] {
  const rows: string[][] = [];
  const sheetData = /<sheetData>([\s\S]*?)<\/sheetData>/.exec(xml);
  if (!sheetData) return rows; // e.g. chartsheet or empty sheet part

  const rowRe = /<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g;
  let rm: RegExpExecArray | null;
  let nextRow = 1;
  while ((rm = rowRe.exec(sheetData[1])) !== null) {
    const rowAttrs = parseAttrs(rm[1]);
    const rowNum = rowAttrs.r ? parseInt(rowAttrs.r, 10) : nextRow;
    if (!Number.isFinite(rowNum) || rowNum < 1 || rowNum > MAX_EXCEL_ROW) {
      throw new OoxmlError("Malformed row number in worksheet XML. Please re-save the file in Excel.");
    }
    if (rowNum > MAX_ROWS) {
      throw new OoxmlError(
        `The worksheet has more than ${MAX_ROWS.toLocaleString()} rows. Upload a smaller workbook.`
      );
    }
    while (rows.length < rowNum - 1) rows.push([]);
    const cells: string[] = [];
    const body = rm[2] ?? "";
    const cellRe = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
    let cm: RegExpExecArray | null;
    let seqCol = 0;
    while ((cm = cellRe.exec(body)) !== null) {
      const attrs = parseAttrs(cm[1]);
      const type = attrs.t ?? "";
      const cellBody = cm[2] ?? "";
      let value = "";
      if (type === "inlineStr" || (type === "" && /<is[\s>]/.test(cellBody))) {
        const isBlock = /<is>([\s\S]*?)<\/is>/.exec(cellBody);
        const inner = isBlock ? isBlock[1] : cellBody;
        const tRe = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g;
        let tm: RegExpExecArray | null;
        while ((tm = tRe.exec(inner)) !== null) value += decodeXmlEntities(tm[1]);
      } else if (type === "s") {
        const vMatch = /<v>([\s\S]*?)<\/v>/.exec(cellBody);
        const idx = vMatch ? parseInt(vMatch[1].trim(), 10) : NaN;
        if (!Number.isFinite(idx) || sharedStrings === null || idx < 0 || idx >= sharedStrings.length) {
          throw new OoxmlError(
            "The workbook references text that is missing from its string table. Please re-save the file in Excel."
          );
        }
        value = sharedStrings[idx];
      } else {
        // n (number), b (boolean), str (formula string), e (error): keep raw text.
        const vMatch = /<v>([\s\S]*?)<\/v>/.exec(cellBody);
        value = vMatch ? decodeXmlEntities(vMatch[1]) : "";
      }
      let colIdx: number;
      if (attrs.r) {
        const ref = /^([A-Z]+)(\d+)$/.exec(attrs.r.trim());
        colIdx = ref ? colLettersToIndex(ref[1]) : seqCol;
      } else {
        colIdx = seqCol;
      }
      while (cells.length <= colIdx) cells.push("");
      cells[colIdx] = value;
      seqCol = colIdx + 1;

      acc.count += 1;
      if (acc.count > MAX_CELLS) {
        throw new OoxmlError(
          `The workbook has more than ${MAX_CELLS.toLocaleString()} cells. Upload a smaller workbook.`
        );
      }
    }
    rows.push(cells);
    nextRow = rowNum + 1;
  }
  return rows;
}

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

/**
 * Read an .xlsx buffer into plain row arrays.
 *
 * Throws OoxmlError with a user-facing message when the file is not a
 * valid workbook, exceeds the size/shape guards, or is malformed.
 */
export function readWorkbook(buf: Buffer): ReadWorkbookResult {
  if (!Buffer.isBuffer(buf)) {
    throw new OoxmlError("No file data was provided.");
  }
  if (buf.length > MAX_FILE_BYTES) {
    throw new OoxmlError("The file is larger than 10 MiB. Please upload a smaller workbook.");
  }
  if (buf.length < 4 || buf.readUInt32LE(0) !== SIG_LOCAL) {
    throw new OoxmlError(
      "This file is not a valid Excel (.xlsx) file. Please upload an .xlsx file exported from STRIDE GPT."
    );
  }

  const entries = readCentralDirectory(buf);
  const byName = new Map<string, ZipEntryInfo>();
  for (const e of entries) byName.set(e.name, e);
  const budget = { remaining: MAX_UNCOMPRESSED_BYTES };
  const get = (name: string): Buffer | null => {
    const e = byName.get(name);
    return e ? readEntryData(buf, e, budget) : null;
  };

  const rootRelsXml = get("_rels/.rels")?.toString("utf8") ?? "";
  const workbookPath = rootRelsXml ? parseOfficeDocumentTarget(rootRelsXml) : "xl/workbook.xml";
  const workbookEntry = byName.get(workbookPath);
  if (!workbookEntry) {
    throw new OoxmlError(
      "This file is not a valid Excel (.xlsx) file (workbook part missing). Please re-save it in Excel."
    );
  }
  const workbookXml = readEntryData(buf, workbookEntry, budget).toString("utf8");
  const sheetRefs = parseWorkbookSheets(workbookXml);
  if (sheetRefs.length === 0) {
    throw new OoxmlError("The workbook contains no worksheets.");
  }
  if (sheetRefs.length > MAX_SHEETS) {
    throw new OoxmlError(
      `The workbook has more than ${MAX_SHEETS} worksheets. Upload a workbook with ${MAX_SHEETS} or fewer sheets.`
    );
  }

  // Resolve each sheet's part via workbook.xml.rels (fallback: sheetN order).
  const wbRelsPath = workbookPath.includes("/")
    ? `${workbookPath.slice(0, workbookPath.lastIndexOf("/") + 1)}_rels/${workbookPath.slice(workbookPath.lastIndexOf("/") + 1)}.rels`
    : `_rels/${workbookPath}.rels`;
  const wbRelsXml = get(wbRelsPath)?.toString("utf8") ?? "";
  const relTargets = wbRelsXml ? parseRels(wbRelsXml) : new Map<string, string>();

  const sstBuf = get("xl/sharedStrings.xml");
  const sharedStrings = sstBuf ? parseSharedStrings(sstBuf.toString("utf8")) : null;

  const acc: CellAcc = { count: 0 };
  const sheets: WorkbookSheet[] = sheetRefs.map((ref, i) => {
    let partPath = ref.rid ? relTargets.get(ref.rid) : undefined;
    if (!partPath) partPath = `xl/worksheets/sheet${i + 1}.xml`;
    const entry = byName.get(partPath);
    if (!entry) {
      throw new OoxmlError(
        `The worksheet "${ref.name}" is missing from the file. Please re-save the workbook in Excel.`
      );
    }
    const xml = readEntryData(buf, entry, budget).toString("utf8");
    return { name: ref.name, rows: parseSheetRows(xml, sharedStrings, acc) };
  });

  return { sheets };
}
