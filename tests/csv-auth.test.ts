import { describe, it, expect } from "vitest";
import { parseCsv } from "@/components/srs/shared";
import { isValidName, normalizeName } from "@/lib/name";

describe("parseCsv", () => {
  it("parses simple front,back lines", () => {
    expect(parseCsv("hello,world\nfoo,bar")).toEqual([
      { front: "hello", back: "world" },
      { front: "foo", back: "bar" },
    ]);
  });

  it("handles Arabic comma, fullwidth comma and quoted fields", () => {
    expect(parseCsv("سؤال،إجابة")).toEqual([{ front: "سؤال", back: "إجابة" }]); // U+060C
    expect(parseCsv("q，a")).toEqual([{ front: "q", back: "a" }]); // U+FF0C
    expect(parseCsv('"a, b","c, d"')).toEqual([{ front: "a, b", back: "c, d" }]);
  });

  it("skips the header row and empty lines", () => {
    expect(parseCsv("front,back\n\nq,a")).toEqual([{ front: "q", back: "a" }]);
  });

  it("drops incomplete rows and caps at 500", () => {
    const lines = Array.from({ length: 600 }, (_, i) => `q${i},a${i}`).join("\n");
    expect(parseCsv(lines)).toHaveLength(500);
    expect(parseCsv("only-front")).toEqual([]);
  });
});

describe("name-only auth — normalization", () => {
  it("lowercases and collapses whitespace", () => {
    expect(normalizeName("  Ahmed   Hassan ")).toBe("ahmed hassan");
    expect(normalizeName("AHMED")).toBe("ahmed");
  });

  it("case-insensitive identity: 'Ali' and 'ali' normalize to the same key", () => {
    expect(normalizeName("Ali")).toBe(normalizeName("ali"));
  });
});

describe("name-only auth — validation", () => {
  it("accepts reasonable names (including Arabic)", () => {
    expect(isValidName("أحمد")).toBe(true);
    expect(isValidName("Ahmed 2")).toBe(true);
    expect(isValidName("ann")).toBe(true);
  });

  it("rejects too-short, too-long and control-character names", () => {
    expect(isValidName("ab")).toBe(false);
    expect(isValidName("a".repeat(25))).toBe(false);
    expect(isValidName("\u0000bad")).toBe(false);
    expect(isValidName("   ")).toBe(false);
  });
});
