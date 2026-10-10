import { describe, expect, it } from "vitest";
import { csvCell } from "@/lib/format";

describe("csvCell — quoting", () => {
  it("quotes cells containing commas, quotes, or newlines", () => {
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell("line1\nline2")).toBe('"line1\nline2"');
    expect(csvCell("plain")).toBe("plain");
    expect(csvCell(null)).toBe("");
    expect(csvCell(42)).toBe("42");
  });
});

describe("csvCell — formula-injection protection (OWASP CSV Injection)", () => {
  it("prefixes formula triggers with a single quote", () => {
    expect(csvCell("=HYPERLINK(\"http://evil.example\",\"x\")")).toBe(
      "\"'=HYPERLINK(\"\"http://evil.example\"\",\"\"x\"\")\"",
    );
    expect(csvCell("+1+1")).toBe("'+1+1");
    expect(csvCell("-2+3")).toBe("'-2+3");
    expect(csvCell("@SUM(A1:A2)")).toBe("'@SUM(A1:A2)");
  });

  it("leaves benign leading text untouched", () => {
    expect(csvCell("Risk: = high")).toBe("Risk: = high");
    expect(csvCell("")).toBe("");
  });
});
