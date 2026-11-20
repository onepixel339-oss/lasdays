import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach } from "vitest";
import { LocalStore } from "@/lib/datastore/local";
import { ldb } from "@/lib/datastore/schema";
import { todayCairo, todayCairoAfter, shiftDay } from "@/lib/day";

// ═══════════════ LocalStore integration tests (Dexie + fake-indexeddb) ═══════════════
// Verifies the LocalStore behaves identically to the REST API: same validation,
// same error codes, same ordering, same computed fields.

const store = new LocalStore();

beforeEach(async () => {
  const db = ldb();
  await Promise.all(db.tables.map((t) => t.clear()));
});

// ── profile / access ────────────────────────────────────────────────────────

describe("local profile lifecycle", () => {
  it("has no profile on a fresh device", async () => {
    expect(await store.getProfile()).toBeNull();
  });

  it("signUp creates the local profile with server defaults", async () => {
    const p = await store.signUp("Ahmed");
    expect(p.username).toBe("Ahmed");
    expect(p.isGuest).toBe(false);
    expect(p.avatar).toBe("🌙");
    expect(p.locale).toBe("ar");
    expect(p.themeMode).toBe("dark");
    expect(p.themeAccent).toBe("nebula");
    expect(await store.getProfile()).toMatchObject({ username: "Ahmed" });
  });

  it("refuses short names, reserved names and a second profile", async () => {
    await expect(store.signUp("ab")).rejects.toMatchObject({ code: "invalid_name" });
    await expect(store.signUp("guest_abc")).rejects.toMatchObject({ code: "reserved_name" });
    await store.signUp("Ahmed");
    await expect(store.signUp("Mohamed")).rejects.toMatchObject({ code: "profile_exists", status: 409 });
    // same name reopens the same profile (never mixes data)
    const p = await store.signUp("ahmed");
    expect(p.username.toLowerCase()).toBe("ahmed");
  });

  it("signIn matches case-insensitively and rejects unknown/guest names", async () => {
    await store.signUp("Ahmed");
    await expect(store.signIn("nobody")).rejects.toMatchObject({ code: "no_account", status: 401 });
    const p = await store.signIn("  AHMED ");
    expect(p.username).toBe("Ahmed");
  });

  it("signOut ends the session but keeps data; signing back in restores access", async () => {
    await store.signUp("Ahmed");
    await store.createTask({ title: "مراجعة الفيزياء", subject: null, priority: "high", dueDate: null });
    await store.signOut();
    expect(await store.getProfile()).toBeNull();
    await expect(store.listTasks()).resolves.toHaveLength(1); // data survives
    await expect(store.signIn("Ahmed")).resolves.toMatchObject({ username: "Ahmed" });
    expect(await store.getProfile()).not.toBeNull();
  });

  it("guest profile is created, not signable, and claimable by rename", async () => {
    const g = await store.signInAsGuest();
    expect(g.isGuest).toBe(true);
    expect(g.username.startsWith("guest_")).toBe(true);
    await expect(store.signIn(g.username)).rejects.toMatchObject({ code: "no_account" });
    const claimed = await store.renameProfile("Sara");
    expect(claimed.isGuest).toBe(false);
    expect(claimed.username).toBe("Sara");
    // renaming is also validated
    await expect(store.renameProfile("ab")).rejects.toMatchObject({ code: "invalid_name" });
  });

  it("updateProfile validates like PATCH /api/settings", async () => {
    await store.signUp("Ahmed");
    const p = await store.updateProfile({ locale: "en", themeMode: "light", themeAccent: "cyan", avatar: "⭐" });
    expect(p.locale).toBe("en");
    expect(p.themeMode).toBe("light");
    expect(p.themeAccent).toBe("cyan");
    expect(p.avatar).toBe("⭐");
    const bad = await store.updateProfile({ themeAccent: "rainbow", locale: "fr" as unknown as "ar" });
    expect(bad.themeAccent).toBe("cyan"); // invalid values ignored
    expect(bad.locale).toBe("en");
  });
});

// ── tasks ───────────────────────────────────────────────────────────────────

describe("local tasks", () => {
  it("creates, orders (done asc, createdAt desc) and updates like the API", async () => {
    const t1 = await store.createTask({ title: "الأولى", subject: "رياضيات", priority: "high", dueDate: "2026-11-21" });
    await store.createTask({ title: "الثانية", subject: null, priority: "low", dueDate: null });
    expect(t1.done).toBe(false);
    expect(t1.doneAt).toBeNull();

    let list = await store.listTasks();
    expect(list.map((x) => x.title)).toEqual(["الثانية", "الأولى"]); // newest first

    await store.updateTask(t1.id, { done: true });
    list = await store.listTasks();
    // server ordering: done asc (undone first), createdAt desc — t2 (undone) on top
    expect(list[0]!.done).toBe(false);
    expect(list[list.length - 1]!.done).toBe(true);
    expect(list.find((x) => x.id === t1.id)!.doneAt).not.toBeNull();

    // un-stamp on undo — exactly like the server
    await store.updateTask(t1.id, { done: false });
    const t1b = (await store.listTasks()).find((x) => x.id === t1.id)!;
    expect(t1b.doneAt).toBeNull();
  });

  it("validates like the API and rejects missing titles", async () => {
    await expect(store.createTask({ title: "   ", subject: null, priority: "high", dueDate: null }))
      .rejects.toMatchObject({ code: "title_required" });
    const t = await store.createTask({ title: "x".repeat(300), subject: "s".repeat(100), priority: "bogus", dueDate: "2026-99-991234" });
    expect(t.title).toHaveLength(200);
    expect(t.subject).toBe("s".repeat(60));
    expect(t.priority).toBe("normal");
    expect(t.dueDate).toHaveLength(10);
  });

  it("patching a missing task yields not_found", async () => {
    await expect(store.updateTask("nope", { done: true })).rejects.toMatchObject({ code: "not_found", status: 404 });
    await store.createTask({ title: "أ", subject: null, priority: "normal", dueDate: null });
    await expect(store.deleteTask("nope")).resolves.toBeUndefined();
  });
});

// ── notes ───────────────────────────────────────────────────────────────────

describe("local notes", () => {
  it("pins re-sort to top; updatedAt changes on edit", async () => {
    const n1 = await store.createNote({ title: "ملخص", content: "النيوتن…", subject: "فيزياء" });
    const n2 = await store.createNote({ title: "ثاني", content: "", subject: null });
    await store.updateNote(n1.id, { pinned: true });
    const list = await store.listNotes();
    expect(list[0]!.pinned).toBe(true);
    const updated = list.find((x) => x.id === n1.id)!;
    expect(updated.updatedAt >= n1.updatedAt).toBe(true);
    expect((await store.listNotes()).find((x) => x.id === n2.id)!.pinned).toBe(false);
  });

  it("empty title becomes ellipsis; content clamped to 20k", async () => {
    const n = await store.createNote({ title: "   ", content: "x".repeat(25000), subject: null });
    expect(n.title).toBe("…");
    expect(n.content).toHaveLength(20000);
  });
});

// ── sprints ─────────────────────────────────────────────────────────────────

describe("local sprints", () => {
  it("new sprint takes over; only one active at a time", async () => {
    const s1 = await store.createSprint({ name: "شرح", subject: null, totalPages: 100, startDate: todayCairo(), endDate: todayCairoAfter(10) });
    expect(s1.active).toBe(true);
    const s2 = await store.createSprint({ name: "متابعة", subject: null, totalPages: 50, startDate: todayCairo(), endDate: todayCairoAfter(10) });
    const list = await store.listSprints();
    expect(list.find((x) => x.id === s1.id)!.active).toBe(false);
    expect(list.find((x) => x.id === s2.id)!.active).toBe(true);
    // re-activating the first deactivates the second
    await store.updateSprint(s1.id, { active: true });
    const after = await store.listSprints();
    expect(after.find((x) => x.id === s1.id)!.active).toBe(true);
    expect(after.find((x) => x.id === s2.id)!.active).toBe(false);
  });

  it("validates pages and dates; clamps donePages; supports addPages", async () => {
    await expect(
      store.createSprint({ name: "x", subject: null, totalPages: 0, startDate: todayCairo(), endDate: todayCairoAfter(5) })
    ).rejects.toMatchObject({ code: "pages_required" });
    await expect(
      store.createSprint({ name: "x", subject: null, totalPages: 10, startDate: todayCairoAfter(5), endDate: todayCairo() })
    ).rejects.toMatchObject({ code: "invalid_dates" });

    const s = await store.createSprint({ name: "سبرنت", subject: null, totalPages: 100, startDate: todayCairo(), endDate: todayCairoAfter(10) });
    await store.updateSprint(s.id, { addPages: 30 });
    let cur = (await store.listSprints()).find((x) => x.id === s.id)!;
    expect(cur.donePages).toBe(30);
    // total can never drop below done
    await store.updateSprint(s.id, { totalPages: 10 });
    cur = (await store.listSprints()).find((x) => x.id === s.id)!;
    expect(cur.totalPages).toBe(30);
    // clamp at 0..total
    await store.updateSprint(s.id, { donePages: 999 });
    cur = (await store.listSprints()).find((x) => x.id === s.id)!;
    expect(cur.donePages).toBe(30);
  });
});

// ── exams ───────────────────────────────────────────────────────────────────

describe("local exams", () => {
  it("lists only upcoming Cairo dates, ascending, capped at 10", async () => {
    await store.createExam({ title: "فيزياء", subject: null, date: todayCairoAfter(7) });
    await store.createExam({ title: "رياضة", subject: "math", date: todayCairo() });
    await store.createExam({ title: "قديم", subject: null, date: shiftDay(todayCairo(), -3) }).catch(() => null); // rejected
    const list = await store.listExams();
    expect(list.map((x) => x.title)).toEqual(["رياضة", "فيزياء"]); // date asc
  });

  it("rejects past dates, invalid dates, long titles; caps at 10 upcoming", async () => {
    await expect(store.createExam({ title: "x", subject: null, date: shiftDay(todayCairo(), -1) }))
      .rejects.toMatchObject({ code: "date_past" });
    await expect(store.createExam({ title: "x", subject: null, date: "2026/11/01" }))
      .rejects.toMatchObject({ code: "date_invalid" });
    await expect(store.createExam({ title: "x".repeat(81), subject: null, date: todayCairoAfter(1) }))
      .rejects.toMatchObject({ code: "title_too_long" });
    for (let i = 0; i < 10; i++) {
      await store.createExam({ title: `امتحان ${i}`, subject: null, date: todayCairoAfter(i + 1) });
    }
    await expect(store.createExam({ title: "الحادي عشر", subject: null, date: todayCairoAfter(11) }))
      .rejects.toMatchObject({ code: "too_many_exams" });
  });
});

// ── sessions + stats ────────────────────────────────────────────────────────

describe("local sessions and stats", () => {
  it("aggregates today's focus seconds (Cairo day) and validates durations", async () => {
    await expect(store.logSession({ durationSec: 10, kind: "focus", subject: null })).rejects.toMatchObject({ code: "too_short" });
    await expect(store.logSession({ durationSec: 9 * 3600, kind: "focus", subject: null })).rejects.toMatchObject({ code: "too_long" });

    await store.logSession({ durationSec: 1500, kind: "focus", subject: "فيزياء" });
    await store.logSession({ durationSec: 300, kind: "focus", subject: null });
    await store.logSession({ durationSec: 600, kind: "break", subject: null }); // breaks don't count
    // an old session from 2021 — outside Cairo-today
    await ldb().sessions.put({
      id: "old1", startedAt: new Date("2021-01-01T10:00:00Z").toISOString(),
      durationSec: 3000, kind: "focus", subject: null, completed: true,
    });

    const today = await store.getTodaySessions();
    expect(today.todaySec).toBe(1800);
    expect(today.todayCount).toBe(2);
  });

  it("getStats returns the exact server shape", async () => {
    await store.logSession({ durationSec: 1500, kind: "focus", subject: "فيزياء" });
    const deck = await store.createDeck({ name: "d", subject: null });
    const card = await store.createCard({ deckId: deck.id, front: "f", back: "b" });
    await store.submitReview(card.id, "good");
    await store.createTask({ title: "مهمة", subject: null, priority: "normal", dueDate: null });
    await store.updateTask((await store.listTasks())[0]!.id, { done: true });

    const s = await store.getStats();
    expect(s.week).toHaveLength(7);
    expect(s.heat).toHaveLength(90);
    expect(s.totals).toMatchObject({ focusMinutes: 25, sessions: 1, reviews: 1, doneTasks: 1 });
    expect(s.bySubject).toEqual([{ subject: "فيزياء", minutes: 25 }]);
    expect(s.week[6]!.minutes).toBe(25);
  });
});

// ── srs ─────────────────────────────────────────────────────────────────────

describe("local srs", () => {
  it("deck summaries carry counts/readiness and sort newest first", async () => {
    const d1 = await store.createDeck({ name: "مفردات", subject: "English", color: "#123456" });
    await store.createCard({ deckId: d1.id, front: "persistent", back: "ثابت" });
    await store.createCard({ deckId: d1.id, front: "momentum", back: "زخم" });
    const d2 = await store.createDeck({ name: "أحدث", subject: null });

    const decks = await store.listDecks();
    expect(decks.map((x) => x.name)).toEqual(["أحدث", "مفردات"]);
    const d1row = decks.find((x) => x.id === d1.id)!;
    expect(d1row.cardCount).toBe(2);
    expect(d1row.dueCount).toBe(2); // new cards due immediately
    expect(d1row.matureCount).toBe(0);
    expect(d1row.readiness).toBe(0);
    expect(d2.cardCount).toBe(0);
    expect(d2.readiness).toBe(0); // never NaN
  });

  it("full deck returns cards oldest-first; PATCH validates color; DELETE cascades cards", async () => {
    const d = await store.createDeck({ name: "d", subject: null });
    const c1 = await store.createCard({ deckId: d.id, front: "f1", back: "b1" });
    const c2 = await store.createCard({ deckId: d.id, front: "f2", back: "b2" });
    const full = await store.getDeck(d.id);
    expect(full!.cards.map((x) => x.id)).toEqual([c1.id, c2.id]);
    expect(full!.cardCount).toBe(2);

    await store.updateDeck(d.id, { color: "nothex" });
    expect((await store.getDeck(d.id))!.color).not.toBe("nothex");
    await store.updateDeck(d.id, { color: "#ABCDEF" });
    expect((await store.getDeck(d.id))!.color).toBe("#ABCDEF");

    await store.submitReview(c1.id, "good"); // creates a review log
    await store.deleteDeck(d.id);
    expect(await store.getDeck(d.id)).toBeNull();
    expect(await ldb().cards.where("deckId").equals(d.id).count()).toBe(0);
    // review logs keep their cardId references (same as the server schema)
    expect(await ldb().reviewLogs.count()).toBe(1);
  });

  it("card image handling matches the API byte-for-byte", async () => {
    const d = await store.createDeck({ name: "d", subject: null });
    const tiny = "data:image/png;base64,iVBORw0KGgo=";
    // valid image stored
    const c1 = await store.createCard({ deckId: d.id, front: "f", back: "b", image: tiny });
    expect(c1.image).toBe(tiny);
    // wrong prefix → ignored (null on create)
    const c2 = await store.createCard({ deckId: d.id, front: "f", back: "b", image: "http://x/y.png" });
    expect(c2.image).toBeNull();
    // too big → ignored
    const big = "data:image/png;base64," + "A".repeat(900_000);
    const c3 = await store.createCard({ deckId: d.id, front: "f", back: "b", image: big });
    expect(c3.image).toBeNull();
    // PATCH: undefined leaves it untouched, "" clears
    await store.updateCard(c1.id, { front: "f2" });
    expect((await store.getDeck(d.id))!.cards.find((x) => x.id === c1.id)!.image).toBe(tiny);
    await store.updateCard(c1.id, { image: "" });
    expect((await store.getDeck(d.id))!.cards.find((x) => x.id === c1.id)!.image).toBeNull();
  });

  it("review queue: due-only, oldest-due first, max 30; SM-2 reschedules; grades validated", async () => {
    const d = await store.createDeck({ name: "d", subject: null });
    const cards = [];
    for (let i = 0; i < 35; i++) {
      cards.push(await store.createCard({ deckId: d.id, front: `f${i}`, back: `b${i}` }));
    }
    // push one card into the future (simulate a graded card)
    await store.updateCard(cards[0]!.id, { } as Record<string, never>); // no-op patch allowed
    await ldb().cards.update(cards[0]!.id, { dueAt: new Date(Date.now() + 86400000).toISOString() });

    let queue = await store.getDueCards(d.id);
    expect(queue).toHaveLength(30); // capped
    expect(queue[0]!.id).not.toBe(cards[0]!.id); // future card excluded
    // oldest-due first: dueAt ascending
    for (let i = 1; i < queue.length; i++) {
      expect(queue[i]!.dueAt >= queue[i - 1]!.dueAt).toBe(true);
    }

    const first = queue[0]!;
    await store.submitReview(first.id, "good");
    const graded = (await store.getDeck(d.id))!.cards.find((x) => x.id === first.id)!;
    expect(graded.reps).toBe(1);
    expect(graded.intervalDays).toBe(1);
    expect(new Date(graded.dueAt).getTime()).toBeGreaterThan(Date.now() + 20 * 3600000);
    expect(await ldb().reviewLogs.where("cardId").equals(first.id).count()).toBe(1);

    await expect(store.submitReview("missing", "good")).rejects.toMatchObject({ code: "not_found", status: 404 });
    await expect(store.submitReview(queue[1]!.id, "perfect" as never)).rejects.toMatchObject({ code: "bad_request" });

    // deck filter respected
    const d2 = await store.createDeck({ name: "d2", subject: null });
    await store.createCard({ deckId: d2.id, front: "x", back: "y" });
    queue = await store.getDueCards(d2.id);
    expect(queue).toHaveLength(1);
    expect(await store.getDueCards()).toHaveLength(30); // cross-deck total also capped at 30
  });

  it("CSV import: count returned, rows sanitized, limits enforced", async () => {
    const d = await store.createDeck({ name: "d", subject: null });
    const n = await store.importCards(d.id, [
      { front: " persistent ", back: "ثابت" },
      { front: "  ", back: "غير صالح" }, // filtered (empty front)
      { front: "momentum", back: "زخم" },
    ]);
    expect(n).toBe(2);
    const cards = (await store.getDeck(d.id))!.cards;
    expect(cards[0]!.front).toBe("persistent");

    await expect(store.importCards(d.id, [])).rejects.toMatchObject({ code: "empty_rows" });
    await expect(store.importCards(d.id, [{ front: "", back: "" }])).rejects.toMatchObject({ code: "empty_rows" });
    await expect(store.importCards(d.id, Array.from({ length: 501 }, (_, i) => ({ front: `f${i}`, back: `b${i}` }))))
      .rejects.toMatchObject({ code: "too_many_rows" });
    await expect(store.importCards("missing-deck", [{ front: "a", back: "b" }]))
      .rejects.toMatchObject({ code: "not_found", status: 404 });
    await expect(store.createCard({ deckId: "missing-deck", front: "a", back: "b" }))
      .rejects.toMatchObject({ code: "not_found", status: 404 });
    await expect(store.createCard({ deckId: d.id, front: "", back: "b" }))
      .rejects.toMatchObject({ code: "missing_fields" });
  });
});
