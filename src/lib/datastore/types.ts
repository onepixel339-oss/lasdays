// ═══════════════ DataStore — the single data contract of the app ═══════════════
// One interface, one production implementation:
//   • LocalStore — Dexie/IndexedDB (the only production data store)
//
// IMPORTANT FIDELITY RULE: every entity type and every method mirrors the exact
// JSON shape the previous server API returned (dates are ISO strings, so they
// are ISO strings in local storage too).

// ── entities (exact wire shapes) ────────────────────────────────────────────

/** publicUser shape — no secrets, no gamification. */
export interface Profile {
  id: string;
  username: string;
  isGuest: boolean;
  avatar: string;
  locale: string; // ar | en
  themeMode: string; // light | dark
  themeAccent: string; // nebula | cyan | ember | emerald | rose
}

export interface Task {
  id: string;
  title: string;
  subject: string | null;
  priority: "low" | "normal" | "high";
  done: boolean;
  dueDate: string | null; // "2026-10-01"
  createdAt: string; // ISO
  doneAt: string | null;
}

export interface Note {
  id: string;
  title: string;
  content: string;
  subject: string | null;
  pinned: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Sprint {
  id: string;
  name: string;
  subject: string | null;
  totalPages: number;
  donePages: number;
  startDate: string;
  endDate: string;
  active: boolean;
  createdAt: string;
}

export interface Exam {
  id: string;
  title: string;
  subject: string | null;
  date: string; // "2026-10-01"
  createdAt: string;
}

export interface StudySession {
  id: string;
  startedAt: string; // ISO
  durationSec: number;
  kind: "focus" | "break";
  subject: string | null;
  completed: boolean;
}

export interface Card {
  id: string;
  deckId: string;
  front: string;
  back: string;
  image: string | null; // data URL (converted to/from Blob only at the storage edge, Phase 2)
  ease: number;
  intervalDays: number;
  dueAt: string; // ISO
  reps: number;
  lapses: number;
  createdAt: string;
}

export interface ReviewLog {
  id: string;
  cardId: string;
  rating: "again" | "hard" | "good" | "easy";
  reviewedAt: string;
}

export interface Deck {
  id: string;
  name: string;
  subject: string | null;
  color: string;
  createdAt: string;
}

/** Deck row in the list view — no image payloads (matches GET /api/srs/decks). */
export interface DeckSummary extends Deck {
  cardCount: number;
  dueCount: number;
  matureCount: number;
  readiness: number; // 0–100
}

/** Full deck incl. cards (matches GET /api/srs/decks/[id]). */
export interface DeckFull extends Deck {
  cards: Card[];
  cardCount: number;
  dueCount: number;
  matureCount: number;
  readiness: number;
}

/** GET /api/sessions — Cairo-day aggregate, not a list. */
export interface TodaySessions {
  todaySec: number;
  todayCount: number;
}

/** GET /api/stats — exact server aggregation shape. */
export interface StatsData {
  week: { day: string; minutes: number }[];
  heat: { day: string; minutes: number }[];
  bySubject: { subject: string; minutes: number }[];
  weekBySubject: { subject: string; minutes: number }[];
  totals: { focusMinutes: number; sessions: number; reviews: number; doneTasks: number };
  weekCompare: { this: number; last: number };
}

// ── input types (validated identically by both stores) ──────────────────────

export type TaskPatch = Partial<Pick<Task, "title" | "subject" | "priority" | "dueDate" | "done">>;
export type NotePatch = Partial<Pick<Note, "title" | "content" | "subject" | "pinned">>;
export type SprintPatch = Partial<Pick<Sprint, "name" | "subject" | "totalPages" | "active" | "donePages">> & {
  addPages?: number;
};
export type ExamPatch = Partial<Pick<Exam, "title" | "subject" | "date">>;
export type DeckPatch = Partial<Pick<DeckSummary, "name" | "subject" | "color">>;
export type CardPatch = Partial<Pick<Card, "front" | "back" | "image">>;
export type ProfilePatch = Partial<Pick<Profile, "locale" | "themeMode" | "themeAccent" | "avatar">>;

export type Grade = "again" | "hard" | "good" | "easy";

export interface StoreError {
  code: string; // same codes the old API returned ("title_required", "username_taken", …)
  status: number;
}

// ── the store contract ──────────────────────────────────────────────────────

export interface DataStore {
  readonly mode: "local";

  // profile / access (name-only; a local profile row on this device)
  getProfile(): Promise<Profile | null>;
  signIn(username: string): Promise<Profile>;
  signUp(username: string): Promise<Profile>;
  signInAsGuest(): Promise<Profile>;
  signOut(): Promise<void>;
  updateProfile(patch: ProfilePatch): Promise<Profile>;
  /** Claim a guest profile by giving it a name (keeps all data); also renames. */
  renameProfile(username: string): Promise<Profile>;

  // tasks
  listTasks(): Promise<Task[]>;
  createTask(input: { title: string; subject: string | null; priority: string; dueDate: string | null }): Promise<Task>;
  updateTask(id: string, patch: TaskPatch): Promise<void>;
  deleteTask(id: string): Promise<void>;

  // notes
  listNotes(): Promise<Note[]>;
  createNote(input: { title: string; content: string; subject: string | null }): Promise<Note>;
  updateNote(id: string, patch: NotePatch): Promise<void>;
  deleteNote(id: string): Promise<void>;

  // sprints
  listSprints(): Promise<Sprint[]>;
  createSprint(input: {
    name: string;
    subject: string | null;
    totalPages: number;
    startDate: string;
    endDate: string;
  }): Promise<Sprint>;
  updateSprint(id: string, patch: SprintPatch): Promise<void>;
  deleteSprint(id: string): Promise<void>;

  // exams
  listExams(): Promise<Exam[]>;
  createExam(input: { title: string; subject: string | null; date: string }): Promise<Exam>;
  updateExam(id: string, patch: ExamPatch): Promise<void>;
  deleteExam(id: string): Promise<void>;

  // study sessions
  getTodaySessions(): Promise<TodaySessions>;
  logSession(input: { durationSec: number; kind: "focus" | "break"; subject: string | null }): Promise<StudySession>;

  // stats
  getStats(): Promise<StatsData>;

  // spaced repetition
  listDecks(): Promise<DeckSummary[]>;
  getDeck(id: string): Promise<DeckFull | null>;
  createDeck(input: { name: string; subject: string | null; color?: string }): Promise<DeckSummary>;
  updateDeck(id: string, patch: DeckPatch): Promise<void>;
  deleteDeck(id: string): Promise<void>;
  createCard(input: { deckId: string; front: string; back: string; image?: string | null }): Promise<Card>;
  updateCard(id: string, patch: CardPatch): Promise<void>;
  deleteCard(id: string): Promise<void>;
  /** Due queue — oldest-due first, images included, max 30. */
  getDueCards(deckId?: string): Promise<Card[]>;
  /** Grade a card — SM-2 reschedule + review log. */
  submitReview(cardId: string, grade: Grade): Promise<void>;
  /** Bulk text import; returns created count. */
  importCards(deckId: string, rows: { front: string; back: string }[]): Promise<number>;
}
