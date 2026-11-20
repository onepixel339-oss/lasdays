import { describe, it, expect } from "vitest";
import { computeReminders, remindersGateKey } from "@/lib/reminders";
import type { Exam, Sprint, Task } from "@/lib/datastore/types";

// ═══════════════ Local reminders — pure computation tests ═══════════════

const T = (over: Partial<Task> = {}): Task => ({
  id: "t1", title: "t", subject: null, priority: "normal", done: false,
  dueDate: null, createdAt: "2026-01-01T00:00:00.000Z", doneAt: null, ...over,
});
const E = (title: string, date: string): Exam => ({
  id: "e1", title, subject: null, date, createdAt: "2026-01-01T00:00:00.000Z",
});
const S = (over: Partial<Sprint> = {}): Sprint => ({
  id: "s1", name: "sprint", subject: null, totalPages: 100, donePages: 0,
  startDate: "2026-01-01", endDate: "2026-01-10", active: true,
  createdAt: "2026-01-01T00:00:00.000Z", ...over,
});

const TODAY = "2026-11-21";

describe("computeReminders", () => {
  it("returns nothing for an empty, on-track day", () => {
    expect(computeReminders({ dueCount: 0, exams: [], tasks: [], sprint: null, today: TODAY })).toEqual([]);
    // finished sprint: no reminder even if behind
    expect(computeReminders({ dueCount: 0, exams: [], tasks: [], sprint: S({ active: false, donePages: 0 }), today: TODAY })).toEqual([]);
  });

  it("reminds for due flashcards (one / many)", () => {
    const one = computeReminders({ dueCount: 1, exams: [], tasks: [], sprint: null, today: TODAY });
    expect(one).toHaveLength(1);
    expect(one[0]).toMatchObject({ key: "dueOne", href: "/srs", tone: "primary" });
    const many = computeReminders({ dueCount: 12, exams: [], tasks: [], sprint: null, today: TODAY });
    expect(many[0]).toMatchObject({ key: "dueCards", vars: { n: 12 } });
  });

  it("reminds for overdue tasks — strictly past dueDate, ignores future and done", () => {
    const tasks = [
      T({ dueDate: "2026-11-19" }),           // overdue
      T({ dueDate: "2026-11-19", done: true }), // done → not overdue
      T({ dueDate: "2026-11-22" }),           // future
      T(),                                    // no due date
    ];
    const r = computeReminders({ dueCount: 0, exams: [], tasks, sprint: null, today: TODAY });
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ key: "overdueOne", href: "/tasks" });
    const two = [T({ dueDate: "2026-11-18" }), T({ dueDate: "2026-11-19" })];
    expect(computeReminders({ dueCount: 0, exams: [], tasks: two, sprint: null, today: TODAY })[0])
      .toMatchObject({ key: "overdue", vars: { n: 2 } });
  });

  it("reminds for exams today, tomorrow and up to 3 days ahead — not further", () => {
    expect(computeReminders({ dueCount: 0, exams: [E("Physics", TODAY)], tasks: [], sprint: null, today: TODAY })[0])
      .toMatchObject({ key: "examToday", tone: "danger" });
    expect(computeReminders({ dueCount: 0, exams: [E("Physics", "2026-11-22")], tasks: [], sprint: null, today: TODAY })[0])
      .toMatchObject({ key: "examSoonOne" });
    expect(computeReminders({ dueCount: 0, exams: [E("Physics", "2026-11-24")], tasks: [], sprint: null, today: TODAY })[0])
      .toMatchObject({ key: "examSoon", vars: { n: 3 } });
    expect(computeReminders({ dueCount: 0, exams: [E("Physics", "2026-12-01")], tasks: [], sprint: null, today: TODAY })).toEqual([]);
    expect(computeReminders({ dueCount: 0, exams: [E("Physics", "2026-11-19")], tasks: [], sprint: null, today: TODAY })).toEqual([]);
  });

  it("reminds for an active sprint that is behind schedule (target pages for today)", () => {
    // Nov 16→25 inclusive = 10 study days, today Nov 21 = day 6 → expected 60,
    // done 10 → 50 pages targeted for today
    const r = computeReminders({ dueCount: 0, exams: [], tasks: [], sprint: S({ startDate: "2026-11-16", endDate: "2026-11-25", donePages: 10 }), today: TODAY });
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ key: "sprintBehind", vars: { n: 50 }, href: "/sprints" });
    // ahead of schedule → no reminder
    expect(computeReminders({ dueCount: 0, exams: [], tasks: [], sprint: S({ startDate: "2026-11-16", endDate: "2026-11-25", donePages: 60 }), today: TODAY })).toEqual([]);
    // same-day sprint: the whole sprint is today's target
    const sameDay = computeReminders({ dueCount: 0, exams: [], tasks: [], sprint: S({ startDate: TODAY, endDate: TODAY, donePages: 0 }), today: TODAY });
    expect(sameDay[0]).toMatchObject({ key: "sprintBehind", vars: { n: 100 } });
    // sprint starting in the future → no reminder yet
    expect(computeReminders({ dueCount: 0, exams: [], tasks: [], sprint: S({ startDate: "2026-11-24", endDate: "2026-12-01", donePages: 0 }), today: TODAY })).toEqual([]);
  });

  it("prioritizes: exam today > overdue > due cards > exam soon > sprint behind", () => {
    const r = computeReminders({
      dueCount: 9,
      exams: [E("Physics", TODAY), E("Chemistry", "2026-11-23")],
      tasks: [T({ dueDate: "2026-11-20" }), T({ dueDate: "2026-11-18" })],
      sprint: S({ startDate: "2026-11-01", endDate: "2026-11-30", donePages: 5 }),
      today: TODAY,
    });
    expect(r.map((x) => x.key)).toEqual(["examToday", "overdue", "dueCards", "examSoon", "sprintBehind"]);
  });

  it("gate key is per-day", () => {
    expect(remindersGateKey(TODAY)).toBe(`ld2_reminders_${TODAY}`);
    expect(remindersGateKey("2026-11-22")).toBe("ld2_reminders_2026-11-22");
  });
});
