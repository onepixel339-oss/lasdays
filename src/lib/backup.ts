// ═══════════════ Backup engine v3 — complete, versioned, validated ═══════════════
// Pure logic + Dexie access passed in as arguments (testable with fake-indexeddb).
// The backup contract:
//   • EVERYTHING the user created: profile, settings, tasks, notes, sprints,
//     sessions, exams, decks, cards (incl. images), review history.
//   • Record IDs and relationships preserved exactly (same IDs back in).
//   • Validated before import; invalid files are rejected without touching data.
//   • Merge = progress-safe union (never lose work on conflicts); Replace =
//     safety-backup-first full restore.
//   • Legacy v2 files (pre-local-first settings export) import through the
//     same pipeline after normalization.

import type {
  Card, Deck, Exam, Note, ReviewLog, Sprint, StudySession, Task,
} from "./datastore/types";
import { ldb, type LastDaysDB } from "./datastore/schema";

export const APP_VERSION = "4.1.0";
export const BACKUP_FORMAT = 3;
const MAX_BACKUP_BYTES = 120 * 1024 * 1024; // hard stop: 120 MB

/** Local application settings captured in the backup (device prefs, not data). */
export interface SettingsBackup {
  prefs?: Record<string, unknown>;      // ld2_prefs — lang / theme / accent
  focusSettings?: Record<string, unknown>; // ld2_focus_settings — pomodoro durations
  scratch?: string;                      // ld2_scratch — the scratchpad text
  ambienceVolume?: number;                // ld2_ambvol
  quranVolume?: number;                   // aur.quran.vol
}

export interface BackupData {
  tasks: Task[];
  notes: Note[];
  sprints: Sprint[];
  sessions: StudySession[];
  exams: Exam[];
  decks: Deck[];
  cards: Card[];
  reviewLogs: ReviewLog[];
}

export interface BackupProfile {
  username: string;
  isGuest: boolean;
  avatar: string;
  locale: string;
  themeMode: string;
  themeAccent: string;
  createdAt: string;
}

/** The v3 backup file — the single durable artifact users keep. */
export interface BackupFileV3 {
  app: "lastdays";
  format: 3;
  appVersion: string;
  exportedAt: string;
  profile: BackupProfile | null;
  settings: SettingsBackup;
  data: BackupData;
  counts: {
    tasks: number; notes: number; sprints: number; sessions: number;
    exams: number; decks: number; cards: number; reviewLogs: number;
    images: number; // cards carrying an image
  };
}

export type BackupPhase =
  | { phase: "read"; done: number; total: number }
  | { phase: "validate" }
  | { phase: "write"; done: number; total: number }
  | { phase: "done" };

export type BackupProgress = (p: BackupPhase) => void;

// ── restore report ──────────────────────────────────────────────────────────

export interface TableReport {
  added: number;      // new records inserted
  updated: number;    // same-id records whose content changed (resolved)
  conflicts: number;  // same-id records with differing content (resolved by rule)
  skipped: number;    // records not imported (orphans / invalid)
}

export interface RestoreReport {
  mode: "merge" | "replace";
  byTable: Record<string, TableReport>;
  added: number;
  updated: number;
  conflicts: number;
  skipped: number;
  warnings: string[];   // human-readable, localized at display time
  profile: "kept" | "adopted" | "kept-conflict";
  safetyBackup?: BackupFileV3; // replace mode: what was on the device before the wipe
}

const emptyTable = (): TableReport => ({ added: 0, updated: 0, conflicts: 0, skipped: 0 });

// ── export ──────────────────────────────────────────────────────────────────

function readSettings(): SettingsBackup {
  const out: SettingsBackup = {};
  if (typeof localStorage === "undefined") return out;
  try {
    const prefs = localStorage.getItem("ld2_prefs");
    if (prefs) out.prefs = JSON.parse(prefs) as Record<string, unknown>;
  } catch { /* corrupt prefs — skip */ }
  try {
    const fs = localStorage.getItem("ld2_focus_settings");
    if (fs) out.focusSettings = JSON.parse(fs) as Record<string, unknown>;
  } catch { /* skip */ }
  const scratch = localStorage.getItem("ld2_scratch");
  if (scratch) out.scratch = scratch;
  const amb = Number(localStorage.getItem("ld2_ambvol"));
  if (Number.isFinite(amb) && amb > 0) out.ambienceVolume = amb;
  const qv = Number(localStorage.getItem("aur.quran.vol"));
  if (Number.isFinite(qv) && qv > 0) out.quranVolume = qv;
  return out;
}

export function writeSettings(s: SettingsBackup, fillOnlyMissing: boolean): void {
  if (typeof localStorage === "undefined") return;
  // prefs
  if (s.prefs && typeof s.prefs === "object") {
    let cur: Record<string, unknown> = {};
    try { const raw = localStorage.getItem("ld2_prefs"); if (raw) cur = JSON.parse(raw); } catch { /* start fresh */ }
    localStorage.setItem("ld2_prefs", JSON.stringify(fillOnlyMissing ? { ...s.prefs, ...cur } : { ...cur, ...s.prefs }));
  }
  if (s.focusSettings && typeof s.focusSettings === "object") {
    let cur: Record<string, unknown> = {};
    try { const raw = localStorage.getItem("ld2_focus_settings"); if (raw) cur = JSON.parse(raw); } catch { /* fresh */ }
    localStorage.setItem("ld2_focus_settings", JSON.stringify(fillOnlyMissing ? { ...s.focusSettings, ...cur } : { ...cur, ...s.focusSettings }));
  }
  if (typeof s.scratch === "string" && (!fillOnlyMissing || !localStorage.getItem("ld2_scratch"))) {
    localStorage.setItem("ld2_scratch", s.scratch);
  }
  if (typeof s.ambienceVolume === "number" && (!fillOnlyMissing || !localStorage.getItem("ld2_ambvol"))) {
    localStorage.setItem("ld2_ambvol", String(s.ambienceVolume));
  }
  if (typeof s.quranVolume === "number" && (!fillOnlyMissing || !localStorage.getItem("aur.quran.vol"))) {
    localStorage.setItem("aur.quran.vol", String(s.quranVolume));
  }
}

/** Build a complete v3 backup from the local database. */
export async function exportBackup(
  db: LastDaysDB = ldb(),
  onProgress?: BackupProgress
): Promise<BackupFileV3> {
  const tables = [db.tasks, db.notes, db.sprints, db.sessions, db.exams, db.decks, db.cards, db.reviewLogs] as const;
  const total = tables.length;
  let done = 0;
  const [tasks, notes, sprints, sessions, exams, decks, cards, reviewLogs] = (await Promise.all(
    tables.map((t) =>
      t.toArray().then((rows) => {
        done += 1;
        onProgress?.({ phase: "read", done, total });
        return rows as unknown[];
      })
    )
  )) as unknown as [Task[], Note[], Sprint[], StudySession[], Exam[], Deck[], Card[], ReviewLog[]];
  const profileRow = await db.profile.get(1);

  const file: BackupFileV3 = {
    app: "lastdays",
    format: BACKUP_FORMAT,
    appVersion: APP_VERSION,
    exportedAt: new Date().toISOString(),
    profile: profileRow
      ? {
        username: profileRow.username,
        isGuest: profileRow.isGuest,
        avatar: profileRow.avatar,
        locale: profileRow.locale,
        themeMode: profileRow.themeMode,
        themeAccent: profileRow.themeAccent,
        createdAt: profileRow.createdAt,
      }
      : null,
    settings: readSettings(),
    data: { tasks, notes, sprints, sessions, exams, decks, cards, reviewLogs },
    counts: {
      tasks: tasks.length,
      notes: notes.length,
      sprints: sprints.length,
      sessions: sessions.length,
      exams: exams.length,
      decks: decks.length,
      cards: cards.length,
      reviewLogs: reviewLogs.length,
      images: cards.filter((c) => typeof c.image === "string" && c.image.startsWith("data:image/")).length,
    },
  };
  onProgress?.({ phase: "done" });
  return file;
}

// ── validation ───────────────────────────────────────────────────────────────

export interface ValidationResult {
  ok: boolean;
  /** v2 files are normalized into v3 before import; this flags that. */
  legacy: boolean;
  file?: BackupFileV3;
  errors: string[];
  warnings: string[];
}

const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function isStr(v: unknown): v is string {
  return typeof v === "string";
}
/** non-empty string or null */
function strOrNull(v: unknown): boolean {
  return v == null || isStr(v);
}

function validateTask(t: unknown, errs: string[]): t is Task {
  if (!isObj(t) || !isStr(t.id) || !isStr(t.title) || typeof t.done !== "boolean") {
    errs.push("task: bad shape"); return false;
  }
  if (!isStr(t.createdAt) || !ISO_RE.test(t.createdAt)) { errs.push(`task ${t.id}: bad createdAt`); return false; }
  if (!strOrNull(t.subject) || !strOrNull(t.dueDate) || !strOrNull(t.doneAt)) { errs.push(`task ${t.id}: bad field`); return false; }
  if (t.dueDate != null && !DATE_RE.test(t.dueDate as string)) { errs.push(`task ${t.id}: bad dueDate`); return false; }
  return true;
}

function validateNote(n: unknown, errs: string[]): n is Note {
  if (!isObj(n) || !isStr(n.id) || !isStr(n.title) || !isStr(n.content) || typeof n.pinned !== "boolean") {
    errs.push("note: bad shape"); return false;
  }
  if (!ISO_RE.test(n.createdAt as string) || !ISO_RE.test(n.updatedAt as string)) { errs.push(`note ${n.id}: bad dates`); return false; }
  return true;
}

function validateSprint(s: unknown, errs: string[]): s is Sprint {
  if (!isObj(s) || !isStr(s.id) || !isStr(s.name) || typeof s.totalPages !== "number" || typeof s.donePages !== "number" || typeof s.active !== "boolean") {
    errs.push("sprint: bad shape"); return false;
  }
  if (!DATE_RE.test(String(s.startDate)) || !DATE_RE.test(String(s.endDate))) { errs.push(`sprint ${s.id}: bad dates`); return false; }
  return true;
}

function validateSession(s: unknown, errs: string[]): s is StudySession {
  if (!isObj(s) || !isStr(s.id) || !isStr(s.startedAt) || !ISO_RE.test(s.startedAt as string) || typeof s.durationSec !== "number") {
    errs.push("session: bad shape"); return false;
  }
  if (s.kind !== "focus" && s.kind !== "break") { errs.push(`session ${s.id}: bad kind`); return false; }
  return true;
}

function validateExam(e: unknown, errs: string[]): e is Exam {
  if (!isObj(e) || !isStr(e.id) || !isStr(e.title) || !DATE_RE.test(String(e.date))) {
    errs.push("exam: bad shape"); return false;
  }
  return true;
}

function validateDeck(d: unknown, errs: string[]): d is Deck {
  if (!isObj(d) || !isStr(d.id) || !isStr(d.name) || !isStr(d.color)) {
    errs.push("deck: bad shape"); return false;
  }
  return true;
}

function validateCard(c: unknown, errs: string[]): c is Card {
  if (!isObj(c) || !isStr(c.id) || !isStr(c.deckId) || !isStr(c.front) || !isStr(c.back)) {
    errs.push("card: bad shape"); return false;
  }
  for (const k of ["ease", "intervalDays", "reps", "lapses"] as const) {
    if (typeof c[k] !== "number" || !Number.isFinite(c[k] as number)) { errs.push(`card ${c.id}: bad ${k}`); return false; }
  }
  if (!isStr(c.dueAt) || !ISO_RE.test(c.dueAt as string)) { errs.push(`card ${c.id}: bad dueAt`); return false; }
  if (c.image != null && !(isStr(c.image) && c.image.startsWith("data:image/"))) {
    errs.push(`card ${c.id}: image is not a data URL`); return false;
  }
  return true;
}

function validateReviewLog(r: unknown, errs: string[]): r is ReviewLog {
  if (!isObj(r) || !isStr(r.id) || !isStr(r.cardId) || !isStr(r.reviewedAt) || !ISO_RE.test(r.reviewedAt as string)) {
    errs.push("reviewLog: bad shape"); return false;
  }
  if (!["again", "hard", "good", "easy"].includes(String(r.rating))) { errs.push(`reviewLog ${r.id}: bad rating`); return false; }
  return true;
}

function uniqueIds(rows: { id: string }[], label: string, errs: string[]): void {
  const seen = new Set<string>();
  for (const r of rows) {
    if (seen.has(r.id)) errs.push(`${label}: duplicate id ${r.id}`);
    seen.add(r.id);
  }
}

/** Validate + normalize any backup JSON (v3 or legacy v2). Never mutates the DB. */
export function validateBackupFile(raw: string | unknown): ValidationResult {
  const errs: string[] = [];
  const warns: string[] = [];
  if (typeof raw === "string" && raw.length > MAX_BACKUP_BYTES) {
    return { ok: false, legacy: false, errors: ["file too large"], warnings: warns };
  }
  let json: unknown;
  try {
    json = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch {
    return { ok: false, legacy: false, errors: ["not valid JSON"], warnings: warns };
  }
  if (!isObj(json) || json.app !== "lastdays") {
    return { ok: false, legacy: false, errors: ["not a Last Days backup (missing app marker)"], warnings: warns };
  }

  // ── legacy v2 → normalize ──
  if (json.schema === 2) {
    const norm = normalizeV2(json);
    if (norm.errors.length) return { ok: false, legacy: true, errors: norm.errors, warnings: warns };
    const res = validateBackupFile(norm.file);
    return { ...res, legacy: true, warnings: [...warns, ...res.warnings] };
  }

  if (json.format !== 3) {
    return { ok: false, legacy: false, errors: [`unsupported format: ${String(json.format)}`], warnings: warns };
  }

  // data section
  const d = json.data;
  if (!isObj(d)) return { ok: false, legacy: false, errors: ["missing data section"], warnings: warns };
  const arrays: Record<string, unknown[]> = {};
  for (const key of ["tasks", "notes", "sprints", "sessions", "exams", "decks", "cards", "reviewLogs"] as const) {
    const v = (d as Record<string, unknown>)[key];
    if (!Array.isArray(v)) return { ok: false, legacy: false, errors: [`data.${key} is not an array`], warnings: warns };
    arrays[key] = v;
  }

  // per-record validation
  const tasks = arrays.tasks!.filter((x) => validateTask(x, errs));
  const notes = arrays.notes!.filter((x) => validateNote(x, errs));
  const sprints = arrays.sprints!.filter((x) => validateSprint(x, errs));
  const sessions = arrays.sessions!.filter((x) => validateSession(x, errs));
  const exams = arrays.exams!.filter((x) => validateExam(x, errs));
  const decks = arrays.decks!.filter((x) => validateDeck(x, errs));
  const cards = arrays.cards!.filter((x) => validateCard(x, errs));
  const reviewLogs = arrays.reviewLogs!.filter((x) => validateReviewLog(x, errs));

  const dropped =
    arrays.tasks!.length - tasks.length + arrays.notes!.length - notes.length +
    arrays.sprints!.length - sprints.length + arrays.sessions!.length - sessions.length +
    arrays.exams!.length - exams.length + arrays.decks!.length - decks.length +
    arrays.cards!.length - cards.length + arrays.reviewLogs!.length - reviewLogs.length;
  if (dropped > 0) errs.push(`${dropped} record(s) failed field validation`);

  // duplicate ids = corrupt file
  uniqueIds(tasks, "tasks", errs);
  uniqueIds(notes, "notes", errs);
  uniqueIds(sprints, "sprints", errs);
  uniqueIds(sessions, "sessions", errs);
  uniqueIds(exams, "exams", errs);
  uniqueIds(decks, "decks", errs);
  uniqueIds(cards, "cards", errs);
  if (errs.length) return { ok: false, legacy: false, errors: errs, warnings: warns };

  // referential integrity (warning-level — importers handle gracefully)
  const deckIds = new Set(decks.map((x) => x.id));
  const orphanCards = cards.filter((c) => !deckIds.has(c.deckId));
  if (orphanCards.length) warns.push(`cards: ${orphanCards.length} reference a missing deck (skipped on import)`);
  const cardIds = new Set(cards.map((c) => c.id));
  const orphanLogs = reviewLogs.filter((r) => !cardIds.has(r.cardId));
  if (orphanLogs.length) warns.push(`reviewLogs: ${orphanLogs.length} reference unknown cards (imported as history)`);

  // counts cross-check (informational only — must never reject a valid-but-odd file)
  if (isObj(json.counts)) {
    const c = json.counts as Record<string, unknown>;
    const expect: Record<string, number> = {
      tasks: tasks.length, notes: notes.length, sprints: sprints.length,
      sessions: sessions.length, exams: exams.length, decks: decks.length,
      cards: cards.length, reviewLogs: reviewLogs.length,
      images: cards.filter((x) => typeof x.image === "string").length,
    };
    for (const [k, n] of Object.entries(expect)) {
      if (typeof c[k] === "number" && c[k] !== n) warns.push(`counts.${k} says ${c[k]}, actual ${n}`);
    }
  }

  // profile (optional)
  let profile: BackupProfile | null = null;
  if (json.profile != null) {
    const p = json.profile as Record<string, unknown>;
    if (isStr(p.username) && isStr(p.avatar) && isStr(p.locale) && isStr(p.themeMode) && isStr(p.themeAccent) && typeof p.isGuest === "boolean") {
      profile = {
        username: p.username, isGuest: p.isGuest, avatar: p.avatar, locale: p.locale,
        themeMode: p.themeMode, themeAccent: p.themeAccent,
        createdAt: isStr(p.createdAt) ? p.createdAt : new Date(0).toISOString(),
      };
    } else {
      warns.push("profile: invalid — ignored");
    }
  }

  // settings (optional; tolerant)
  const settings: SettingsBackup = {};
  if (isObj(json.settings)) {
    const s = json.settings as Record<string, unknown>;
    if (isObj(s.prefs)) settings.prefs = s.prefs as Record<string, unknown>;
    if (isObj(s.focusSettings)) settings.focusSettings = s.focusSettings as Record<string, unknown>;
    if (isStr(s.scratch)) settings.scratch = s.scratch;
    if (typeof s.ambienceVolume === "number") settings.ambienceVolume = s.ambienceVolume;
    if (typeof s.quranVolume === "number") settings.quranVolume = s.quranVolume;
  }

  return {
    ok: true,
    legacy: false,
    file: {
      app: "lastdays",
      format: 3,
      appVersion: isStr(json.appVersion) ? json.appVersion : "unknown",
      exportedAt: isStr(json.exportedAt) ? json.exportedAt : new Date(0).toISOString(),
      profile,
      settings,
      data: { tasks, notes, sprints, sessions, exams, decks, cards, reviewLogs },
      counts: {
        tasks: tasks.length, notes: notes.length, sprints: sprints.length, sessions: sessions.length,
        exams: exams.length, decks: decks.length, cards: cards.length, reviewLogs: reviewLogs.length,
        images: cards.filter((c) => typeof c.image === "string").length,
      },
    },
    errors: errs,
    warnings: warns,
  };
}

/** Legacy v2 files: { app, schema:2, tasks:{tasks}, notes:{notes}, sprints:{sprints}, decks:{decks}|[...], exams:{exams} } */
function normalizeV2(json: Record<string, unknown>): { file?: BackupFileV3; errors: string[] } {
  const errors: string[] = [];
  const now = new Date().toISOString();
  const rid = (): string =>
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `id_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  const get = (k: string): unknown[] => {
    const v = json[k];
    if (isObj(v) && Array.isArray(v[k])) return v[k] as unknown[];   // wrapped: { tasks: { tasks: [...] } }
    if (Array.isArray(v)) return v;                                    // plain array
    return [];
  };
  // v2 records could miss ids/defaults (hand-made or stripped exports) —
  // fill them so the pipeline keeps the old importer's create-fresh semantics
  // while records that DO carry ids keep them (relationship preservation).
  const fillTask = (t: unknown): Task => {
    const x = isObj(t) ? t : {};
    return {
      id: isStr(x.id) ? x.id : rid(),
      title: isStr(x.title) ? x.title : "",
      subject: strOrNull(x.subject) ? (x.subject as string | null) : null,
      priority: ["low", "normal", "high"].includes(String(x.priority)) ? (x.priority as Task["priority"]) : "normal",
      done: x.done === true,
      dueDate: isStr(x.dueDate) && DATE_RE.test(x.dueDate) ? x.dueDate : null,
      createdAt: isStr(x.createdAt) ? x.createdAt : now,
      doneAt: isStr(x.doneAt) && ISO_RE.test(x.doneAt) ? x.doneAt : null,
    };
  };
  const fillNote = (n: unknown): Note => {
    const x = isObj(n) ? n : {};
    return {
      id: isStr(x.id) ? x.id : rid(),
      title: isStr(x.title) ? x.title : "…",
      content: isStr(x.content) ? x.content : "",
      subject: isStr(x.subject) ? x.subject : null,
      pinned: x.pinned === true,
      createdAt: isStr(x.createdAt) ? x.createdAt : now,
      updatedAt: isStr(x.updatedAt) ? x.updatedAt : now,
    };
  };
  const fillSprint = (s: unknown): Sprint => {
    const x = isObj(s) ? s : {};
    return {
      id: isStr(x.id) ? x.id : rid(),
      name: isStr(x.name) ? x.name : "",
      subject: isStr(x.subject) ? x.subject : null,
      totalPages: typeof x.totalPages === "number" ? x.totalPages : 1,
      donePages: typeof x.donePages === "number" ? x.donePages : 0,
      startDate: isStr(x.startDate) && DATE_RE.test(x.startDate) ? x.startDate : now.slice(0, 10),
      endDate: isStr(x.endDate) && DATE_RE.test(x.endDate) ? x.endDate : now.slice(0, 10),
      active: x.active === true,
      createdAt: isStr(x.createdAt) ? x.createdAt : now,
    };
  };
  const fillExam = (e: unknown): Exam => {
    const x = isObj(e) ? e : {};
    return {
      id: isStr(x.id) ? x.id : rid(),
      title: isStr(x.title) ? x.title : "",
      subject: isStr(x.subject) ? x.subject : null,
      date: isStr(x.date) && DATE_RE.test(x.date) ? x.date : now.slice(0, 10),
      createdAt: isStr(x.createdAt) ? x.createdAt : now,
    };
  };
  const fillCard = (deckId: string) => (c: unknown): Card => {
    const x = isObj(c) ? c : {};
    return {
      id: isStr(x.id) ? x.id : rid(),
      deckId, // re-attach to the normalized deck (relationship preserved)
      front: isStr(x.front) ? x.front : "",
      back: isStr(x.back) ? x.back : "",
      image: isStr(x.image) && x.image.startsWith("data:image/") ? x.image : null,
      ease: typeof x.ease === "number" && Number.isFinite(x.ease) ? x.ease : 2.5,
      intervalDays: typeof x.intervalDays === "number" && Number.isFinite(x.intervalDays) ? x.intervalDays : 0,
      dueAt: isStr(x.dueAt) && ISO_RE.test(x.dueAt) ? x.dueAt : now,
      reps: typeof x.reps === "number" && Number.isFinite(x.reps) ? x.reps : 0,
      lapses: typeof x.lapses === "number" && Number.isFinite(x.lapses) ? x.lapses : 0,
      createdAt: isStr(x.createdAt) ? x.createdAt : now,
    };
  };
  const rawDecks = get("decks").filter(isObj);
  const decks: Deck[] = rawDecks.map((d) => ({
    id: isStr(d.id) ? d.id : rid(),
    name: isStr(d.name) ? d.name : "",
    subject: isStr(d.subject) ? d.subject : null,
    color: isStr(d.color) && /^#[0-9a-fA-F]{6}$/.test(d.color) ? d.color : "#B85C38",
    createdAt: isStr(d.createdAt) ? d.createdAt : now,
  }));
  const cards: Card[] = rawDecks.flatMap((d, i) => {
    const deckId = decks[i]!.id;
    return Array.isArray(d.cards) ? (d.cards as unknown[]).map(fillCard(deckId)) : [];
  });

  const file: BackupFileV3 = {
    app: "lastdays",
    format: 3,
    appVersion: "2.x (legacy)",
    exportedAt: isStr(json.exportedAt) ? (json.exportedAt as string) : new Date(0).toISOString(),
    profile: null,
    settings: {},
    data: {
      tasks: get("tasks").map(fillTask),
      notes: get("notes").map(fillNote),
      sprints: get("sprints").map(fillSprint),
      sessions: [],
      exams: get("exams").map(fillExam),
      decks,
      cards,
      reviewLogs: [],
    },
    counts: { tasks: 0, notes: 0, sprints: 0, sessions: 0, exams: 0, decks: 0, cards: 0, reviewLogs: 0, images: 0 },
  };
  const c = file.counts;
  c.tasks = file.data.tasks.length; c.notes = file.data.notes.length; c.sprints = file.data.sprints.length;
  c.exams = file.data.exams.length; c.decks = file.data.decks.length; c.cards = file.data.cards.length;
  c.images = file.data.cards.filter((x) => typeof x.image === "string").length;
  return { file, errors };
}

// ── merge — progress-safe union ─────────────────────────────────────────────

/** Later-modified record for text fields; completion unions never regress. */
function mergeTasks(local: Task[], inc: Task[]): { put: Task[]; report: TableReport } {
  const report = emptyTable();
  const map = new Map(local.map((t) => [t.id, { ...t }]));
  for (const t of inc) {
    const cur = map.get(t.id);
    if (!cur) { map.set(t.id, { ...t }); report.added++; continue; }
    const differs =
      cur.title !== t.title || cur.subject !== t.subject || cur.priority !== t.priority ||
      cur.dueDate !== t.dueDate || cur.done !== t.done || cur.doneAt !== t.doneAt;
    if (!differs) continue;
    // completion is never lost — a task done on any device stays done
    const done = cur.done || t.done;
    const doneAt = done ? (cur.doneAt ?? t.doneAt ?? null) : null;
    const winner = (cur.doneAt ?? cur.createdAt) >= (t.doneAt ?? t.createdAt) ? cur : t;
    map.set(t.id, { ...winner, done, doneAt });
    report.updated++; report.conflicts++;
  }
  return { put: [...map.values()], report };
}

function mergeNotes(local: Note[], inc: Note[]): { put: Note[]; report: TableReport } {
  const report = emptyTable();
  const map = new Map(local.map((n) => [n.id, { ...n }]));
  for (const n of inc) {
    const cur = map.get(n.id);
    if (!cur) { map.set(n.id, { ...n }); report.added++; continue; }
    const differs = cur.title !== n.title || cur.content !== n.content || cur.subject !== n.subject || cur.pinned !== n.pinned;
    if (!differs) continue;
    // real updatedAt field — newest content wins
    map.set(n.id, n.updatedAt >= cur.updatedAt ? { ...n } : cur);
    report.updated++; report.conflicts++;
  }
  return { put: [...map.values()], report };
}

function mergeSprints(local: Sprint[], inc: Sprint[]): { put: Sprint[]; report: TableReport } {
  const report = emptyTable();
  const map = new Map(local.map((s) => [s.id, { ...s }]));
  for (const s of inc) {
    const cur = map.get(s.id);
    if (!cur) { map.set(s.id, { ...s }); report.added++; continue; }
    const differs =
      cur.name !== s.name || cur.subject !== s.subject || cur.totalPages !== s.totalPages ||
      cur.donePages !== s.donePages || cur.startDate !== s.startDate || cur.endDate !== s.endDate || cur.active !== s.active;
    if (!differs) continue;
    // reading progress never regresses; other fields: incoming wins (newer export)
    const merged: Sprint = { ...s, donePages: Math.max(cur.donePages, s.donePages), active: cur.active || s.active };
    map.set(s.id, merged);
    report.updated++; report.conflicts++;
  }
  // normalize: at most one active sprint — the newest created wins
  const active = [...map.values()].filter((s) => s.active).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  for (const s of active.slice(1)) map.set(s.id, { ...s, active: false });
  return { put: [...map.values()], report };
}

function mergeExams(local: Exam[], inc: Exam[]): { put: Exam[]; report: TableReport } {
  const report = emptyTable();
  const map = new Map(local.map((e) => [e.id, { ...e }]));
  for (const e of inc) {
    const cur = map.get(e.id);
    if (!cur) { map.set(e.id, { ...e }); report.added++; continue; }
    const differs = cur.title !== e.title || cur.subject !== e.subject || cur.date !== e.date;
    if (!differs) continue;
    map.set(e.id, { ...e }); // incoming wins (edits from the exporting device)
    report.updated++; report.conflicts++;
  }
  return { put: [...map.values()], report };
}

function mergeDecks(local: Deck[], inc: Deck[]): { put: Deck[]; report: TableReport } {
  const report = emptyTable();
  const map = new Map(local.map((d) => [d.id, { ...d }]));
  for (const d of inc) {
    const cur = map.get(d.id);
    if (!cur) { map.set(d.id, { ...d }); report.added++; continue; }
    const differs = cur.name !== d.name || cur.subject !== d.subject || cur.color !== d.color;
    if (!differs) continue;
    map.set(d.id, { ...d });
    report.updated++; report.conflicts++;
  }
  return { put: [...map.values()], report };
}

function mergeCards(local: Card[], inc: Card[]): { put: Card[]; report: TableReport } {
  const report = emptyTable();
  const map = new Map(local.map((c) => [c.id, { ...c }]));
  for (const c of inc) {
    const cur = map.get(c.id);
    if (!cur) { map.set(c.id, { ...c }); report.added++; continue; }
    const differs =
      cur.front !== c.front || cur.back !== c.back || cur.image !== c.image ||
      cur.ease !== c.ease || cur.intervalDays !== c.intervalDays || cur.reps !== c.reps ||
      cur.lapses !== c.lapses || cur.dueAt !== c.dueAt;
    if (!differs) continue;
    // SRS state is atomic: the record with more reviews is the learned one
    const winner = c.reps !== cur.reps ? (c.reps > cur.reps ? c : cur) : (c.createdAt >= cur.createdAt ? c : cur);
    map.set(c.id, { ...winner });
    report.updated++; report.conflicts++;
  }
  return { put: [...map.values()], report };
}

function mergeById<T extends { id: string }>(local: T[], inc: T[]): { put: T[]; report: TableReport } {
  const report = emptyTable();
  const map = new Map(local.map((x) => [x.id, x]));
  for (const x of inc) {
    if (map.has(x.id)) continue; // append-only history: existing = identical semantics
    map.set(x.id, x);
    report.added++;
  }
  return { put: [...map.values()], report };
}

// ── import ──────────────────────────────────────────────────────────────────

/**
 * Import a validated backup.
 *  • merge   — progress-safe union; nothing is deleted.
 *  • replace — wipes user tables after taking an in-memory safety backup
 *              (returned in the report; the UI must persist it BEFORE calling,
 *              and the engine aborts if the safety snapshot cannot be taken).
 */
export async function importBackup(
  file: BackupFileV3,
  mode: "merge" | "replace",
  db: LastDaysDB = ldb(),
  onProgress?: BackupProgress
): Promise<RestoreReport> {
  onProgress?.({ phase: "validate" });
  const warnings: string[] = [];
  const byTable: Record<string, TableReport> = {};
  const report: RestoreReport = {
    mode, byTable, added: 0, updated: 0, conflicts: 0, skipped: 0, warnings, profile: "kept",
  };

  const d = file.data;

  if (mode === "replace") {
    // safety snapshot of the CURRENT device — taken before any destructive step
    report.safetyBackup = await exportBackup(db);
  }

  // read local state (for merge planning)
  const [lTasks, lNotes, lSprints, lSessions, lExams, lDecks, lCards, lLogs] = mode === "merge"
    ? await Promise.all([
        db.tasks.toArray(), db.notes.toArray(), db.sprints.toArray(), db.sessions.toArray(),
        db.exams.toArray(), db.decks.toArray(), db.cards.toArray(), db.reviewLogs.toArray(),
      ])
    : [[], [], [], [], [], [], [], []];

  // orphan cards (deck referenced neither in the file nor on the device) — skipped
  const deckIds = new Set([...d.decks.map((x) => x.id), ...lDecks.map((x) => x.id)]);
  const orphanCards = d.cards.filter((c) => !deckIds.has(c.deckId));
  if (orphanCards.length) warnings.push(`cards: ${orphanCards.length} skipped (deck not found)`);
  const cards = d.cards.filter((c) => deckIds.has(c.deckId));

  const plans = mode === "merge"
    ? {
      tasks: mergeTasks(lTasks, d.tasks),
      notes: mergeNotes(lNotes, d.notes),
      sprints: mergeSprints(lSprints, d.sprints),
      sessions: mergeById(lSessions, d.sessions),
      exams: mergeExams(lExams, d.exams),
      decks: mergeDecks(lDecks, d.decks),
      cards: mergeCards(lCards, cards),
      reviewLogs: mergeById(lLogs, d.reviewLogs),
    }
    : {
      tasks: { put: d.tasks, report: { ...emptyTable(), added: d.tasks.length } },
      notes: { put: d.notes, report: { ...emptyTable(), added: d.notes.length } },
      sprints: { put: d.sprints, report: { ...emptyTable(), added: d.sprints.length } },
      sessions: { put: d.sessions, report: { ...emptyTable(), added: d.sessions.length } },
      exams: { put: d.exams, report: { ...emptyTable(), added: d.exams.length } },
      decks: { put: d.decks, report: { ...emptyTable(), added: d.decks.length } },
      cards: { put: cards, report: { ...emptyTable(), added: cards.length, skipped: orphanCards.length } },
      reviewLogs: { put: d.reviewLogs, report: { ...emptyTable(), added: d.reviewLogs.length } },
    };

  for (const [name, p] of Object.entries(plans)) {
    byTable[name] = p.report;
    report.added += p.report.added;
    report.updated += p.report.updated;
    report.conflicts += p.report.conflicts;
    report.skipped += p.report.skipped;
  }
  // merge mode: skipped = orphan cards filtered out above
  if (mode === "merge" && byTable.cards) {
    byTable.cards.skipped = orphanCards.length;
    report.skipped += orphanCards.length;
  }

  // ── write ──
  if (mode === "replace") {
    // user data tables only — kv (store flags) and versioning metadata survive
    await Promise.all([
      db.tasks.clear(), db.notes.clear(), db.sprints.clear(), db.sessions.clear(),
      db.exams.clear(), db.decks.clear(), db.cards.clear(), db.reviewLogs.clear(),
    ]);
  }
  const writes: [string, unknown[]][] = [
    ["tasks", plans.tasks.put], ["notes", plans.notes.put], ["sprints", plans.sprints.put],
    ["sessions", plans.sessions.put], ["exams", plans.exams.put], ["decks", plans.decks.put],
    ["cards", plans.cards.put], ["reviewLogs", plans.reviewLogs.put],
  ];
  const totalRows = writes.reduce((n, [, rows]) => n + (rows as unknown[]).length, 0);
  let written = 0;
  for (const [name, rows] of writes) {
    if ((rows as unknown[]).length) await (db as unknown as Record<string, { bulkPut(r: unknown[]): Promise<void> }>)[name]!.bulkPut(rows);
    written += (rows as unknown[]).length;
    onProgress?.({ phase: "write", done: written, total: totalRows });
  }

  // ── profile ──
  if (mode === "replace") {
    if (file.profile) {
      await db.profile.put({
        id: 1, username: file.profile.username, isGuest: file.profile.isGuest,
        avatar: file.profile.avatar, locale: file.profile.locale,
        themeMode: file.profile.themeMode, themeAccent: file.profile.themeAccent,
        createdAt: file.profile.createdAt,
      });
      await db.kv.delete("signedOut"); // restored profile is signed in
      report.profile = "adopted";
    }
    writeSettings(file.settings, false);
  } else {
    const cur = await db.profile.get(1);
    if (!cur && file.profile) {
      await db.profile.put({
        id: 1, username: file.profile.username, isGuest: file.profile.isGuest,
        avatar: file.profile.avatar, locale: file.profile.locale,
        themeMode: file.profile.themeMode, themeAccent: file.profile.themeAccent,
        createdAt: file.profile.createdAt,
      });
      report.profile = "adopted";
    } else if (cur && file.profile && file.profile.username !== cur.username) {
      report.profile = "kept-conflict";
    }
    writeSettings(file.settings, true); // fill missing prefs only
  }

  onProgress?.({ phase: "done" });
  return report;
}

/** Serialize a backup to a pretty JSON string (stable key order). */
export function backupToString(file: BackupFileV3): string {
  return JSON.stringify(file, null, 2);
}

/** Suggested download filename for a backup. */
export function backupFileName(prefix = "backup"): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `last-days-${prefix}-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}.json`;
}
