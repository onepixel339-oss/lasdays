"use client";

// ═══════════════ LocalStore — Dexie/IndexedDB implementation ═══════════════
// Implements DataStore against the local database with IDENTICAL semantics to
// the original REST API: same validation rules, same error codes, same ordering,
// same computed fields (deck readiness, today's Cairo aggregate, stats shape).
//
// Local-specific semantics (honest local-first behavior):
//   • One profile per device. signUp with a different name while a profile
//     exists → "profile_exists" (never silently mixes data).
//   • signOut only ends the session (kv flag) — data always stays on device.

import type {
  Card, DataStore, DeckFull, DeckSummary, Exam, Grade, Note, Profile,
  ProfilePatch, Sprint, StatsData, StudySession, Task, TodaySessions,
} from "./types";
import { StoreError, fail } from "./errors";
import { ldb } from "./schema";
import { computeStats } from "@/lib/stats-core";
import { schedule } from "@/lib/srs";
import { normalizeName, isValidName, isReservedName } from "@/lib/name";
import { todayCairo, startOfCairoDay, cairoDayOf, shiftDay } from "@/lib/day";
import {
  exportBackup, importBackup, type BackupFileV3, type BackupPhase, type RestoreReport,
} from "@/lib/backup";

const TITLE_MAX = 200;
const NOTE_TITLE_MAX = 200;
const NOTE_CONTENT_MAX = 20_000;
const TEXT_MAX = 500;
const IMG_MAX = 800_000; // ~600KB binary as base64 — client downscales before sending
const MAX_SESSION_SEC = 8 * 3600;
const ACCENTS = ["nebula", "cyan", "ember", "emerald", "rose"];
const PROFILE_ID = 1;

function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `id_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Strictly increasing ISO timestamps for createdAt/startedAt ordering.
 * The server effectively issues strictly-increasing timestamps (one DB write
 * per request); locally, rapid creates can land in the same millisecond, which
 * would make "oldest first" ordering unstable. Never issue the same ms twice.
 */
let _lastTs = 0;
function nextIso(): string {
  let ts = Date.now();
  if (ts <= _lastTs) ts = _lastTs + 1;
  _lastTs = ts;
  return new Date(ts).toISOString();
}

/** Exact port of the server's imageOf() — undefined = don't touch. */
function imageOf(v: unknown): string | null | undefined {
  if (v === undefined) return undefined;
  if (v === null || v === "") return null;
  const s = String(v);
  if (!s.startsWith("data:image/")) return undefined;
  return s.length <= IMG_MAX ? s : undefined;
}

function subjOrNull(v: unknown, max: number): string | null {
  return typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null;
}

function toProfile(row: { id: number; username: string; isGuest: boolean; avatar: string; locale: string; themeMode: string; themeAccent: string }): Profile {
  return {
    id: String(row.id),
    username: row.username,
    isGuest: row.isGuest,
    avatar: row.avatar,
    locale: row.locale,
    themeMode: row.themeMode,
    themeAccent: row.themeAccent,
  };
}

export class LocalStore implements DataStore {
  readonly mode = "local" as const;

  // ── profile / access ────────────────────────────────────────────────────

  async getProfile(): Promise<Profile | null> {
    const db = ldb();
    const signedOut = await db.kv.get("signedOut");
    if (signedOut) return null;
    const row = await db.profile.get(PROFILE_ID);
    return row ? toProfile(row) : null;
  }

  private async profileRow() {
    return ldb().profile.get(PROFILE_ID);
  }

  private async setSignedOut(v: boolean): Promise<void> {
    if (v) await ldb().kv.put({ key: "signedOut", value: "1" });
    else await ldb().kv.delete("signedOut");
  }

  async signIn(username: string): Promise<Profile> {
    if (!isValidName(username)) fail("invalid_name");
    const row = await this.profileRow();
    if (!row || row.isGuest || normalizeName(username) !== normalizeName(row.username)) {
      fail("no_account", 401);
    }
    await this.setSignedOut(false);
    return toProfile(row);
  }

  async signUp(username: string): Promise<Profile> {
    if (!isValidName(username)) fail("invalid_name");
    const key = normalizeName(username);
    if (isReservedName(key)) fail("reserved_name");
    const row = await this.profileRow();
    if (row) {
      // one profile per device — same name reopens it, a different name is refused
      if (key === normalizeName(row.username)) {
        await this.setSignedOut(false);
        return toProfile(row);
      }
      fail("profile_exists", 409);
    }
    const created = {
      id: PROFILE_ID,
      username: username.trim(),
      isGuest: false,
      avatar: "amber",
      locale: "ar",
      themeMode: "dark",
      themeAccent: "nebula",
      createdAt: new Date().toISOString(),
    };
    await ldb().profile.put(created);
    await this.setSignedOut(false);
    return toProfile(created);
  }

  async signInAsGuest(): Promise<Profile> {
    const row = await this.profileRow();
    if (row) {
      // reuse the existing profile — never mix or overwrite device data
      await this.setSignedOut(false);
      return toProfile(row);
    }
    const username = `guest_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const created = {
      id: PROFILE_ID,
      username,
      isGuest: true,
      avatar: "amber",
      locale: "ar",
      themeMode: "dark",
      themeAccent: "nebula",
      createdAt: new Date().toISOString(),
    };
    await ldb().profile.put(created);
    await this.setSignedOut(false);
    return toProfile(created);
  }

  async signOut(): Promise<void> {
    await this.setSignedOut(true);
  }

  async updateProfile(patch: ProfilePatch): Promise<Profile> {
    const db = ldb();
    const row = await db.profile.get(PROFILE_ID);
    if (!row) fail("unauthorized", 401);
    const data = { ...row };
    if (patch.locale === "ar" || patch.locale === "en") data.locale = patch.locale;
    if (patch.themeMode === "light" || patch.themeMode === "dark") data.themeMode = patch.themeMode;
    if (ACCENTS.includes(patch.themeAccent as string)) data.themeAccent = patch.themeAccent as string;
    if (typeof patch.avatar === "string" && patch.avatar.length <= 4) data.avatar = patch.avatar;
    await db.profile.put(data);
    return toProfile(data);
  }

  async renameProfile(username: string): Promise<Profile> {
    const db = ldb();
    const row = await db.profile.get(PROFILE_ID);
    if (!row) fail("unauthorized", 401);
    if (!isValidName(username)) fail("invalid_name");
    const key = normalizeName(username);
    if (row.isGuest && isReservedName(key)) fail("reserved_name");
    const data = { ...row, username: username.trim(), isGuest: false };
    await db.profile.put(data);
    return toProfile(data);
  }

  // ── tasks ───────────────────────────────────────────────────────────────

  async listTasks(): Promise<Task[]> {
    const tasks = await ldb().tasks.toArray();
    return tasks.sort(
      (a, b) =>
        Number(a.done) - Number(b.done) || b.createdAt.localeCompare(a.createdAt)
    );
  }

  async createTask(input: { title: string; subject: string | null; priority: string; dueDate: string | null }): Promise<Task> {
    const title = String(input.title ?? "").trim().slice(0, TITLE_MAX);
    if (!title) fail("title_required");
    const task: Task = {
      id: newId(),
      title,
      subject: subjOrNull(input.subject, 60),
      priority: ["low", "normal", "high"].includes(input.priority) ? (input.priority as Task["priority"]) : "normal",
      done: false,
      dueDate: input.dueDate ? String(input.dueDate).slice(0, 10) : null,
      createdAt: nextIso(),
      doneAt: null,
    };
    await ldb().tasks.put(task);
    return task;
  }

  async updateTask(id: string, patch: Record<string, unknown>): Promise<void> {
    const db = ldb();
    await db.transaction("rw", db.tasks, async () => {
      const task = await db.tasks.get(id);
      if (!task) fail("not_found", 404);
      const data = { ...task };
      if (typeof patch.title === "string" && patch.title.trim()) data.title = patch.title.trim().slice(0, TITLE_MAX);
      if (typeof patch.subject === "string" || patch.subject === null) data.subject = subjOrNull(patch.subject, 60);
      if (["low", "normal", "high"].includes(patch.priority as string)) data.priority = patch.priority as Task["priority"];
      if (patch.dueDate === null || patch.dueDate) {
        data.dueDate = patch.dueDate ? String(patch.dueDate).slice(0, 10) : null;
      }
      if (typeof patch.done === "boolean") {
        data.done = patch.done;
        // stamp the completion time on the done transition only
        if (patch.done && !task.done) data.doneAt = new Date().toISOString();
        if (!patch.done && task.done) data.doneAt = null;
      }
      await db.tasks.put(data);
    });
  }

  async deleteTask(id: string): Promise<void> {
    await ldb().tasks.delete(id);
  }

  // ── notes ───────────────────────────────────────────────────────────────

  async listNotes(): Promise<Note[]> {
    const notes = await ldb().notes.toArray();
    return notes.sort(
      (a, b) =>
        Number(b.pinned) - Number(a.pinned) || b.updatedAt.localeCompare(a.updatedAt)
    );
  }

  async createNote(input: { title: string; content: string; subject: string | null }): Promise<Note> {
    const now = nextIso();
    const note: Note = {
      id: newId(),
      title: String(input.title ?? "").trim().slice(0, NOTE_TITLE_MAX) || "…",
      content: String(input.content ?? "").slice(0, NOTE_CONTENT_MAX),
      subject: subjOrNull(input.subject, 60),
      pinned: false,
      createdAt: now,
      updatedAt: now,
    };
    await ldb().notes.put(note);
    return note;
  }

  async updateNote(id: string, patch: Record<string, unknown>): Promise<void> {
    const db = ldb();
    await db.transaction("rw", db.notes, async () => {
      const note = await db.notes.get(id);
      if (!note) fail("not_found", 404);
      const data = { ...note };
      if (typeof patch.title === "string") data.title = patch.title.trim().slice(0, NOTE_TITLE_MAX) || "…";
      if (typeof patch.content === "string") data.content = patch.content.slice(0, NOTE_CONTENT_MAX);
      if (typeof patch.subject === "string" || patch.subject === null) data.subject = subjOrNull(patch.subject, 60);
      if (typeof patch.pinned === "boolean") data.pinned = patch.pinned;
      data.updatedAt = new Date().toISOString();
      await db.notes.put(data);
    });
  }

  async deleteNote(id: string): Promise<void> {
    await ldb().notes.delete(id);
  }

  // ── sprints ─────────────────────────────────────────────────────────────

  async listSprints(): Promise<Sprint[]> {
    const sprints = await ldb().sprints.toArray();
    return sprints.sort(
      (a, b) => Number(b.active) - Number(a.active) || b.createdAt.localeCompare(a.createdAt)
    );
  }

  async createSprint(input: {
    name: string; subject: string | null; totalPages: number; startDate: string; endDate: string;
  }): Promise<Sprint> {
    const db = ldb();
    const name = String(input.name ?? "").trim().slice(0, 80);
    const totalPages = Number(input.totalPages);
    if (!name) fail("name_required");
    if (!Number.isFinite(totalPages) || totalPages < 1 || totalPages > 50_000) fail("pages_required");
    const start = input.startDate ? String(input.startDate).slice(0, 10) : new Date().toISOString().slice(0, 10);
    const end = input.endDate
      ? String(input.endDate).slice(0, 10)
      : new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
    if (end <= start) fail("invalid_dates");

    const sprint: Sprint = {
      id: newId(),
      name,
      subject: subjOrNull(input.subject, 60),
      totalPages: Math.round(totalPages),
      donePages: 0,
      startDate: start,
      endDate: end,
      active: true,
      createdAt: nextIso(),
    };
    await db.transaction("rw", db.sprints, async () => {
      // only one active at a time — new sprint takes over
      const all = await db.sprints.toArray();
      await db.sprints.bulkPut(all.filter((s) => s.active).map((s) => ({ ...s, active: false })));
      await db.sprints.put(sprint);
    });
    return sprint;
  }

  async updateSprint(id: string, patch: Record<string, unknown>): Promise<void> {
    const db = ldb();
    await db.transaction("rw", db.sprints, async () => {
      const sprint = await db.sprints.get(id);
      if (!sprint) fail("not_found", 404);
      const data = { ...sprint };
      if (typeof patch.name === "string" && patch.name.trim()) data.name = patch.name.trim().slice(0, 80);
      if (typeof patch.subject === "string" || patch.subject === null) data.subject = subjOrNull(patch.subject, 60);
      if (patch.totalPages !== undefined) {
        const tp = Math.round(Number(patch.totalPages));
        if (!Number.isFinite(tp) || tp < 1 || tp > 50_000) fail("pages_required");
        // total pages can never drop below what's already done
        data.totalPages = Math.max(tp, sprint.donePages);
      }
      if (typeof patch.active === "boolean") {
        if (patch.active) {
          const all = await db.sprints.toArray();
          await db.sprints.bulkPut(all.filter((s) => s.active).map((s) => ({ ...s, active: false })));
        }
        data.active = patch.active;
      }
      if (patch.donePages !== undefined) {
        const dp = Math.round(Number(patch.donePages));
        if (!Number.isFinite(dp)) fail("pages_required");
        data.donePages = Math.max(0, Math.min(data.totalPages, dp));
      }
      if (patch.addPages !== undefined) {
        const add = Math.round(Number(patch.addPages));
        if (!Number.isFinite(add)) fail("pages_required");
        data.donePages = Math.max(0, Math.min(data.totalPages, sprint.donePages + add));
      }
      await db.sprints.put(data);
    });
  }

  async deleteSprint(id: string): Promise<void> {
    await ldb().sprints.delete(id);
  }

  // ── exams ───────────────────────────────────────────────────────────────

  async listExams(): Promise<Exam[]> {
    const today = todayCairo();
    const exams = (await ldb().exams.where("date").aboveOrEqual(today).toArray())
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(0, 10);
    return exams;
  }

  async createExam(input: { title: string; subject: string | null; date: string }): Promise<Exam> {
    const title = String(input.title ?? "").trim();
    const date = String(input.date ?? "").slice(0, 10);
    if (!title) fail("title_required");
    if (title.length > 80) fail("title_too_long");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) fail("date_invalid");
    if (date < todayCairo()) fail("date_past");
    const upcoming = await ldb().exams.where("date").aboveOrEqual(todayCairo()).count();
    if (upcoming >= 10) fail("too_many_exams");
    const exam: Exam = {
      id: newId(),
      title,
      subject: subjOrNull(input.subject, 40),
      date,
      createdAt: nextIso(),
    };
    await ldb().exams.put(exam);
    return exam;
  }

  async updateExam(id: string, patch: Record<string, unknown>): Promise<void> {
    const db = ldb();
    await db.transaction("rw", db.exams, async () => {
      const exam = await db.exams.get(id);
      if (!exam) fail("not_found", 404);
      const data = { ...exam };
      if (typeof patch.title === "string" && patch.title.trim()) {
        const title = patch.title.trim();
        if (title.length > 80) fail("title_too_long");
        data.title = title;
      }
      if (typeof patch.subject === "string" || patch.subject === null) data.subject = subjOrNull(patch.subject, 40);
      if (patch.date !== undefined) {
        const date = String(patch.date ?? "").slice(0, 10);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) fail("date_invalid");
        data.date = date;
      }
      await db.exams.put(data);
    });
  }

  async deleteExam(id: string): Promise<void> {
    await ldb().exams.delete(id);
  }

  // ── sessions ────────────────────────────────────────────────────────────

  async getTodaySessions(): Promise<TodaySessions> {
    // Cairo-calendar "today" — not device-local midnight, not UTC
    const sinceIso = startOfCairoDay(todayCairo()).toISOString();
    const rows = await ldb().sessions.where("kind").equals("focus").toArray();
    let todaySec = 0;
    let todayCount = 0;
    for (const s of rows) {
      if (!s.completed || s.startedAt < sinceIso) continue;
      todaySec += s.durationSec;
      todayCount += 1;
    }
    return { todaySec, todayCount };
  }

  async logSession(input: { durationSec: number; kind: "focus" | "break"; subject: string | null }): Promise<StudySession> {
    const durationSec = Math.round(Number(input.durationSec ?? 0));
    const kind = input.kind === "break" ? "break" : "focus";
    if (!Number.isFinite(durationSec) || durationSec < 30) fail("too_short");
    if (durationSec > MAX_SESSION_SEC) fail("too_long");
    const session: StudySession = {
      id: newId(),
      startedAt: nextIso(),
      durationSec,
      kind,
      subject: subjOrNull(input.subject, 60),
      completed: true,
    };
    await ldb().sessions.put(session);
    return session;
  }

  // ── stats ───────────────────────────────────────────────────────────────

  async getStats(): Promise<StatsData> {
    const db = ldb();
    const [sessions, reviewCount, doneTasks] = await Promise.all([
      db.sessions.where("kind").equals("focus").toArray(),
      db.reviewLogs.count(),
      db.tasks.toArray().then((ts) => ts.filter((t) => t.done).length),
    ]);
    return computeStats(
      sessions
        .filter((s) => s.completed)
        .map((s) => ({ startedAt: s.startedAt, durationSec: s.durationSec, subject: s.subject })),
      reviewCount,
      doneTasks
    );
  }

  // ── srs ─────────────────────────────────────────────────────────────────

  private deckStats(cards: { dueAt: string; reps: number; intervalDays: number }[]) {
    const now = new Date().toISOString();
    const due = cards.filter((c) => c.dueAt <= now).length;
    const mature = cards.filter((c) => c.reps >= 3 && c.intervalDays >= 7).length;
    return {
      dueCount: due,
      matureCount: mature,
      readiness: cards.length ? Math.round((mature / cards.length) * 100) : 0,
    };
  }

  async listDecks(): Promise<DeckSummary[]> {
    const db = ldb();
    const decks = (await db.decks.toArray()).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const out: DeckSummary[] = [];
    for (const d of decks) {
      // lightweight: no image payloads leave the table — only the 3 needed fields
      const cards = await db.cards.where("deckId").equals(d.id).toArray();
      out.push({
        id: d.id,
        name: d.name,
        subject: d.subject,
        color: d.color,
        createdAt: d.createdAt,
        cardCount: cards.length,
        ...this.deckStats(cards),
      });
    }
    return out;
  }

  async getDeck(id: string): Promise<DeckFull | null> {
    const db = ldb();
    const deck = await db.decks.get(id);
    if (!deck) return null;
    const cards = (await db.cards.where("deckId").equals(id).toArray()).sort((a, b) =>
      a.createdAt.localeCompare(b.createdAt)
    );
    return { ...deck, cards, cardCount: cards.length, ...this.deckStats(cards) };
  }

  async createDeck(input: { name: string; subject: string | null; color?: string }): Promise<DeckSummary> {
    const name = String(input.name ?? "").trim().slice(0, 80);
    if (!name) fail("name_required");
    const deck = {
      id: newId(),
      name,
      subject: subjOrNull(input.subject, 60),
      color: /^#[0-9a-fA-F]{6}$/.test(String(input.color ?? "")) ? String(input.color) : "#B85C38",
      createdAt: nextIso(),
    };
    await ldb().decks.put(deck);
    return { ...deck, cardCount: 0, dueCount: 0, matureCount: 0, readiness: 0 };
  }

  async updateDeck(id: string, patch: Record<string, unknown>): Promise<void> {
    const db = ldb();
    await db.transaction("rw", db.decks, async () => {
      const deck = await db.decks.get(id);
      if (!deck) fail("not_found", 404);
      const data = { ...deck };
      if (typeof patch.name === "string" && patch.name.trim()) data.name = patch.name.trim().slice(0, 80);
      if (typeof patch.subject === "string" || patch.subject === null) data.subject = subjOrNull(patch.subject, 60);
      if (typeof patch.color === "string" && /^#[0-9a-fA-F]{6}$/.test(patch.color)) data.color = patch.color;
      await db.decks.put(data);
    });
  }

  async deleteDeck(id: string): Promise<void> {
    // cascade removes the deck's cards (same as the server's onDelete: Cascade);
    // review logs keep their cardId references, exactly like the server schema
    const db = ldb();
    await db.transaction("rw", db.decks, db.cards, async () => {
      await db.cards.where("deckId").equals(id).delete();
      await db.decks.delete(id);
    });
  }

  async createCard(input: { deckId: string; front: string; back: string; image?: string | null }): Promise<Card> {
    const db = ldb();
    const deckId = String(input.deckId ?? "");
    const front = String(input.front ?? "").trim().slice(0, TEXT_MAX);
    const back = String(input.back ?? "").trim().slice(0, TEXT_MAX);
    if (!deckId || !front || !back) fail("missing_fields");
    const deck = await db.decks.get(deckId);
    if (!deck) fail("not_found", 404);
    const image = imageOf(input.image);
    const card: Card = {
      id: newId(),
      deckId,
      front,
      back,
      image: image !== undefined ? image : null,
      ease: 2.5,
      intervalDays: 0,
      dueAt: new Date().toISOString(), // new cards are due immediately
      reps: 0,
      lapses: 0,
      createdAt: nextIso(),
    };
    await db.cards.put(card);
    return card;
  }

  async updateCard(id: string, patch: Record<string, unknown>): Promise<void> {
    const db = ldb();
    await db.transaction("rw", db.cards, async () => {
      const card = await db.cards.get(id);
      if (!card) fail("not_found", 404);
      const data = { ...card };
      if (typeof patch.front === "string" && patch.front.trim()) data.front = patch.front.trim().slice(0, TEXT_MAX);
      if (typeof patch.back === "string" && patch.back.trim()) data.back = patch.back.trim().slice(0, TEXT_MAX);
      const image = imageOf(patch.image);
      if (image !== undefined) data.image = image;
      await db.cards.put(data);
    });
  }

  async deleteCard(id: string): Promise<void> {
    await ldb().cards.delete(id);
  }

  async getDueCards(deckId?: string): Promise<Card[]> {
    const now = new Date().toISOString();
    let cards = await ldb().cards.where("dueAt").belowOrEqual(now).toArray();
    if (deckId) cards = cards.filter((c) => c.deckId === deckId);
    return cards
      .sort((a, b) => a.dueAt.localeCompare(b.dueAt))
      .slice(0, 30);
  }

  async submitReview(cardId: string, grade: Grade): Promise<void> {
    const db = ldb();
    await db.transaction("rw", db.cards, db.reviewLogs, async () => {
      const card = await db.cards.get(cardId);
      if (!card) fail("not_found", 404);
      if (!["again", "hard", "good", "easy"].includes(grade)) fail("bad_request");
      const next = schedule(
        { ease: card.ease, intervalDays: card.intervalDays, reps: card.reps, lapses: card.lapses },
        grade
      );
      await db.cards.put({
        ...card,
        ease: next.ease,
        intervalDays: next.intervalDays,
        reps: next.reps,
        lapses: next.lapses,
        dueAt: next.dueAt.toISOString(),
      });
      const log = {
        id: newId(),
        cardId: card.id,
        rating: grade,
        reviewedAt: nextIso(),
      };
      await db.reviewLogs.put(log);
    });
  }

  async importCards(deckId: string, rows: { front: string; back: string }[]): Promise<number> {
    const db = ldb();
    if (!deckId) fail("missing_fields");
    if (!Array.isArray(rows) || !rows.length) fail("empty_rows");
    if (rows.length > 500) fail("too_many_rows");
    const deck = await db.decks.get(deckId);
    if (!deck) fail("not_found", 404);
    const data = rows
      .map((x) => ({
        id: newId(),
        deckId,
        front: String(x.front ?? "").trim().slice(0, 500),
        back: String(x.back ?? "").trim().slice(0, 500),
        image: null,
        ease: 2.5,
        intervalDays: 0,
        dueAt: new Date().toISOString(),
        reps: 0,
        lapses: 0,
        createdAt: nextIso(),
      }))
      .filter((c) => c.front && c.back);
    if (!data.length) fail("empty_rows");
    await db.cards.bulkPut(data);
    return data.length;
  }

  // ── backup / restore (local database only — the complete data snapshot) ──

  /** Complete v3 backup: profile, settings, and every user table incl. images. */
  async exportBackup(onProgress?: (p: BackupPhase) => void): Promise<BackupFileV3> {
    return exportBackup(ldb(), onProgress);
  }

  /** Validated import. Replace mode takes an automatic safety snapshot first. */
  async importBackup(
    file: BackupFileV3,
    mode: "merge" | "replace",
    onProgress?: (p: BackupPhase) => void
  ): Promise<RestoreReport> {
    return importBackup(file, mode, ldb(), onProgress);
  }
}

// ── re-exports used by tests / future backup tooling ────────────────────────
export { cairoDayOf, shiftDay };
export type { StoreError };
