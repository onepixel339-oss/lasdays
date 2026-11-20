// ═══════════════ Dexie schema v1 — the local database ═══════════════
// One table per Prisma model minus User (a local profile row) minus the three
// server-only models (AuthSession, PushSubscription, PushLog — no sessions to
// a server, no push).
//
// Primary keys are the existing server IDs (strings) so migrated data keeps
// ReviewLog.cardId integrity. New records get crypto.randomUUID().
// Dates are ISO-8601 UTC strings — lexicographic order == chronological order,
// exactly like the wire format. `userId` columns dissolve (one local user).

import Dexie, { type Table } from "dexie";
import type { Card, Deck, Exam, Note, Profile, ReviewLog, Sprint, StudySession, Task } from "./types";

export interface KVRow {
  key: string;
  value: string;
}

/** Storage-internal profile row (numeric auto-key); mapped to the wire Profile on read. */
export interface ProfileRow extends Omit<Profile, "id"> {
  id: number;
  createdAt: string;
}

export class LastDaysDB extends Dexie {
  profile!: Table<ProfileRow, number>; // single row, id === 1
  tasks!: Table<Task, string>;
  notes!: Table<Note, string>;
  sprints!: Table<Sprint, string>;
  sessions!: Table<StudySession, string>;
  exams!: Table<Exam, string>;
  decks!: Table<Deck, string>;
  cards!: Table<Card, string>;
  reviewLogs!: Table<ReviewLog, string>;
  kv!: Table<KVRow, string>;

  constructor() {
    super("lastdays");
    // NOTE: booleans (done/active/pinned/completed) are NOT valid IndexedDB
    // index keys — they stay as stored values and are filtered/sorted in JS.
    this.version(1).stores({
      profile: "++id",
      tasks: "id, dueDate, createdAt",
      notes: "id, updatedAt",
      sprints: "id, createdAt, startDate, endDate",
      sessions: "id, startedAt, kind",
      exams: "id, date",
      decks: "id, createdAt",
      cards: "id, deckId, dueAt",
      reviewLogs: "id, cardId, reviewedAt",
      kv: "key",
    });
  }
}

let _db: LastDaysDB | null = null;

/** Lazy, SSR-safe singleton — Dexie never opens until the first real operation. */
export function ldb(): LastDaysDB {
  if (!_db) _db = new LastDaysDB();
  return _db;
}

/** Test-only: replace the singleton (used with fake-indexeddb). */
export function __setDb(db: LastDaysDB | null): void {
  _db = db;
}
