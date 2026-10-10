#!/usr/bin/env node
/**
 * make-fixture.mjs — generates tests/fixtures/sample-threat-model.xlsx
 *
 * A realistic stand-in for a STRIDE GPT Excel export, used by the vitest
 * suite (tests/*.test.ts). It mirrors the REAL STRIDE GPT export schema
 * (see ~/workspace/stride-study/STUDY_REPORT.md §5.1 — the code, not the
 * README, is the truth):
 *
 *   Sheet "STRIDE" (single threat sheet), exact headers:
 *     S.No | STRIDE Category | Threat Description | MITRE ATT&CK Mapping
 *     | Risk Level | Existing Controls | Safety Metrics
 *
 *   - 12 threat rows: all 6 STRIDE categories × 2, all 4 risk levels,
 *     one row with an EMPTY Risk Level, one fully-BLANK row (parser must
 *     skip it with a warning, never crash).
 *   - "Threat Description" cells are multi-line: title + "\n" + description
 *     (first line = title, remainder = description).
 *   - "MITRE ATT&CK Mapping" cells use semicolon-separated technique lists.
 *   - Sheet "Notes": a non-threat sheet the parser must IGNORE.
 *
 * Usage:  node tests/fixtures/make-fixture.mjs
 * Output: tests/fixtures/sample-threat-model.xlsx
 *
 * *** AGENT F NOTE ***
 * When this script was written, src/core/ooxml-write.ts (Agent C's
 * self-contained OOXML writer, mirroring STRIDE GPT's writer style) did not
 * exist yet, so a minimal zero-dependency writer was implemented inline
 * below. That file has since landed — but the inline writer is INTENTIONALLY
 * RETAINED: this script must stay runnable with plain `node` (no TS
 * toolchain, no node_modules), which a .ts import cannot satisfy. The
 * workbook shape it produces is verified by tests/ooxml.test.ts against the
 * real src/core/ooxml.ts reader. If the inline writer ever diverges from
 * src/core/ooxml-write.ts, reconcile the two.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "sample-threat-model.xlsx");

// ---------------------------------------------------------------------------
// Minimal OOXML writer (inline; zero deps; STORED zip entries, no compression)
// ---------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** entries: [{ name, data: Buffer }] — stored (method 0) zip. */
function buildZip(entries) {
  const parts = [];
  const central = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name, "utf8");
    const crc = crc32(e.data);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); // local file header signature
    lh.writeUInt16LE(20, 4); // version needed
    lh.writeUInt16LE(0x0800, 6); // UTF-8 filename flag
    lh.writeUInt16LE(0, 8); // method: stored
    lh.writeUInt16LE(0, 10); // mod time
    lh.writeUInt16LE(0, 12); // mod date
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(e.data.length, 18); // compressed size (= raw size)
    lh.writeUInt32LE(e.data.length, 22); // uncompressed size
    lh.writeUInt16LE(name.length, 26);
    lh.writeUInt16LE(0, 28); // extra length
    parts.push(lh, name, e.data);
    central.push({ name, crc, size: e.data.length, offset });
    offset += lh.length + name.length + e.data.length;
  }
  const centralStart = offset;
  const cdParts = [];
  for (const c of central) {
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); // central directory signature
    ch.writeUInt16LE(20, 4);
    ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(0x0800, 8);
    ch.writeUInt16LE(0, 10);
    ch.writeUInt16LE(0, 12);
    ch.writeUInt16LE(0, 14);
    ch.writeUInt32LE(c.crc, 16);
    ch.writeUInt32LE(c.size, 20);
    ch.writeUInt32LE(c.size, 24);
    ch.writeUInt16LE(c.name.length, 28);
    ch.writeUInt16LE(0, 30); // extra
    ch.writeUInt16LE(0, 32); // comment
    ch.writeUInt16LE(0, 34); // disk
    ch.writeUInt16LE(0, 36); // internal attrs
    ch.writeUInt32LE(0, 38); // external attrs
    ch.writeUInt32LE(c.offset, 42); // local header offset
    cdParts.push(ch, c.name);
  }
  const cd = Buffer.concat(cdParts);
  parts.push(cd);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); // end of central directory
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(central.length, 8);
  end.writeUInt16LE(central.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(centralStart, 16);
  end.writeUInt16LE(0, 20);
  parts.push(end);
  return Buffer.concat(parts);
}

function xmlEsc(s) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function colLetter(n) {
  let s = "";
  n += 1;
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/**
 * sheets: [{ name, rows: Array<Array<string|number>> }] — empty cells are
 * omitted (reader must treat them as ""). Numbers become bare <v> cells.
 */
function buildWorkbook(sheets) {
  const sst = [];
  const sstMap = new Map();
  const sstIndex = (v) => {
    let i = sstMap.get(v);
    if (i === undefined) {
      i = sst.length;
      sst.push(v);
      sstMap.set(v, i);
    }
    return i;
  };

  const sheetXmls = sheets.map((sh) => {
    const rowsXml = sh.rows
      .map((row, ri) => {
        const cells = row
          .map((v, ci) => {
            if (v === "" || v === null || v === undefined) return "";
            const ref = colLetter(ci) + (ri + 1);
            if (typeof v === "number" && Number.isFinite(v)) {
              return `<c r="${ref}"><v>${v}</v></c>`;
            }
            return `<c r="${ref}" t="s"><v>${sstIndex(String(v))}</v></c>`;
          })
          .join("");
        return `<row r="${ri + 1}">${cells}</row>`;
      })
      .join("");
    return (
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
      `<sheetData>${rowsXml}</sheetData></worksheet>`
    );
  });

  const contentTypes =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="xml" ContentType="application/xml"/>` +
    `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
    sheets
      .map(
        (_, i) =>
          `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ` +
          `ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
      )
      .join("") +
    `<Override PartName="/xl/sharedStrings.xml" ` +
    `ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>` +
    `</Types>`;

  const rels =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
    `</Relationships>`;

  const workbookRels =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    sheets
      .map(
        (_, i) =>
          `<Relationship Id="rId${i + 1}" ` +
          `Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" ` +
          `Target="worksheets/sheet${i + 1}.xml"/>`
      )
      .join("") +
    `<Relationship Id="rId${sheets.length + 1}" ` +
    `Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" ` +
    `Target="sharedStrings.xml"/>` +
    `</Relationships>`;

  const workbook =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ` +
    `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<sheets>` +
    sheets
      .map(
        (sh, i) =>
          `<sheet name="${xmlEsc(sh.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`
      )
      .join("") +
    `</sheets></workbook>`;

  const sharedStrings =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ` +
    `count="${sst.length}" uniqueCount="${sst.length}">` +
    sst.map((s) => `<si><t xml:space="preserve">${xmlEsc(s)}</t></si>`).join("") +
    `</sst>`;

  const entries = [
    { name: "[Content_Types].xml", data: Buffer.from(contentTypes, "utf8") },
    { name: "_rels/.rels", data: Buffer.from(rels, "utf8") },
    { name: "xl/workbook.xml", data: Buffer.from(workbook, "utf8") },
    { name: "xl/_rels/workbook.xml.rels", data: Buffer.from(workbookRels, "utf8") },
    { name: "xl/sharedStrings.xml", data: Buffer.from(sharedStrings, "utf8") },
    ...sheetXmls.map((xml, i) => ({
      name: `xl/worksheets/sheet${i + 1}.xml`,
      data: Buffer.from(xml, "utf8"),
    })),
  ];
  return buildZip(entries);
}

// ---------------------------------------------------------------------------
// Fixture data
// ---------------------------------------------------------------------------

const HEADERS = [
  "S.No",
  "STRIDE Category",
  "Threat Description",
  "MITRE ATT&CK Mapping",
  "Risk Level",
  "Existing Controls",
  "Safety Metrics",
];

const ROWS = [
  [
    1,
    "Spoofing",
    "Login API allows unlimited credential-stuffing attempts\nThe /api/v1/auth/login endpoint has no rate limiting, CAPTCHA, or account lockout. Attackers can replay breached credential lists at high throughput. Failed attempts are not logged per source IP, so detection is limited.",
    "T1078; T1110",
    "Critical",
    "WAF rate rules; failed-login alerting in SIEM",
    "PARTIALLY SAFE",
  ],
  [
    2,
    "Spoofing",
    "Session tokens use a weak, rarely rotated signing secret\nJWTs are signed with a short static secret stored in the repo config. If leaked, attackers can forge arbitrary sessions until the secret is rotated manually.",
    "T1078",
    "High",
    "15-minute token expiry; secret rotation runbook exists",
    "UNSAFE",
  ],
  [
    3,
    "Tampering",
    "Payment amount can be modified in transit\nThe checkout API trusts the amount field sent by the client. An attacker proxying their own traffic can lower the charged amount before the payment gateway call.",
    "T1190",
    "Critical",
    "Server-side price lookup planned for Q4",
    "UNSAFE",
  ],
  [
    4,
    "Tampering",
    "Cached API responses can serve stale pricing\nThe CDN caches price responses for 24 hours with no invalidation on price change. Customers may check out at outdated prices after a price update.",
    "",
    "Medium",
    "Cache TTL documented; manual purge available",
    "SAFE",
  ],
  [
    5,
    "Repudiation",
    "Admin actions lack an immutable audit trail\nPrivileged actions in the admin console write to a local log file that admins can truncate. There is no append-only store or external log shipping for these events.",
    "T1070",
    "High",
    "Application logs shipped to SIEM",
    "PARTIALLY SAFE",
  ],
  [
    6,
    "Repudiation",
    "Mobile app does not log data-export actions\nUsers can export reports from the mobile app without any audit record, so misuse of exported data cannot be attributed afterwards.",
    "",
    "Low",
    "Export feature flagged for review",
    "SAFE",
  ],
  [
    7,
    "Information Disclosure",
    "Verbose error responses return full PII records\nUnhandled exceptions in the profile service serialize the entire user object, including government ID numbers, into the HTTP 500 response body.",
    "T1048; T1005",
    "Critical",
    "Generic error handler in staging",
    "UNSAFE",
  ],
  [
    8,
    "Information Disclosure",
    "Internal service versions exposed in response headers\nX-Service-Version headers disclose exact build numbers of internal services, aiding targeted vulnerability research.",
    "T1041",
    "Medium",
    "Header allowlist in API gateway",
    "SAFE",
  ],
  [
    9,
    "Denial of Service",
    "Report generation has no concurrency limit\nThe /reports/export endpoint runs expensive queries synchronously. A handful of concurrent requests exhaust the database connection pool.",
    "T1498",
    "High",
    "Request timeout of 60s",
    "PARTIALLY SAFE",
  ],
  [
    10,
    "Denial of Service",
    "Password-reset emails can be triggered in a loop\nNo throttling on the forgot-password endpoint lets an attacker flood any user's inbox, which can be abused for harassment or to mask real security alerts.",
    "",
    "Low",
    "CAPTCHA on the reset form",
    "SAFE",
  ],
  [
    11,
    "Elevation of Privilege",
    "Support portal route missing role check\nGET /support/users/{id}/impersonate lacks the support-admin role check applied to sibling routes, allowing any authenticated support user to impersonate customers.",
    "T1068",
    "Medium",
    "Route inventory audit in progress",
    "UNSAFE",
  ],
  [
    12,
    "Elevation of Privilege",
    "Debug endpoint enabled in production build\nThe /debug/config endpoint from the development profile is reachable in production and dumps non-secret configuration, expanding the attack surface for follow-on attacks.",
    "T1134",
    "", // <-- deliberately empty Risk Level (must parse as "", never invented)
    "Debug profile disabled in staging",
    "",
  ],
  [], // <-- deliberately blank row (parser must skip with a warning)
];

const NOTES_SHEET = [
  ["Reviewer notes — this sheet is NOT a threat sheet and must be ignored by the parser."],
  ["Reviewed by: Varshith Puli"],
  ["", 42], // ragged row + numeric cell, must not crash the reader
];

// ---------------------------------------------------------------------------

mkdirSync(HERE, { recursive: true });
const xlsx = buildWorkbook([
  { name: "STRIDE", rows: [HEADERS, ...ROWS] },
  { name: "Notes", rows: NOTES_SHEET },
]);
writeFileSync(OUT, xlsx);
console.log(`Wrote ${OUT} (${xlsx.length} bytes): 12 threat rows + 1 blank row on "STRIDE", junk on "Notes".`);
