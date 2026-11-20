"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { useApp } from "@/components/providers";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  Package, Download, Upload, ArchiveRestore, Merge, AlertTriangle, CheckCircle2,
  ShieldAlert, Clock, FileJson, X,
} from "lucide-react";
import {
  validateBackupFile, backupToString, backupFileName, APP_VERSION,
  type BackupFileV3, type BackupPhase, type RestoreReport, type ValidationResult,
} from "@/lib/backup";
import { getStore } from "@/lib/datastore";
import type { LocalStore } from "@/lib/datastore/local";

// ═══════════════ Backup & Restore — complete data lifecycle, local mode ═══════════════
// Export: one validated v3 file with EVERYTHING (profile, settings, 8 data tables,
// images, review history). Import: validated first, then Merge (progress-safe,
// nothing deleted) or Replace (auto safety backup downloaded before the wipe).

const LAST_BACKUP_KEY = "ld2_lastbackup";

type Phase =
  | { kind: "idle" }
  | { kind: "exporting"; label: string; pct: number }
  | { kind: "picking"; label: string; pct: number } // reading + validating the file
  | { kind: "importing"; label: string; pct: number }
  | { kind: "error"; message: string }
  | { kind: "report"; report: RestoreReport };

function downloadJson(text: string, name: string) {
  const blob = new Blob([text], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5_000);
}

function daysSinceBackup(iso: string | null): number {
  if (!iso) return Infinity;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? Math.floor((Date.now() - t) / 86_400_000) : Infinity;
}

export function BackupRestore() {
  const { t, lang } = useApp();
  const store = getStore() as LocalStore; // rendered only in local mode
  const fileRef = useRef<HTMLInputElement>(null);

  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [pending, setPending] = useState<ValidationResult | null>(null);
  const [confirmReplace, setConfirmReplace] = useState(false);
  const [daysSince, setDaysSince] = useState<number>(Infinity);
  const [storage, setStorage] = useState<{ usage: number; quota: number } | null>(null);

  useEffect(() => {
    // state updates ride async callbacks — never sync setState in the effect body
    Promise.resolve().then(() => {
      let iso: string | null = null;
      try { iso = localStorage.getItem(LAST_BACKUP_KEY); } catch { /* ignore */ }
      setDaysSince(daysSinceBackup(iso));
    }).catch(() => null);
    navigator.storage?.estimate?.().then((est) => {
      if (est.usage != null || est.quota != null) setStorage({ usage: est.usage ?? 0, quota: est.quota ?? 0 });
    }).catch(() => null);
  }, []);

  const refreshBackupStamp = useCallback(() => {
    let iso: string | null = null;
    try { iso = localStorage.getItem(LAST_BACKUP_KEY); } catch { /* ignore */ }
    setDaysSince(daysSinceBackup(iso));
  }, []);

  // ── export ──
  const doExport = useCallback(async () => {
    if (phase.kind === "exporting") return;
    setPhase({ kind: "exporting", label: t("backup.preparing"), pct: 5 });
    try {
      const file = await store.exportBackup((p: BackupPhase) => {
        const pct = p.phase === "read" ? 5 + Math.round((p.done / p.total) * 90) : p.phase === "done" ? 100 : 5;
        setPhase({ kind: "exporting", label: t("backup.reading"), pct });
      });
      downloadJson(backupToString(file), backupFileName("backup"));
      try { localStorage.setItem(LAST_BACKUP_KEY, new Date().toISOString()); } catch { /* ignore */ }
      refreshBackupStamp();
      setPhase({ kind: "idle" });
    } catch {
      setPhase({ kind: "error", message: t("backup.exportFailed") });
    }
  }, [phase.kind, store, t, refreshBackupStamp]);

  // ── pick + validate a file ──
  const pickFile = useCallback(async (file: File | undefined) => {
    if (!file) return;
    setPhase({ kind: "picking", label: t("backup.validating"), pct: 30 });
    try {
      const text = await file.text();
      setPhase({ kind: "picking", label: t("backup.validating"), pct: 80 });
      const result = validateBackupFile(text);
      setPhase({ kind: "picking", label: t("backup.validating"), pct: 100 });
      if (!result.ok) {
        setPending(null);
        setPhase({ kind: "error", message: `${t("backup.invalidFile")}: ${result.errors.slice(0, 3).join(" · ")}` });
        return;
      }
      setPending(result); // preview + choose mode
      setPhase({ kind: "idle" });
    } catch {
      setPhase({ kind: "error", message: t("backup.invalidFile") });
    }
  }, [t]);

  // ── run the import ──
  const doImport = useCallback(async (mode: "merge" | "replace") => {
    if (!pending?.file) return;
    const file: BackupFileV3 = pending.file;
    setPending(null);
    setConfirmReplace(false);
    setPhase({ kind: "importing", label: t("backup.validating"), pct: 3 });
    try {
      // Replace: the CURRENT device snapshot downloads FIRST — if this fails,
      // the replace never happens.
      if (mode === "replace") {
        setPhase({ kind: "importing", label: t("backup.safetySnapshot"), pct: 6 });
        const safety = await store.exportBackup();
        downloadJson(backupToString(safety), backupFileName("safety"));
      }
      const report = await store.importBackup(file, mode, (p: BackupPhase) => {
        const pct =
          p.phase === "validate" ? 10
          : p.phase === "write" ? 10 + Math.round((p.done / Math.max(p.total, 1)) * 85)
          : p.phase === "done" ? 100 : 8;
        setPhase({ kind: "importing", label: p.phase === "validate" ? t("backup.validating") : t("backup.writing"), pct });
      });
      setPhase({ kind: "report", report });
    } catch {
      setPhase({ kind: "error", message: t("backup.importFailed") });
    }
  }, [pending, store, t]);

  // ── derived display values ──
  const busy = phase.kind === "exporting" || phase.kind === "importing" || phase.kind === "picking";
  const fmtBytes = (n: number) =>
    n >= 1073741824 ? `${(n / 1073741824).toFixed(1)} GB` : n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${(n / 1024).toFixed(0)} KB`;
  const pct = storage && storage.quota > 0 ? storage.usage / storage.quota : 0;

  return (
    <section className="card-soft p-4">
      <h2 className="flex items-center gap-1.5 font-display text-base font-bold">
        <Package className="size-4" /> {t("backup.title")}
      </h2>
      <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{t("backup.desc")}</p>

      {/* backup freshness reminder */}
      {phase.kind !== "report" && (
        <div className={`mt-3 flex items-center gap-2 rounded-lg border p-2.5 text-xs ${
          daysSince === Infinity || daysSince >= 14 ? "border-warning/40 bg-warning/10" : "border-border bg-muted/40"
        }`}>
          <Clock className="size-3.5 shrink-0 text-muted-foreground" />
          <span className={daysSince === Infinity || daysSince >= 14 ? "font-semibold text-warning" : "text-muted-foreground"}>
            {daysSince === Infinity
              ? t("backup.neverBackedUp")
              : t("backup.lastBackup", { n: daysSince })}
            {daysSince >= 14 || daysSince === Infinity ? ` — ${t("backup.reminder")}` : ""}
          </span>
        </div>
      )}

      {/* quota awareness */}
      {storage && pct >= 0.75 && (
        <div className="mt-2 flex items-center gap-2 rounded-lg border border-warning/40 bg-warning/10 p-2.5 text-xs font-semibold text-warning">
          <AlertTriangle className="size-3.5 shrink-0" />
          {t("backup.quotaWarning", { n: `${Math.round(pct * 100)}%`, q: fmtBytes(storage.quota) })}
        </div>
      )}

      {/* progress bar */}
      {busy && (
        <div className="mt-3">
          <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
            <FileJson className="size-3.5 animate-pulse" /> {phase.label}
          </p>
          <Progress value={phase.pct} className="h-2 rounded-full" />
        </div>
      )}

      {/* error */}
      {phase.kind === "error" && (
        <div className="mt-3 flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-xs">
          <ShieldAlert className="mt-0.5 size-4 shrink-0 text-destructive" />
          <p className="font-semibold leading-relaxed text-destructive">{phase.message}</p>
        </div>
      )}

      {/* validation preview → choose merge / replace */}
      {pending?.ok && pending.file && (
        <div className="mt-3 rounded-lg border border-primary/30 bg-primary/5 p-3">
          <div className="flex items-center justify-between">
            <p className="flex items-center gap-1.5 text-sm font-bold">
              <FileJson className="size-4 text-primary" />
              {pending.legacy ? t("backup.legacyFile") : t("backup.validFile")}
            </p>
            <button
              onClick={() => setPending(null)}
              className="grid size-7 place-items-center rounded-full text-muted-foreground hover:bg-accent tap"
              aria-label={t("common.close")}
            >
              <X className="size-4" />
            </button>
          </div>
          <div className="mt-2 grid grid-cols-4 gap-1.5 text-center text-[11px] font-semibold sm:grid-cols-8">
            {([
              ["tasks", pending.file.counts.tasks], ["notes", pending.file.counts.notes],
              ["sprints", pending.file.counts.sprints], ["sessions", pending.file.counts.sessions],
              ["exams", pending.file.counts.exams], ["decks", pending.file.counts.decks],
              ["cards", pending.file.counts.cards], ["images", pending.file.counts.images],
            ] as [string, number][]).map(([k, n]) => (
              <div key={k} className="rounded-xl bg-muted/70 p-1.5">
                <div className="num-tabular text-sm">{n}</div>
                <div className="text-muted-foreground">{t(`backup.${k}`)}</div>
              </div>
            ))}
          </div>
          {pending.file.profile && (
            <p className="mt-2 text-xs text-muted-foreground">
              {t("backup.fileProfile")}: <span className="font-semibold text-foreground">{pending.file.profile.username}</span>
            </p>
          )}
          {pending.warnings.length > 0 && (
            <ul className="mt-2 space-y-1 text-[11px] leading-relaxed text-warning">
              {pending.warnings.slice(0, 3).map((w, i) => (
                <li key={i} className="flex items-start gap-1"><AlertTriangle className="mt-0.5 size-3 shrink-0" />{w}</li>
              ))}
            </ul>
          )}
          {pending.legacy && <p className="mt-2 text-[11px] text-muted-foreground">{t("backup.legacyNote")}</p>}
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <Button onClick={() => doImport("merge")} className="h-10 flex-1 gap-1.5 rounded-xl font-bold" disabled={busy}>
              <Merge className="size-4" /> {t("backup.merge")}
            </Button>
            <Button variant="destructive" onClick={() => setConfirmReplace(true)} className="h-10 flex-1 gap-1.5 rounded-xl font-bold" disabled={busy}>
              <ArchiveRestore className="size-4" /> {t("backup.replace")}
            </Button>
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">{t("backup.mergeDesc")}</p>
        </div>
      )}

      {/* replace confirmation */}
      {confirmReplace && (
        <div className="mt-3 rounded-lg border border-destructive/40 bg-destructive/10 p-3">
          <p className="flex items-center gap-1.5 text-sm font-bold text-destructive">
            <ShieldAlert className="size-4" /> {t("backup.replaceConfirmTitle")}
          </p>
          <p className="mt-1.5 text-xs leading-relaxed text-foreground/80">{t("backup.replaceConfirmBody")}</p>
          <div className="mt-2.5 flex gap-2">
            <Button variant="destructive" size="sm" onClick={() => doImport("replace")} className="rounded-xl px-4 font-bold">
              {t("common.confirm")}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setConfirmReplace(false)} className="rounded-xl">
              {t("common.cancel")}
            </Button>
          </div>
        </div>
      )}

      {/* import report */}
      {phase.kind === "report" && (
        <div className="mt-3 rounded-lg border border-success/40 bg-success/10 p-3">
          <p className="flex items-center gap-1.5 text-sm font-bold text-success">
            <CheckCircle2 className="size-4" />
            {phase.report.mode === "replace" ? t("backup.replaceDone") : t("backup.mergeDone")}
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5 text-[11px] font-semibold">
            <span className="rounded-full bg-muted px-2.5 py-1">{t("backup.added")}: {phase.report.added}</span>
            <span className="rounded-full bg-muted px-2.5 py-1">{t("backup.updated")}: {phase.report.updated}</span>
            {phase.report.conflicts > 0 && (
              <span className="rounded-full bg-warning/20 px-2.5 py-1 text-warning">{t("backup.conflicts")}: {phase.report.conflicts}</span>
            )}
            {phase.report.skipped > 0 && (
              <span className="rounded-full bg-muted px-2.5 py-1">{t("backup.skipped")}: {phase.report.skipped}</span>
            )}
            {phase.report.profile === "kept-conflict" && (
              <span className="rounded-full bg-warning/20 px-2.5 py-1 text-warning">{t("backup.profileKept")}</span>
            )}
          </div>
          {phase.report.safetyBackup && (
            <p className="mt-2 text-xs text-muted-foreground">{t("backup.safetyDownloaded")}</p>
          )}
          <Button variant="ghost" size="sm" onClick={() => setPhase({ kind: "idle" })} className="mt-2 rounded-xl font-semibold">
            {t("common.close")}
          </Button>
        </div>
      )}

      {/* main actions */}
      {(phase.kind === "idle" || phase.kind === "error") && !pending && (
        <div className="mt-3 flex flex-col gap-2">
          <Button onClick={doExport} className="h-10 w-full gap-1.5 rounded-xl font-bold" disabled={busy}>
            <Upload className="size-4" /> {t("backup.export")}
          </Button>
          <Button variant="secondary" onClick={() => fileRef.current?.click()} className="h-10 w-full gap-1.5 rounded-xl font-semibold" disabled={busy}>
            <Download className="size-4" /> {t("backup.import")}
          </Button>
          <input
            ref={fileRef} type="file" accept=".json,application/json" className="hidden"
            onChange={(e) => { void pickFile(e.target.files?.[0]); e.target.value = ""; }}
          />
        </div>
      )}

      <p className="mt-3 text-[11px] text-muted-foreground">
        {t("backup.formatNote", { v: APP_VERSION })}
        {lang === "ar" ? " · " : " · "}
        {t("backup.includeNote")}
      </p>
    </section>
  );
}
