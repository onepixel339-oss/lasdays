"use client";

import React, { useCallback, useEffect, useState } from "react";
import { useApp } from "@/components/providers";
import { getStore } from "@/lib/datastore";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, Pin, PinOff, Pencil, Trash2, BookOpen, Search, X, NotebookPen } from "lucide-react";

// ═══════════════ Notes — صفحة الدفتر · دفتر آخر النهار ═══════════════
// Search and "New note" come first. The editor gets real space (one panel for
// create + edit, with clear saving states). Notes render as a scannable list
// with hairlines — no grids of empty placeholder cards.

interface NoteRow {
  id: string;
  title: string;
  content: string;
  subject: string | null;
  pinned: boolean;
  updatedAt?: string;
}

type Draft = { id: string | null; title: string; content: string; subject: string };

const EMPTY_DRAFT: Draft = { id: null, title: "", content: "", subject: "" };

export default function NotesPage() {
  const { t, dir, lang } = useApp();
  const [notes, setNotes] = useState<NoteRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [q, setQ] = useState("");
  const [editorOpen, setEditorOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const rows = await getStore().listNotes().catch(() => []);
    setNotes(rows);
    setLoaded(true);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function openNew() {
    setDraft(EMPTY_DRAFT);
    setEditorOpen(true);
  }

  function openEdit(n: NoteRow) {
    setDraft({ id: n.id, title: n.title, content: n.content, subject: n.subject ?? "" });
    setEditorOpen(true);
  }

  function closeEditor() {
    setEditorOpen(false);
    setDraft(EMPTY_DRAFT);
  }

  async function save() {
    if (!draft.title.trim() && !draft.content.trim()) return;
    setSaving(true);
    try {
      if (draft.id) {
        await getStore().updateNote(draft.id, {
          title: draft.title.trim() || "…",
          content: draft.content,
          subject: draft.subject.trim() || null,
        });
      } else {
        await getStore().createNote({
          title: draft.title.trim() || "…",
          content: draft.content,
          subject: draft.subject.trim() || null,
        });
      }
      closeEditor();
      await load();
    } catch {
      /* keep the editor open — the draft is not lost */
    } finally {
      setSaving(false);
    }
  }

  async function patch(id: string, body: object) {
    await getStore().updateNote(id, body).catch(() => null);
    load();
  }

  async function del(id: string) {
    if (!confirm(t("notes.deleteConfirm"))) return;
    if (editorOpen && draft.id === id) closeEditor();
    setNotes((ns) => ns.filter((n) => n.id !== id));
    getStore().deleteNote(id).catch(() => null);
  }

  // search: title / content / subject — client-side, notes are fully loaded
  const needle = q.trim().toLowerCase();
  const match = (n: NoteRow) =>
    !needle ||
    n.title.toLowerCase().includes(needle) ||
    n.content.toLowerCase().includes(needle) ||
    (n.subject ?? "").toLowerCase().includes(needle);
  const pinned = notes.filter((n) => n.pinned && match(n));
  const others = notes.filter((n) => !n.pinned && match(n));

  return (
    <div className="space-y-5" dir={dir}>
      <div className="flex items-center justify-between gap-2">
        <h1 className="font-display text-2xl font-bold">{t("notes.title")}</h1>
        {!editorOpen && (
          <Button onClick={openNew} className="h-11 gap-1.5 rounded-lg px-4 font-bold">
            <Plus className="size-4" /> {t("notes.add")}
          </Button>
        )}
      </div>

      {/* ── editor — real space, one panel for create + edit ── */}
      {editorOpen && (
        <section className="card-soft row-in p-5" role="form" aria-label={draft.id ? t("notes.editTitle") : t("notes.add")}>
          <div className="flex items-center justify-between gap-2">
            <h2 className="flex items-center gap-1.5 font-display text-base font-bold">
              <NotebookPen className="size-4 text-primary" />
              {draft.id ? t("notes.editTitle") : t("notes.add")}
            </h2>
            <button
              onClick={closeEditor}
              className="grid size-10 place-items-center rounded-lg text-muted-foreground hover:bg-accent tap"
              aria-label={t("common.close")}
            >
              <X className="size-4" />
            </button>
          </div>
          <Input
            value={draft.title}
            onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            placeholder={t("notes.titlePlaceholder")}
            className="mt-3 h-12 border-0 bg-transparent px-0 text-lg font-bold shadow-none focus-visible:ring-0"
            aria-label={t("notes.titlePlaceholder")}
            autoFocus
          />
          <textarea
            value={draft.content}
            onChange={(e) => setDraft({ ...draft, content: e.target.value })}
            placeholder={t("notes.contentPlaceholder")}
            className="mt-2 min-h-52 w-full resize-y rounded-lg border border-input bg-background p-3.5 text-[15px] leading-relaxed outline-none focus:bg-card"
            aria-label={t("notes.contentPlaceholder")}
          />
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Input
              value={draft.subject}
              onChange={(e) => setDraft({ ...draft, subject: e.target.value })}
              placeholder={`${t("notes.subject")} (${t("common.optional")})`}
              className="h-11 flex-1 bg-background text-sm"
              aria-label={t("notes.subject")}
            />
            <Button onClick={save} disabled={saving || (!draft.title.trim() && !draft.content.trim())} className="h-11 gap-1.5 px-5 font-bold">
              {saving ? t("common.loading") : t("common.save")}
            </Button>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">{t("notes.editorHint")}</p>
        </section>
      )}

      {/* ── search ── */}
      {notes.length > 0 && (
        <div className="relative">
          <Search className="absolute top-1/2 start-3.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t("common.search")}
            className="h-11 rounded-lg bg-card ps-10"
            aria-label={t("common.search")}
          />
        </div>
      )}

      {/* ── pinned ── */}
      {pinned.length > 0 && (
        <>
          <h2 className="flex items-center gap-1.5 text-sm font-bold text-muted-foreground">
            <Pin className="size-3.5" /> {t("notes.pinned")}
          </h2>
          <div className="card-soft overflow-hidden">
            {pinned.map((n, i) => (
              <NoteRowEl key={n.id} n={n} t={t} first={i === 0} lang={lang}
                onEdit={() => openEdit(n)}
                onPin={() => patch(n.id, { pinned: false })}
                onDel={() => del(n.id)} />
            ))}
          </div>
        </>
      )}

      {/* ── others ── */}
      {others.length > 0 && (
        <>
          {pinned.length > 0 && (
            <h2 className="text-sm font-bold text-muted-foreground">{t("notes.others")}</h2>
          )}
          <div className="card-soft overflow-hidden">
            {others.map((n, i) => (
              <NoteRowEl key={n.id} n={n} t={t} first={i === 0} lang={lang}
                onEdit={() => openEdit(n)}
                onPin={() => patch(n.id, { pinned: true })}
                onDel={() => del(n.id)} />
            ))}
          </div>
        </>
      )}

      {loaded && notes.length === 0 && (
        <div className="rounded-lg border border-dashed border-border px-5 py-8 text-center">
          <p className="text-sm font-semibold text-muted-foreground">{t("notes.noNotes")}</p>
          {!editorOpen && (
            <Button onClick={openNew} variant="secondary" className="mt-3 h-10 gap-1.5 rounded-lg px-4 text-xs font-bold">
              <Plus className="size-3.5" /> {t("notes.add")}
            </Button>
          )}
        </div>
      )}
      {loaded && notes.length > 0 && pinned.length === 0 && others.length === 0 && (
        <p className="rounded-lg border border-dashed border-border px-5 py-6 text-center text-sm text-muted-foreground">{t("common.noResults")}</p>
      )}
    </div>
  );
}

/** One journal row: title, snippet, meta, quiet actions. */
function NoteRowEl({
  n, t, first, lang, onEdit, onPin, onDel,
}: {
  n: NoteRow;
  t: (p: string) => string;
  first: boolean;
  lang: string;
  onEdit: () => void;
  onPin: () => void;
  onDel: () => void;
}) {
  const updated = n.updatedAt
    ? new Intl.DateTimeFormat(lang === "ar" ? "ar-EG" : "en-GB", { day: "numeric", month: "short" }).format(new Date(n.updatedAt))
    : null;
  return (
    <div className={`group flex items-start gap-3 px-4 py-3.5 sm:px-5 ${first ? "" : "border-t border-border/70"}`}>
      <div className="min-w-0 flex-1">
        <h3 className="truncate font-display text-[15px] font-bold leading-relaxed">{n.title}</h3>
        {n.content && <p className="mt-0.5 line-clamp-2 text-sm leading-relaxed text-muted-foreground">{n.content}</p>}
        <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
          {n.subject && (
            <span className="flex items-center gap-1">
              <BookOpen className="size-3" /> {n.subject}
            </span>
          )}
          {updated && <span className="num-tabular">{t("notes.updated")} · {updated}</span>}
        </p>
      </div>
      <div className="flex shrink-0 gap-0.5">
        <button onClick={onPin} className="grid size-10 place-items-center rounded-lg hover:bg-accent tap" aria-label={n.pinned ? t("notes.unpin") : t("notes.pin")}>
          {n.pinned ? <PinOff className="size-4 text-primary" /> : <Pin className="size-4" />}
        </button>
        <button onClick={onEdit} className="grid size-10 place-items-center rounded-lg hover:bg-accent tap" aria-label={t("common.edit")}>
          <Pencil className="size-4" />
        </button>
        <button onClick={onDel} className="grid size-10 place-items-center rounded-lg hover:bg-destructive/10 hover:text-destructive tap" aria-label={t("common.delete")}>
          <Trash2 className="size-4" />
        </button>
      </div>
    </div>
  );
}
