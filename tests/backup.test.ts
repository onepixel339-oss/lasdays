import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach } from "vitest";
import { ldb } from "@/lib/datastore/schema";
import { LocalStore } from "@/lib/datastore/local";
import {
  exportBackup, importBackup, validateBackupFile, backupToString,
  type BackupFileV3,
} from "@/lib/backup";
import type { Card, Note, Task } from "@/lib/datastore/types";

// localStorage shim — the node test env has none
const g = globalThis as unknown as Record<string, unknown>;
if (typeof localStorage === "undefined" || !localStorage) {
  const mem = new Map<string, string>();
  g.localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => void mem.set(k, String(v)),
    removeItem: (k: string) => void mem.delete(k),
    clear: () => void mem.clear(),
  };
}

// ═══════════════ Backup & Restore v3 — complete system tests ═══════════════
// Covers: completeness, round-trip fidelity (IDs/relations/images/history),
// merge (progress-safe), replace (safety backup + full restore), legacy v2,
// validation rejection, settings handling.

const store = new LocalStore();

const T = (over: Partial<Task> = {}): Task => ({
  id: crypto.randomUUID(),
  title: "t",
  subject: null,
  priority: "normal",
  done: false,
  dueDate: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  doneAt: null,
  ...over,
});

async function seedRich() {
  await store.signUp("Ahmed");
  await store.createTask({ title: "task1", subject: "فيزياء", priority: "high", dueDate: "2026-02-01" });
  const t2 = await store.createTask({ title: "task2", subject: null, priority: "low", dueDate: null });
  await store.updateTask(t2.id, { done: true });
  await store.createNote({ title: "note1", content: "المحتوى", subject: "math" });
  await store.createSprint({ name: "sprint1", subject: "فيزياء", totalPages: 100, startDate: "2026-01-01", endDate: "2026-02-01" });
  await store.logSession({ durationSec: 1500, kind: "focus", subject: "فيزياء" });
  await store.createExam({ title: "exam1", subject: "كيميا", date: "2099-01-01" });
  const deck = await store.createDeck({ name: "deck1", subject: "bio", color: "#10B981" });
  const img = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8AAAwAB/AF+XvcAAAAASUVORK5CYII=";
  await store.createCard({ deckId: deck.id, front: "q1", back: "a1", image: img });
  const c2 = await store.createCard({ deckId: deck.id, front: "q2", back: "a2" });
  await store.submitReview(c2.id, "good");
  await store.submitReview(c2.id, "easy");
}

beforeEach(async () => {
  const db = ldb();
  await Promise.all(db.tables.map((t) => t.clear()));
  localStorage.clear();
});

describe("backup export — completeness", () => {
  it("exports every user table, profile, settings and correct counts", async () => {
    localStorage.setItem("ld2_prefs", JSON.stringify({ lang: "ar", theme: "dark", accent: "cyan" }));
    localStorage.setItem("ld2_scratch", "ملاحظاتي");
    localStorage.setItem("ld2_ambvol", "0.7");
    localStorage.setItem("aur.quran.vol", "0.9");
    localStorage.setItem("ld2_focus_settings", JSON.stringify({ focus: 25 }));
    await seedRich();

    const file = await store.exportBackup();
    expect(file.app).toBe("lastdays");
    expect(file.format).toBe(3);
    expect(file.profile).toMatchObject({ username: "Ahmed", locale: "ar" });
    expect(file.data.tasks).toHaveLength(2);
    expect(file.data.notes).toHaveLength(1);
    expect(file.data.sprints).toHaveLength(1);
    expect(file.data.sessions).toHaveLength(1);
    expect(file.data.exams).toHaveLength(1);
    expect(file.data.decks).toHaveLength(1);
    expect(file.data.cards).toHaveLength(2);
    expect(file.data.reviewLogs).toHaveLength(2); // review history included
    expect(file.counts.images).toBe(1);
    expect(file.counts.cards).toBe(2);
    expect(file.settings).toMatchObject({ scratch: "ملاحظاتي", ambienceVolume: 0.7, quranVolume: 0.9 });
    expect((file.settings.prefs as Record<string, unknown>).lang).toBe("ar");
    // the image survived as a data URL (Blob-compatible storage round-trip)
    expect(file.data.cards.find((c) => c.image)?.image?.startsWith("data:image/")).toBe(true);
  });

  it("round-trips: replace-restore on an empty database preserves every record and relation", async () => {
    localStorage.setItem("ld2_prefs", JSON.stringify({ lang: "en", theme: "light", accent: "ember" }));
    localStorage.setItem("ld2_scratch", "ملاحظاتي");
    localStorage.setItem("ld2_ambvol", "0.7");
    await seedRich();
    const file = await store.exportBackup();
    const json = backupToString(file);
    const parsed = validateBackupFile(json);
    expect(parsed.ok).toBe(true);

    // wipe the device entirely
    const db = ldb();
    await Promise.all(db.tables.map((t) => t.clear()));
    await db.kv.put({ key: "signedOut", value: "1" });

    const report = await store.importBackup(parsed.file!, "replace");
    expect(report.added).toBeGreaterThan(0);
    expect(report.safetyBackup).toBeTruthy(); // taken from the now-empty device

    const after = await exportBackup();
    expect(after.data.tasks).toHaveLength(file.data.tasks.length);
    expect(after.data.notes).toHaveLength(file.data.notes.length);
    expect(after.data.sprints).toHaveLength(file.data.sprints.length);
    expect(after.data.sessions).toHaveLength(file.data.sessions.length);
    expect(after.data.exams).toHaveLength(file.data.exams.length);
    expect(after.data.decks).toHaveLength(file.data.decks.length);
    expect(after.data.cards).toHaveLength(file.data.cards.length);
    expect(after.data.reviewLogs).toHaveLength(file.data.reviewLogs.length);
    // IDs and relationships preserved exactly
    for (const c of file.data.cards) {
      const back = after.data.cards.find((x) => x.id === c.id);
      expect(back).toBeDefined();
      expect(back!.deckId).toBe(c.deckId);
      expect(back!.image).toBe(c.image);
      expect(back!.reps).toBe(c.reps);
      expect(back!.dueAt).toBe(c.dueAt);
    }
    for (const r of file.data.reviewLogs) {
      expect(after.data.reviewLogs.find((x) => x.id === r.id)).toMatchObject(r);
    }
    for (const t of file.data.tasks) {
      expect(after.data.tasks.find((x) => x.id === t.id)).toMatchObject({ ...t });
    }
    // profile restored and signed in
    expect(await store.getProfile()).toMatchObject({ username: "Ahmed" });
    // settings restored
    expect(localStorage.getItem("ld2_scratch")).toBe("ملاحظاتي");
    expect((JSON.parse(localStorage.getItem("ld2_prefs")!) as Record<string, unknown>).lang).toBe("en");
    expect(localStorage.getItem("ld2_ambvol")).toBe("0.7");
  });
});

describe("backup import — merge (progress-safe union)", () => {
  it("adds new records without touching existing ones", async () => {
    await seedRich();
    const before = await exportBackup();
    const foreign: BackupFileV3 = {
      ...before,
      data: {
        ...before.data,
        tasks: [T({ title: "foreign task" })],
      },
    };
    const report = await importBackup(foreign, "merge");
    expect(report.byTable.tasks.added).toBe(1);
    expect(report.byTable.tasks.updated).toBe(0);
    const after = await exportBackup();
    expect(after.data.tasks).toHaveLength(before.data.tasks.length + 1);
    // existing untouched
    for (const t of before.data.tasks) {
      expect(after.data.tasks.find((x) => x.id === t.id)).toMatchObject({ ...t });
    }
  });

  it("never regresses completion: local done + incoming undone → stays done", async () => {
    await seedRich();
    const before = await exportBackup();
    const doneTask = before.data.tasks.find((t) => t.done)!;
    expect(doneTask).toBeTruthy();
    const stale: Task = { ...doneTask, done: false, doneAt: null, title: "old title" };
    const report = await importBackup({ ...before, data: { ...before.data, tasks: [stale] } }, "merge");
    expect(report.byTable.tasks.conflicts).toBe(1);
    const after = await exportBackup();
    const merged = after.data.tasks.find((t) => t.id === doneTask.id)!;
    expect(merged.done).toBe(true);
    expect(merged.doneAt).toBeTruthy();
  });

  it("notes: newest updatedAt wins", async () => {
    await store.signUp("Ada");
    const n1 = await store.createNote({ title: "v1", content: "first", subject: null });
    const local = await exportBackup();
    const newer: Note = { ...n1, title: "v2", content: "second", updatedAt: "2027-01-01T00:00:00.000Z" };
    const older: Note = { ...n1, title: "v0", content: "zero", updatedAt: "2020-01-01T00:00:00.000Z" };
    await importBackup({ ...local, data: { ...local.data, notes: [newer] } }, "merge");
    let after = await exportBackup();
    expect(after.data.notes.find((n) => n.id === n1.id)!.title).toBe("v2");
    await importBackup({ ...local, data: { ...local.data, notes: [older] } }, "merge");
    after = await exportBackup();
    expect(after.data.notes.find((n) => n.id === n1.id)!.title).toBe("v2");
  });

  it("cards: the record with more reviews (SRS progress) wins", async () => {
    await store.signUp("Ada");
    const deck = await store.createDeck({ name: "d", subject: null });
    const c = await store.createCard({ deckId: deck.id, front: "f", back: "b" });
    await store.submitReview(c.id, "good");
    const local = await exportBackup();
    const behind: Card = { ...local.data.cards[0]!, reps: 0, intervalDays: 0, dueAt: "2026-01-01T00:00:00.000Z" };
    const report = await importBackup({ ...local, data: { ...local.data, cards: [behind] } }, "merge");
    expect(report.byTable.cards.conflicts).toBe(1);
    const after = await exportBackup();
    const kept = after.data.cards.find((x) => x.id === c.id)!;
    expect(kept.reps).toBe(1); // progress preserved
  });

  it("sprints: donePages takes the maximum", async () => {
    await store.signUp("Ada");
    await store.createSprint({ name: "s", subject: null, totalPages: 100, startDate: "2026-01-01", endDate: "2026-12-31" });
    const local = await exportBackup();
    const importFile = { ...local, data: { ...local.data, sprints: [{ ...local.data.sprints[0]!, donePages: 5 }] } };
    const beforePages = local.data.sprints[0]!.donePages;
    await store.updateSprint(local.data.sprints[0]!.id, { donePages: beforePages + 10 });
    await importBackup(importFile, "merge");
    const after = await exportBackup();
    expect(after.data.sprints[0]!.donePages).toBe(beforePages + 10); // never regressed
  });

  it("review history is append-only: merging the same logs adds nothing, new logs append", async () => {
    await seedRich();
    const local = await exportBackup();
    const report = await importBackup(local, "merge");
    expect(report.byTable.reviewLogs.added).toBe(0);
    const extra = { id: crypto.randomUUID(), cardId: local.data.cards[0]!.id, rating: "hard" as const, reviewedAt: "2026-06-01T00:00:00.000Z" };
    await importBackup({ ...local, data: { ...local.data, reviewLogs: [...local.data.reviewLogs, extra] } }, "merge");
    const after = await exportBackup();
    expect(after.data.reviewLogs).toHaveLength(local.data.reviewLogs.length + 1);
  });

  it("profile conflict is reported, local profile kept, data still merges", async () => {
    await seedRich();
    const local = await exportBackup();
    const foreign = { ...local, profile: { ...local.profile!, username: "OtherPerson" } };
    const report = await importBackup(foreign, "merge");
    expect(report.profile).toBe("kept-conflict");
    expect(await store.getProfile()).toMatchObject({ username: "Ahmed" });
  });
});

describe("backup import — replace", () => {
  it("wipes device data, imports everything, and produces a safety backup of the old data", async () => {
    await seedRich();
    const localBefore = await exportBackup();

    // build a foreign file with different content
    const foreign: BackupFileV3 = {
      ...localBefore,
      profile: { ...localBefore.profile!, username: "Sara", avatar: "⭐" },
      data: {
        ...localBefore.data,
        tasks: [T({ title: "Sara's task", done: true, doneAt: "2026-03-01T00:00:00.000Z" })],
        notes: [],
        sprints: [], sessions: [], exams: [], decks: localBefore.data.decks, cards: [], reviewLogs: [],
      },
    };

    const report = await importBackup(foreign, "replace");
    expect(report.mode).toBe("replace");
    // safety backup captured the pre-replace state
    expect(report.safetyBackup!.data.tasks).toHaveLength(localBefore.data.tasks.length);
    expect(report.safetyBackup!.data.reviewLogs).toHaveLength(localBefore.data.reviewLogs.length);

    const after = await exportBackup();
    expect(after.data.tasks).toHaveLength(1);
    expect(after.data.tasks[0]!.title).toBe("Sara's task");
    expect(after.data.notes).toHaveLength(0);
    expect(after.data.reviewLogs).toHaveLength(0);
    expect(await store.getProfile()).toMatchObject({ username: "Sara", avatar: "⭐" });
  });

  it("replace settings are written (not fill-only)", async () => {
    await store.signUp("Ada");
    localStorage.setItem("ld2_scratch", "OLD");
    const local = await exportBackup();
    const foreign = { ...local, settings: { scratch: "NEW" } };
    await importBackup(foreign, "replace");
    expect(localStorage.getItem("ld2_scratch")).toBe("NEW");
  });

  it("merge settings fill only missing keys", async () => {
    await store.signUp("Ada");
    localStorage.setItem("ld2_scratch", "MINE");
    const local = await exportBackup();
    const foreign = { ...local, settings: { scratch: "THEIRS" } };
    await importBackup(foreign, "merge");
    expect(localStorage.getItem("ld2_scratch")).toBe("MINE");
    localStorage.removeItem("ld2_scratch");
    await importBackup(foreign, "merge");
    expect(localStorage.getItem("ld2_scratch")).toBe("THEIRS");
  });
});

describe("backup validation — invalid files are rejected without touching data", () => {
  it("rejects non-JSON", () => {
    const r = validateBackupFile("{not json");
    expect(r.ok).toBe(false);
  });

  it("rejects other apps' files", () => {
    const r = validateBackupFile(JSON.stringify({ app: "other", format: 3, data: {} }));
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toContain("not a Last Days backup");
  });

  it("rejects unknown formats", () => {
    const r = validateBackupFile(JSON.stringify({ app: "lastdays", format: 99, data: {} }));
    expect(r.ok).toBe(false);
  });

  it("rejects duplicate ids (corrupt file)", async () => {
    await seedRich();
    const file = await exportBackup();
    const bad = JSON.parse(backupToString(file));
    bad.data.tasks.push({ ...bad.data.tasks[0] }); // duplicate id
    const r = validateBackupFile(bad);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes("duplicate"))).toBe(true);
  });

  it("rejects malformed records field-by-field", async () => {
    await seedRich();
    const file = await exportBackup();
    const bad = JSON.parse(backupToString(file));
    delete bad.data.tasks[0].title;
    bad.data.cards[0].image = "http://evil.example/x.mp3"; // not a data URL
    bad.data.reviewLogs[0].rating = "superb";
    const r = validateBackupFile(bad);
    expect(r.ok).toBe(false);
    expect(r.errors.length).toBeGreaterThanOrEqual(3);
  });

  it("rejects but does not modify data — the database is untouched on rejection", async () => {
    await seedRich();
    const before = await exportBackup();
    expect(validateBackupFile("{bad").ok).toBe(false);
    const after = await exportBackup();
    expect(after.data).toEqual(before.data);
  });

  it("warns on orphan cards and skips them on import", async () => {
    await store.signUp("Ada");
    const deck = await store.createDeck({ name: "d", subject: null });
    await store.createCard({ deckId: deck.id, front: "f", back: "b" });
    const local = await exportBackup();
    const orphan: Card = {
      id: crypto.randomUUID(), deckId: "missing-deck", front: "x", back: "y", image: null,
      ease: 2.5, intervalDays: 0, dueAt: "2026-01-01T00:00:00.000Z", reps: 0, lapses: 0,
      createdAt: "2026-01-01T00:00:00.000Z",
    };
    const r = validateBackupFile(JSON.stringify({ ...local, data: { ...local.data, cards: [orphan] } }));
    expect(r.ok).toBe(true);
    expect(r.warnings.some((w) => w.includes("missing deck"))).toBe(true);
    const report = await importBackup(r.file!, "merge");
    expect(report.byTable.cards.skipped).toBe(1);
    const after = await exportBackup();
    expect(after.data.cards.find((c) => c.id === orphan.id)).toBeUndefined();
  });
});

describe("legacy v2 backups import through the same pipeline", () => {
  it("imports v2 tasks/notes/sprints/exams/decks+cards with ids and images preserved", async () => {
    await store.signUp("Ahmed");
    const deck = await store.createDeck({ name: "deck1", subject: null });
    const img = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8AAAwAB/AF+XvcAAAAASUVORK5CYII=";
    const card1 = await store.createCard({ deckId: deck.id, front: "f1", back: "b1", image: img });
    const t1 = await store.createTask({ title: "t1", subject: null, priority: "high", dueDate: "2026-05-01" });
    const n1 = await store.createNote({ title: "n1", content: "c1", subject: null });
    const e1 = await store.createExam({ title: "e1", subject: null, date: "2099-06-01" });
    await store.createSprint({ name: "s1", subject: null, totalPages: 50, startDate: "2026-01-01", endDate: "2026-12-31" });

    // craft a genuine v2 file (the old settings-page export shape)
    const v2 = {
      app: "lastdays",
      schema: 2,
      exportedAt: "2026-01-01T00:00:00.000Z",
      tasks: { tasks: [t1] },
      notes: { notes: [n1] },
      sprints: { sprints: (await store.listSprints()) },
      exams: { exams: [e1] },
      decks: { decks: [{ id: deck.id, name: deck.name, subject: null, color: deck.color, createdAt: deck.createdAt, cards: [card1] }] },
    };
    const r = validateBackupFile(JSON.stringify(v2));
    expect(r.ok).toBe(true);
    expect(r.legacy).toBe(true);
    expect(r.file!.data.cards).toHaveLength(1);
    expect(r.file!.data.cards[0]!.image).toBe(img);
    expect(r.file!.data.sessions).toHaveLength(0);
    expect(r.file!.data.reviewLogs).toHaveLength(0);

    // restore on a fresh device
    const db = ldb();
    await Promise.all(db.tables.map((t) => t.clear()));
    const report = await importBackup(r.file!, "replace");
    expect(report.added).toBe(6); // task + note + sprint + exam + deck + card
    const after = await exportBackup();
    expect(after.data.tasks[0]!.id).toBe(t1.id); // IDs preserved
    expect(after.data.cards[0]!.id).toBe(card1.id);
    expect(after.data.cards[0]!.image).toBe(img);
    expect(after.data.exams[0]!.id).toBe(e1.id);
  });

  it("accepts the v2 plain-array decks shape too", () => {
    const v2 = {
      app: "lastdays",
      schema: 2,
      decks: [{ name: "d", cards: [{ front: "f", back: "b" }] }],
    };
    const r = validateBackupFile(JSON.stringify(v2));
    expect(r.ok).toBe(true);
    expect(r.file!.data.decks).toHaveLength(1);
  });
});
