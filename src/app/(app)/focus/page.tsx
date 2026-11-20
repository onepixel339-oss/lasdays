"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { useApp } from "@/components/providers";
import { getStore } from "@/lib/datastore";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AMB_KEYS, ambStart, ambStop, ambSetVolume, type AmbKey } from "@/lib/ambience";
import {
  freshTimer, remainingMs, totalMs,
  startTimer, pauseTimer, finishPhase, skipPhase, switchPhase, resetPhase,
  isExpired, clampMinutes, clampState,
  type TimerState, type Phase,
} from "@/lib/timer-core";
import { Target, Coffee, Armchair, Sparkles, Check, CloudRain, Waves, Wind, Activity, AudioWaveform, RotateCcw, SkipForward, type LucideIcon } from "lucide-react";

// ═══════════════ Focus — مؤقت هادئ · دفتر آخر النهار ═══════════════
// The timer is the page. Subject first (prefilled from ?subject= when coming
// from a task), one primary control, durations tucked into a quiet row.
// While running the ring stays perfectly stable — no pulsing, no popups.
// The countdown is anchored to wall-clock endsAt, so it keeps ticking (and
// stays correct) across SPA navigation, reloads and background tabs. Only the
// *actual* elapsed focus time is logged — pausing, skipping and custom
// durations all produce truthful session records.

const TIMER_KEY = "ld2_timer_v2";
const DUR_KEY = "ld2_focus_settings";

const PHASE_ICON: Record<Phase, LucideIcon> = { focus: Target, short: Coffee, long: Armchair };
const AMB_ICON: Record<AmbKey, LucideIcon> = {
  rain: CloudRain, cafe: Coffee, waves: Waves, wind: Wind, white: Activity, brown: AudioWaveform,
};
const PHASE_LABEL: Record<Phase, string> = {
  focus: "focus.focus",
  short: "focus.shortBreak",
  long: "focus.longBreak",
};

const MIN_LOG_SEC = 30;

export default function FocusPage() {
  const { t, dir } = useApp();
  const [timer, setTimer] = useState<TimerState>(() => freshTimer());
  const [restored, setRestored] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [custom, setCustom] = useState<string>("");
  const [subject, setSubject] = useState("");
  const [immersive, setImmersive] = useState(false);
  const [scratch, setScratch] = useState(() => {
    try {
      return localStorage.getItem("ld2_scratch") ?? "";
    } catch {
      return "";
    }
  });
  const [todayMin, setTodayMin] = useState(0);
  const [todayCount, setTodayCount] = useState(0);
  const [msg, setMsg] = useState<string | null>(null);
  const [amb, setAmb] = useState<AmbKey | null>(null);
  const [ambVol, setAmbVol] = useState(() => {
    try { return Number(localStorage.getItem("ld2_ambvol")) || 0.6; } catch { return 0.6; }
  });
  const finishingRef = useRef(false);

  // stop sounds when leaving the page
  useEffect(() => () => ambStop(), []);

  const loadToday = useCallback(async () => {
    const d = await getStore().getTodaySessions().catch(() => null);
    setTodayMin(Math.round((d?.todaySec ?? 0) / 60));
    setTodayCount(d?.todayCount ?? 0);
  }, []);

  const logSession = useCallback(
    async (secs: number, subj: string) => {
      try {
        await getStore().logSession({ durationSec: secs, kind: "focus", subject: subj || null });
      } catch { /* offline — retry isn't possible for a past session */ }
      loadToday();
    },
    [loadToday]
  );

  // ── restore persisted timer on mount (survives reload + navigation) ──
  useEffect(() => {
    loadToday();
    try {
      const dRaw = localStorage.getItem(DUR_KEY);
      let durations = { ...freshTimer().durations };
      let roundsBefore = 4;
      if (dRaw) {
        const d = JSON.parse(dRaw) as { focus?: number; roundsBefore?: number };
        if (typeof d.focus === "number") durations.focus = clampMinutes(d.focus);
        if (typeof d.roundsBefore === "number") roundsBefore = Math.max(2, Math.min(6, d.roundsBefore));
      }
      const raw = localStorage.getItem(TIMER_KEY);
      let st: TimerState = raw ? clampState(JSON.parse(raw) as TimerState) : freshTimer(durations, roundsBefore);
      st = { ...st, durations, roundsBefore, subject: st.subject ?? "" };

      // linked from a task (Home/Tasks): ?subject=… prefills the session subject
      const fromTask = new URLSearchParams(window.location.search).get("subject");
      if (fromTask && !st.running) st = { ...st, subject: fromTask };

      const nowTs = Date.now();
      if (isExpired(st, nowTs)) {
        // a phase finished while the app was closed → log it honestly, advance
        const wasFocus = st.phase === "focus";
        const subjectThen = st.subject;
        const { state: ns, loggedFocusSec } = finishPhase(st, nowTs, "completed");
        finishingRef.current = true;
        setTimer(ns);
        setTimeout(() => { finishingRef.current = false; }, 0);
        if (wasFocus && loggedFocusSec != null && loggedFocusSec >= MIN_LOG_SEC) {
          void logSession(loggedFocusSec, subjectThen);
        }
        setMsg(wasFocus ? t("focus.sessionDone") : t("focus.breakDone"));
      } else {
        setTimer(st);
        setSubject(st.subject);
      }
    } catch {
      setTimer(freshTimer());
    }
    setRestored(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── persist the timer on every change ──
  useEffect(() => {
    if (!restored) return;
    try {
      localStorage.setItem(TIMER_KEY, JSON.stringify(timer));
    } catch { /* ignore */ }
  }, [timer, restored]);

  // ── the heartbeat: wall-clock based, immune to throttle/drift ──
  useEffect(() => {
    if (!timer.running) return;
    const id = setInterval(() => {
      const nowTs = Date.now();
      setNow(nowTs);
      if (finishingRef.current) return;
      if (timer.endsAt != null && nowTs >= timer.endsAt) {
        finishingRef.current = true;
        const wasFocus = timer.phase === "focus";
        const { state: ns, loggedFocusSec } = finishPhase(timer, nowTs, "completed");
        setTimer(ns);
        if (wasFocus && loggedFocusSec != null && loggedFocusSec >= MIN_LOG_SEC) {
          void logSession(loggedFocusSec, timer.subject);
        }
        setMsg(wasFocus ? t("focus.sessionDone") : t("focus.breakDone"));
        navigator.vibrate?.([120, 60, 120]);
        setTimeout(() => { finishingRef.current = false; }, 0);
      }
    }, 500);
    return () => clearInterval(id);
  }, [timer, logSession, t]);

  const left = remainingMs(timer, now);
  const total = totalMs(timer);
  const running = timer.running;

  function doStart() {
    setMsg(null);
    setTimer((s) => startTimer(s, Date.now()));
  }
  function doPause() {
    setTimer((s) => pauseTimer(s, Date.now()));
  }
  function doReset() {
    setMsg(null);
    setTimer((s) => resetPhase(s));
  }
  function doSkip() {
    const s = timer;
    const { state: ns, loggedFocusSec } = skipPhase(s, Date.now());
    setTimer(ns);
    setMsg(s.phase === "focus" ? t("focus.sessionDone") : t("focus.breakDone"));
    if (s.phase === "focus" && loggedFocusSec != null && loggedFocusSec >= MIN_LOG_SEC) {
      void logSession(loggedFocusSec, s.subject);
    }
  }
  function switchTo(p: Phase) {
    setMsg(null);
    setTimer((s) => switchPhase(s, p));
  }
  function applyCustom() {
    const n = clampMinutes(Number(custom));
    if (!custom.trim() || Number.isNaN(Number(custom))) return;
    try {
      const dRaw = localStorage.getItem(DUR_KEY);
      const d = dRaw ? JSON.parse(dRaw) : {};
      localStorage.setItem(DUR_KEY, JSON.stringify({ ...d, focus: n }));
    } catch { /* ignore */ }
    setTimer((s) => {
      const next = { ...s, durations: { ...s.durations, focus: n } };
      // idle focus phase picks up the new length immediately
      if (s.phase === "focus" && !s.running) {
        return { ...next, pausedLeftMs: null, endsAt: null, focusElapsedMs: 0, stretchStartedAt: null };
      }
      return next;
    });
    setCustom("");
  }
  function setRounds(n: number) {
    try {
      const dRaw = localStorage.getItem(DUR_KEY);
      const d = dRaw ? JSON.parse(dRaw) : {};
      localStorage.setItem(DUR_KEY, JSON.stringify({ ...d, roundsBefore: n }));
    } catch { /* ignore */ }
    setTimer((s) => ({ ...s, roundsBefore: n }));
  }

  function updateSubject(v: string) {
    setSubject(v);
    setTimer((s) => ({ ...s, subject: v }));
  }

  function toggleAmb(key: AmbKey) {
    if (amb === key) {
      ambStop();
      setAmb(null);
      return;
    }
    ambStart(key, ambVol);
    setAmb(key);
  }

  function changeAmbVol(v: number) {
    setAmbVol(v);
    try { localStorage.setItem("ld2_ambvol", String(v)); } catch { /* ignore */ }
    ambSetVolume(v);
  }

  const mm = String(Math.floor(left / 60_000)).padStart(2, "0");
  const ss = String(Math.floor((left % 60_000) / 1000)).padStart(2, "0");
  const pct = total > 0 ? Math.max(0, Math.min(1, 1 - left / total)) : 0;
  const R = 118;
  const C = 2 * Math.PI * R;
  const phaseMin = timer.durations[timer.phase];
  const isFull = !running && timer.pausedLeftMs == null;

  // immersive overlay — the timer, the subject, nothing else competing
  if (immersive) {
    return (
      <div className="fixed inset-0 z-50 paper hero-glow flex flex-col items-center justify-center px-6" dir={dir}>
        <p className="flex items-center gap-2 font-display text-lg text-muted-foreground">
          {React.createElement(PHASE_ICON[timer.phase], { className: "size-5" })} {t(PHASE_LABEL[timer.phase])}
        </p>
        <div className="mt-6 font-display text-[22vw] md:text-[160px] font-bold leading-none num-tabular tabular-nums glow-ring" style={{ color: timer.phase === "focus" ? "var(--primary)" : "var(--success)" }}>
          {mm}:{ss}
        </div>
        {subject && <p className="mt-2 text-muted-foreground">{subject}</p>}
        <div className="mt-10 flex gap-3">
          <Button size="lg" variant="secondary" onClick={() => (running ? doPause() : doStart())} className="rounded-lg px-8">
            {running ? t("focus.pause") : t("focus.resume")}
          </Button>
          <Button size="lg" variant="ghost" onClick={() => setImmersive(false)} className="rounded-lg px-8">
            {t("focus.exit")}
          </Button>
        </div>
        <textarea
          value={scratch}
          onChange={(e) => {
            setScratch(e.target.value);
            try { localStorage.setItem("ld2_scratch", e.target.value); } catch { /* ignore */ }
          }}
          placeholder={t("focus.scratchPlaceholder")}
          className="mt-10 h-28 w-full max-w-md rounded-lg border border-dashed border-border bg-card/50 p-4 text-sm outline-none placeholder:text-muted-foreground/60 focus:bg-card"
        />
      </div>
    );
  }

  return (
    <div className="space-y-5" dir={dir}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="font-display text-2xl font-bold">{t("focus.title")}</h1>
        <span className="text-sm text-muted-foreground num-tabular">
          {t("focus.totalToday")}: {todayMin} {t("common.min")} · {todayCount}×
        </span>
      </div>

      {/* ── the timer card: subject, state, dial, one primary control ── */}
      <section className="card-soft overflow-hidden">
        {/* subject — the journal line: what is this session for? */}
        <div className="border-b border-border px-5 pb-4 pt-5">
          <label htmlFor="focus-subject" className="text-xs font-bold text-muted-foreground">
            {t("focus.subject")}
          </label>
          <Input
            id="focus-subject"
            value={subject}
            onChange={(e) => updateSubject(e.target.value)}
            placeholder={t("focus.subjectPlaceholder")}
            className="mt-1.5 h-12 border-0 bg-transparent px-0 text-lg font-semibold shadow-none focus-visible:ring-0 focus-visible:outline-none"
            aria-label={t("focus.subject")}
          />
        </div>

        <div className="px-5 pb-6 pt-5">
          {/* phase tabs — compact, quiet */}
          <div className="mx-auto grid max-w-sm grid-cols-3 gap-1 rounded-lg bg-muted p-1">
            {(["focus", "short", "long"] as Phase[]).map((p) => (
              <button
                key={p}
                onClick={() => switchTo(p)}
                className={`flex min-h-10 items-center justify-center gap-1.5 rounded-md px-2 py-2 text-sm font-semibold transition-colors tap ${
                  timer.phase === p ? "bg-card font-bold text-foreground shadow-soft" : "text-muted-foreground"
                }`}
              >
                {React.createElement(PHASE_ICON[p], { className: "size-4" })} {t(PHASE_LABEL[p])}
              </button>
            ))}
          </div>

          {/* dial — stable while running: progress advances, nothing else moves */}
          <div className="relative mx-auto mt-6 w-fit">
            <svg width="270" height="270" viewBox="0 0 270 270" className="-rotate-90">
              <circle cx="135" cy="135" r={R} fill="none" stroke="var(--muted)" strokeWidth="14" />
              <circle
                cx="135" cy="135" r={R} fill="none"
                stroke={timer.phase === "focus" ? "var(--primary)" : "var(--success)"}
                strokeWidth="14" strokeLinecap="round"
                strokeDasharray={C}
                strokeDashoffset={C * (1 - pct)}
                className="glow-ring"
                style={{ transition: "stroke-dashoffset 0.9s linear" }}
              />
            </svg>
            <div className="absolute inset-0 grid place-items-center">
              <div className="text-center">
                <div className="font-display text-6xl font-bold num-tabular">{mm}:{ss}</div>
                <div className="mt-1 text-sm text-muted-foreground">
                  {t("focus.rounds")} {timer.round} / {timer.roundsBefore}
                </div>
              </div>
            </div>
          </div>

          {msg && (
            <p className="swap-in mt-4 text-center text-sm font-bold text-primary" role="status" aria-live="polite">
              {msg}
            </p>
          )}

          {/* controls — one primary button */}
          <div className="mt-5 flex items-center justify-center gap-3">
            <Button
              size="lg"
              onClick={() => (running ? doPause() : doStart())}
              className="h-13 min-w-40 rounded-lg py-3.5 text-base font-bold"
            >
              {running ? t("focus.pause") : isFull ? t("focus.start") : t("focus.resume")}
            </Button>
            <Button size="lg" variant="secondary" onClick={doReset} className="rounded-lg" aria-label={t("focus.reset")}>
              <RotateCcw className="size-5" />
            </Button>
            <Button size="lg" variant="ghost" onClick={doSkip} className="gap-1.5 rounded-lg">
              <SkipForward className="size-4" /> {t("focus.skip")}
            </Button>
          </div>

          {/* quiet extras */}
          <div className="mt-5 flex justify-center">
            <Button variant="ghost" onClick={() => setImmersive(true)} className="h-10 gap-1.5 rounded-lg text-sm font-semibold text-muted-foreground">
              <Sparkles className="size-4" /> {t("focus.immersive")}
            </Button>
          </div>
        </div>
      </section>

      {/* ── session lengths — accessible, never crowding the dial ── */}
      <section className={`card-soft p-4 transition-opacity ${running ? "opacity-55" : ""}`}>
        <h2 className="font-display text-sm font-bold text-muted-foreground">{t("settings.title")}</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="flex min-h-11 items-center justify-between gap-2 rounded-lg bg-secondary px-4 py-2.5 text-sm font-medium">
            {t("focus.roundsBeforeLong")}
            <select
              value={timer.roundsBefore}
              onChange={(e) => setRounds(Number(e.target.value))}
              className="min-h-9 rounded-lg border border-border bg-card px-2 py-1.5 text-sm"
            >
              {[3, 4, 5, 6].map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </label>
          <div className="flex min-h-11 items-center gap-2 rounded-lg bg-secondary px-4 py-2.5">
            <Input
              value={custom}
              onChange={(e) => setCustom(e.target.value.replace(/\D/g, ""))}
              inputMode="numeric"
              placeholder={t("focus.custom") + ` (1-180 · ${phaseMin})`}
              className="h-9 flex-1 rounded-lg bg-card"
              aria-label={t("focus.custom")}
            />
            <Button size="sm" variant="secondary" onClick={applyCustom} className="rounded-lg" aria-label={t("common.confirm")}>
              <Check className="size-4" />
            </Button>
          </div>
        </div>
      </section>

      {/* ambient sounds — real recorded loops (CC0), gapless offline after first load */}
      <section className="card-soft p-4">
        <h2 className="font-display text-sm font-bold text-muted-foreground">{t("focus.ambience")}</h2>
        <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-6">
          {AMB_KEYS.map((k) => {
            const active = amb === k;
            const Ico = AMB_ICON[k];
            return (
              <button
                key={k}
                onClick={() => toggleAmb(k)}
                aria-pressed={active}
                className={`flex min-h-14 flex-col items-center justify-center gap-1 rounded-lg border py-2.5 text-[11px] font-semibold transition-colors tap ${
                  active
                    ? "border-primary/40 bg-primary/10 text-primary"
                    : "border-border/60 bg-secondary text-muted-foreground hover:text-foreground"
                }`}
              >
                <Ico className="size-5" />
                {t(`focus.${k}`)}
              </button>
            );
          })}
        </div>
        {amb && (
          <div className="mt-3 flex items-center gap-3 rounded-lg bg-secondary px-4 py-2.5">
            <span className="text-xs font-semibold text-muted-foreground">{t("focus.ambVolume")}</span>
            <input
              type="range" min={0} max={1} step={0.05} value={ambVol}
              onChange={(e) => changeAmbVol(Number(e.target.value))}
              className="h-1.5 flex-1 accent-[var(--primary)]"
              aria-label={t("focus.ambVolume")}
            />
            <button
              onClick={() => { ambStop(); setAmb(null); }}
              className="text-xs font-bold text-destructive tap"
            >
              {t("focus.ambStop")}
            </button>
          </div>
        )}
      </section>

      {/* scratchpad */}
      <section className={`card-soft p-4 transition-opacity ${running ? "opacity-55" : ""}`}>
        <h2 className="font-display text-sm font-bold text-muted-foreground">{t("focus.scratch")}</h2>
        <textarea
          value={scratch}
          onChange={(e) => {
            setScratch(e.target.value);
            try { localStorage.setItem("ld2_scratch", e.target.value); } catch { /* ignore */ }
          }}
          placeholder={t("focus.scratchPlaceholder")}
          className="mt-3 h-24 w-full resize-none rounded-lg border border-dashed border-border bg-background p-3 text-sm outline-none focus:bg-card"
          aria-label={t("focus.scratch")}
        />
      </section>
    </div>
  );
}
