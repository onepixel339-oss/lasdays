import { describe, it, expect } from "vitest";
import {
  todayCairo, cairoHour, shiftDay, cairoDayOf, startOfCairoDay, daysBetween, todayCairoAfter,
} from "@/lib/day";

describe("todayCairo / cairoDayOf", () => {
  it("formats UTC instants into Cairo calendar days", () => {
    // 2026-01-15 23:30 UTC = 2026-01-16 01:30 Cairo (+2, no DST in January)
    expect(cairoDayOf(new Date("2026-01-15T23:30:00Z"))).toBe("2026-01-16");
    // 2026-01-15 21:30 UTC = 2026-01-15 23:30 Cairo → same day
    expect(cairoDayOf(new Date("2026-01-15T21:30:00Z"))).toBe("2026-01-15");
  });

  it("never leaks into the wrong day near Cairo midnight", () => {
    // 21:59:59 UTC in winter = 23:59:59 Cairo
    expect(cairoDayOf(new Date("2026-01-15T21:59:59Z"))).toBe("2026-01-15");
    // 22:00:01 UTC = 00:00:01 Cairo next day
    expect(cairoDayOf(new Date("2026-01-15T22:00:01Z"))).toBe("2026-01-16");
  });
});

describe("shiftDay", () => {
  it("shifts calendar days exactly (month boundaries)", () => {
    expect(shiftDay("2026-03-01", -1)).toBe("2026-02-28"); // 2026 not a leap year
    expect(shiftDay("2026-12-31", 1)).toBe("2027-01-01");
    expect(shiftDay("2026-09-20", -2)).toBe("2026-09-18");
    expect(shiftDay("2026-01-01", 0)).toBe("2026-01-01");
  });
});

describe("startOfCairoDay", () => {
  it("returns the Cairo midnight instant (winter, UTC+2)", () => {
    const start = startOfCairoDay("2026-01-15");
    expect(cairoDayOf(start)).toBe("2026-01-15");
    // one second earlier must already be the previous day
    const before = new Date(start.getTime() - 1000);
    expect(cairoDayOf(before)).toBe("2026-01-14");
    expect(Math.abs(start.getTime() - Date.UTC(2026, 0, 14, 22, 0, 0))).toBeLessThan(2000);
  });

  it("returns the Cairo midnight instant (summer, UTC+3 DST)", () => {
    const start = startOfCairoDay("2026-07-15");
    expect(cairoDayOf(start)).toBe("2026-07-15");
    const before = new Date(start.getTime() - 1000);
    expect(cairoDayOf(before)).toBe("2026-07-14");
    expect(Math.abs(start.getTime() - Date.UTC(2026, 6, 14, 21, 0, 0))).toBeLessThan(2000);
  });

  it("is exact across the spring-forward DST transition", () => {
    // 2026-04-25 follows the last-Friday-of-April DST start. Regardless of the
    // exact DST calendar, the boundary must be self-consistent.
    const start = startOfCairoDay("2026-04-25");
    expect(cairoDayOf(start)).toBe("2026-04-25");
    expect(cairoDayOf(new Date(start.getTime() - 1000))).toBe("2026-04-24");
  });
});

describe("daysBetween", () => {
  it("counts calendar days", () => {
    expect(daysBetween("2026-09-20", "2026-09-20")).toBe(0);
    expect(daysBetween("2026-09-20", "2026-09-23")).toBe(3);
    expect(daysBetween("2026-09-23", "2026-09-20")).toBe(-3);
    expect(daysBetween("2026-12-31", "2027-01-02")).toBe(2);
  });
});

describe("cairoHour", () => {
  it("returns the Cairo hour of a UTC instant", () => {
    expect(cairoHour(new Date("2026-01-15T00:30:00Z"))).toBe(2);
    expect(cairoHour(new Date("2026-07-15T00:30:00Z"))).toBe(3);
  });
});

describe("todayCairoAfter", () => {
  it("is consistent with todayCairo for +0 days", () => {
    expect(todayCairoAfter(0)).toBe(todayCairo());
  });
});
