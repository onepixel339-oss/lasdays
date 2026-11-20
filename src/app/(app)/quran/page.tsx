"use client";

import React, { useEffect, useState } from "react";
import { useApp } from "@/components/providers";
import { SURAHS, RECITERS, STATIONS, stationLabel, stationLive, type Station } from "@/lib/quran-data";
import {
  getQState, getSharedAudio, subscribe, getVolume, setEngineVolume,
  playRadio, retryRadio, playSurah, togglePause, stopAll, stepSurah, seekRatio, fmt,
} from "@/lib/quran-player";
import {
  Radio,
  Volume2,
  Headphones,
  Mic,
  Square,
  Play,
  Pause,
  SkipBack,
  SkipForward,
  AudioLines,
  Loader2,
  WifiOff,
} from "lucide-react";

// ═══════════════ الطمأنينة: إذاعة القرآن (القاهرة + السعودية) + مشغّل التلاوات ═══════════════
// محرك الصوت والبيانات في src/lib/quran-player.ts + quran-data.ts — الصفحة واجهة بس.

export default function QuranPage() {
  const { t, dir } = useApp();
  const [, force] = useState(0);
  const [tab, setTab] = useState("husary");
  const [volume, setVolume] = useState(getVolume());
  const [online, setOnline] = useState(true);
  const qs = getQState();

  useEffect(() => subscribe(() => force((n) => n + 1)), []);
  // قاعدة «القرآن أونلاين فقط»: الصفحة والمعلومات بتشتغل أوفلاين،
  // بس التشغيل نفسه بيبثّ من الإنترنت — أول ما يقطع بنوضّح السبب ونسيب زر إعادة المحاولة
  useEffect(() => {
    const sync = () => setOnline(navigator.onLine);
    sync();
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
    };
  }, []);
  // lock-screen / media-session metadata follows the current track
  useEffect(() => {
    try {
      if (!("mediaSession" in navigator)) return;
      if (qs.kind === "radio" && qs.station) {
        navigator.mediaSession.metadata = new MediaMetadata({
          title: t(stationLabel(qs.station)),
          artist: t("quran.radioTitle"),
        });
      } else if (qs.kind === "reciter" && qs.reciter && qs.surah !== null) {
        navigator.mediaSession.metadata = new MediaMetadata({
          title: t(`quran.surah_${SURAHS[qs.surah]}`),
          artist: t(`quran.${qs.reciter}Sub`),
        });
      }
    } catch { /* unsupported — ignore */ }
  }, [t, qs.kind, qs.station, qs.reciter, qs.surah]);
  useEffect(() => {
    const saved = Number(localStorage.getItem("aur.quran.vol"));
    if (!isNaN(saved) && saved >= 0 && saved <= 1) {
      queueMicrotask(() => {
        setEngineVolume(saved);
        setVolume(saved);
      });
    }
  }, []);

  function changeVolume(v: number) {
    setVolume(v);
    setEngineVolume(v);
    localStorage.setItem("aur.quran.vol", String(v));
  }

  const audio = getSharedAudio();
  const active = qs.kind !== null;
  const paused = audio ? audio.paused : true;
  const radioActive = qs.kind === "radio";
  const recActive = qs.kind === "reciter";
  const activeReciter = recActive ? RECITERS.find((r) => r.key === qs.reciter) : null;
  const activeSurahNum = recActive && qs.surah !== null ? SURAHS[qs.surah] : null;
  const tabActive = recActive && qs.reciter === tab;

  // player progress (radio streams have no duration)
  const cur = audio?.currentTime ?? 0;
  const dur = audio && isFinite(audio.duration) ? audio.duration : 0;
  const pct = dur > 0 ? Math.min(100, (cur / dur) * 100) : 0;

  function onSeek(e: React.PointerEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = dir === "rtl" ? rect.right - e.clientX : e.clientX - rect.left;
    seekRatio(x / rect.width);
  }

  // player card copy
  const pTitle = radioActive
    ? t(stationLabel(qs.station ?? "cairo"))
    : recActive && activeSurahNum
      ? t(`quran.surah_${activeSurahNum}`)
      : t("quran.pickReciter");
  const pSub = radioActive
    ? qs.loading
      ? t(qs.reconnect ? "quran.reconnecting" : "quran.loading")
      : t(stationLive(qs.station ?? "cairo"))
    : recActive && activeReciter
      ? t(`quran.${activeReciter.key}Sub`)
      : t("quran.curated");

  return (
    <div className="space-y-5" dir={dir}>
      <div>
        <h1 className="font-display text-2xl font-bold">{t("quran.title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("quran.subtitle")}</p>
        <p className="mt-2 flex items-center gap-1.5 text-xs font-semibold">
          <span className={`size-2 rounded-full ${online ? "bg-success" : "bg-warning"}`} aria-hidden />
          <span className={online ? "text-success" : "text-warning"}>
            {online ? t("quran.onlineNow") : t("quran.offlineNow")}
          </span>
        </p>
        <p className="mt-2.5 rounded-lg border border-border bg-secondary px-3.5 py-2.5 text-xs leading-relaxed text-muted-foreground">
          {t("quran.onlineNote")}
        </p>
      </div>

      {/* ── offline notice: interface stays usable, playback needs internet ── */}
      {(qs.error === "offline" || !online) && qs.kind === null && (
        <section className="rounded-3xl border border-warning/40 bg-warning/10 p-4" role="status">
          <p className="flex items-center gap-1.5 font-display text-base font-bold text-warning">
            <WifiOff className="size-4" /> {t("quranOffline.title")}
          </p>
          <p className="mt-1.5 text-xs leading-relaxed text-foreground/80">{t("quranOffline.body")}</p>
          {qs.error === "offline" && (
            <button
              onClick={retryRadio}
              className="mt-2.5 rounded-full bg-primary px-4 py-2 text-xs font-bold text-primary-foreground shadow-soft transition-transform active:scale-95 tap"
            >
              {t("quranOffline.retry")}
            </button>
          )}
        </section>
      )}

      {/* ── radio hero ── */}
      <section className={`card-soft relative overflow-hidden p-6 text-center transition-all ${radioActive ? "ring-2 ring-primary/50" : ""}`}>
        <div className="hero-glow absolute inset-0" />
        <div className="relative">
          <div className={`mx-auto grid size-16 place-items-center rounded-full border-2 border-primary/25 bg-primary/10`}>
            <Radio className={`size-8 ${radioActive ? "text-primary" : "text-primary/70"}`} />
          </div>
          {radioActive && !paused && !qs.loading && (
            <span className="eq eq-slow mx-auto mt-3 text-primary" aria-hidden>
              <i /><i /><i /><i /><i />
            </span>
          )}
          <h2 className="mt-3 font-display text-xl font-bold">{t("quran.radioTitle")}</h2>
          <p className="text-xs text-muted-foreground">
            {qs.loading && radioActive
              ? t(qs.reconnect ? "quran.reconnecting" : "quran.loading")
              : qs.error === "offline"
                ? t("quranOffline.title")
                : qs.error === "radio"
                ? t("quran.streamFail")
                : radioActive
                  ? t(stationLive(qs.station ?? "cairo"))
                  : t("quran.pickStation")}
          </p>
          {(qs.error === "radio" || qs.error === "offline") && (
            <button
              onClick={retryRadio}
              className="mt-2 rounded-full bg-primary px-5 py-2.5 text-sm font-bold text-primary-foreground shadow-soft transition-transform active:scale-95 tap"
            >
              {qs.error === "offline" ? t("quranOffline.retry") : t("quran.tryAgain")}
            </button>
          )}

          {/* اختيار المحطة — بث مباشر من المتصفح، وكل محطة بمراياها */}
          <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
            {STATIONS.map((s) => {
              const on = radioActive && qs.station === s;
              const connecting = on && qs.loading;
              const live = on && !paused && !qs.loading;
              return (
                <button
                  key={s}
                  onClick={() => playRadio(s as Station)}
                  aria-pressed={on}
                  className={`flex items-center gap-2 rounded-full px-5 py-3 text-sm font-bold transition-all tap ${
                    on
                      ? "grad-primary text-white shadow-soft"
                      : "card-soft text-muted-foreground hover:text-foreground"
                  } ${qs.loading && !on ? "opacity-50" : ""}`}
                >
                  {connecting ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Radio className={`size-4 ${on ? "" : "text-primary/70"}`} />
                  )}
                  {t(stationLabel(s))}
                  {live && (
                    <span className="eq px-0.5" aria-hidden>
                      <i /><i /><i />
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {radioActive && !qs.loading && (
            <div className="mt-3 flex items-center justify-center gap-2">
              <button
                onClick={togglePause}
                className="flex items-center gap-2 rounded-full bg-primary px-6 py-3 font-bold text-primary-foreground shadow-soft transition-transform active:scale-95 tap"
              >
                {paused ? <Play className="size-4" /> : <Pause className="size-4" />}
                {paused ? t("quran.resume") : t("quran.pause")}
              </button>
              <button
                onClick={stopAll}
                className="grid size-12 place-items-center rounded-full bg-destructive/12 text-destructive transition-transform active:scale-95 tap"
                aria-label={t("quran.stop")}
              >
                <Square className="size-4" />
              </button>
            </div>
          )}
        </div>
      </section>

      {/* ── volume (shared) ── */}
      <section className="card-soft flex items-center gap-3 p-4">
        <Volume2 className="size-5 shrink-0 text-muted-foreground" />
        <input
          type="range" min={0} max={1} step={0.05} value={volume}
          onChange={(e) => changeVolume(Number(e.target.value))}
          className="h-2 flex-1 accent-[var(--primary)]"
          aria-label={t("quran.volume")}
        />
        <span className="w-10 text-end text-xs text-muted-foreground num-tabular"><bdi dir="ltr">{Math.round(volume * 100)}%</bdi></span>
      </section>

      {/* ── recitations ── */}
      <section>
        <div className="flex items-center justify-between gap-2">
          <h2 className="flex items-center gap-1.5 font-display text-base font-bold">
            <Headphones className="size-4" /> {t("quran.reciters")}
          </h2>
          <span className="rounded-full border border-border px-2.5 py-0.5 text-[11px] text-muted-foreground">
            {t("quran.curated")}
          </span>
        </div>

        {/* reciter tabs */}
        <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
          {RECITERS.map((r) => {
            const on = tab === r.key;
            const live = recActive && qs.reciter === r.key;
            return (
              <button
                key={r.key}
                onClick={() => setTab(r.key)}
                className={`flex shrink-0 items-center gap-1.5 rounded-full px-4 py-2 text-sm font-semibold transition-all tap ${
                  on
                    ? "grad-primary text-white shadow-soft"
                    : "card-soft text-muted-foreground hover:text-foreground"
                }`}
              >
                <Mic className="size-3.5" />
                {t(`quran.${r.key}`)}
                {live && !paused && <AudioLines className="size-3.5" />}
              </button>
            );
          })}
        </div>

        {/* player card */}
        <section className="card-soft relative mt-3 overflow-hidden p-5">
          {active && <div className="hero-glow absolute inset-0" />}
          <div className="relative">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate font-display text-base font-bold">{pTitle}</p>
                <p className="mt-0.5 truncate text-xs text-muted-foreground">{pSub}</p>
              </div>
              {active && !paused && !qs.loading && (
                <span className="eq shrink-0 text-primary" aria-hidden>
                  <i /><i /><i /><i /><i />
                </span>
              )}
            </div>

            {/* seek bar — hidden for live radio */}
            {recActive ? (
              <>
                <div
                  className="mt-4 h-2 cursor-pointer rounded-full bg-foreground/10 tap"
                  onPointerDown={onSeek}
                >
                  <div className="h-full rounded-full grad-primary transition-[width] duration-200" style={{ width: `${pct}%` }} />
                </div>
                <div className="mt-1.5 flex justify-between text-[11px] text-muted-foreground num-tabular">
                  <span><bdi dir="ltr">{fmt(cur)}</bdi></span>
                  <span><bdi dir="ltr">{dur > 0 ? fmt(dur) : (qs.loading ? t("quran.connectSurah") : "–:––")}</bdi></span>
                </div>
              </>
            ) : (
              <div className="mt-4 h-2 rounded-full bg-foreground/10" />
            )}

            {/* transport controls keep LTR order (standard for audio players, even in RTL) */}
            <div dir="ltr" className="relative mt-3 flex items-center justify-center gap-5">
              <button
                onClick={() => stepSurah(-1)}
                disabled={!recActive}
                className="grid size-11 place-items-center rounded-full text-muted-foreground transition-all hover:text-foreground active:scale-90 tap disabled:opacity-35"
                aria-label={t("quran.prev")}
              >
                <SkipBack className="size-5" />
              </button>
              <button
                onClick={() => {
                  if (qs.loading) return;
                  if (!active) return playSurah(tab, 0);
                  togglePause();
                }}
                className={`grid size-14 place-items-center rounded-full shadow-soft transition-transform active:scale-90 tap ${active ? "grad-primary text-white" : "bg-foreground/15 text-foreground"}`}
                aria-label={paused ? t("quran.play") : t("quran.pause")}
              >
                {qs.loading ? (
                  <Loader2 className="size-6 animate-spin" />
                ) : paused ? (
                  <Play className="size-6" />
                ) : (
                  <Pause className="size-6" />
                )}
              </button>
              <button
                onClick={() => stepSurah(1)}
                disabled={!recActive}
                className="grid size-11 place-items-center rounded-full text-muted-foreground transition-all hover:text-foreground active:scale-90 tap disabled:opacity-35"
                aria-label={t("quran.next")}
              >
                <SkipForward className="size-5" />
              </button>
              {recActive && (
                <button
                  onClick={stopAll}
                  className="absolute end-0 top-1/2 grid size-9 -translate-y-1/2 place-items-center rounded-full bg-destructive/12 text-destructive transition-transform active:scale-90 tap"
                  aria-label={t("quran.stop")}
                >
                  <Square className="size-3.5" />
                </button>
              )}
            </div>

            {(qs.error === "reciter" || qs.error === "offline") && (
              <p className="mt-3 text-center text-sm text-destructive">
                {qs.error === "offline" ? t("quranOffline.title") : t("quran.loadFail")}
              </p>
            )}
          </div>
        </section>

        {/* surah list */}
        <div className="card-soft mt-3 overflow-hidden">
          {SURAHS.map((num, i) => {
            const isActive = tabActive && qs.surah === i;
            const isPlaying = isActive && !paused && !qs.loading;
            return (
              <button
                key={num}
                onClick={() => (isActive ? togglePause() : playSurah(tab, i))}
                className={`flex w-full items-center gap-3 p-3.5 text-start transition-colors tap ${i > 0 ? "border-t border-border/70" : ""} ${isActive ? "bg-primary/8" : "hover:bg-accent/50"}`}
              >
                <span className={`num-tabular grid size-10 shrink-0 place-items-center rounded-lg border text-sm font-bold ${isActive ? "border-primary/40 bg-primary/10 text-primary" : "border-border text-muted-foreground"}`}>
                  {i + 1}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{t(`quran.surah_${num}`)}</span>
                  <span className="block truncate text-xs text-muted-foreground">{t(`quran.${tab}Sub`)}</span>
                </span>
                {qs.loading && isActive ? (
                  <Loader2 className="size-5 shrink-0 animate-spin text-primary" />
                ) : isPlaying ? (
                  <span className="eq shrink-0 px-1 text-primary" aria-hidden>
                    <i /><i /><i /><i /><i />
                  </span>
                ) : (
                  <span className={`grid size-10 shrink-0 place-items-center rounded-full ${isActive ? "bg-primary text-primary-foreground" : "bg-foreground/8 text-muted-foreground"}`}>
                    {isActive && paused ? <Pause className="size-4" /> : <Play className="size-4" />}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </section>

      <p className="text-center text-xs text-muted-foreground">{t("quran.continues")}</p>
    </div>
  );
}
