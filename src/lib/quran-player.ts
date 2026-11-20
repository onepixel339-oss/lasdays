"use client";

// ═══════════════ Quran audio engine — singleton on module scope ═══════════════
// التشغيل مكمل عبر التنقل داخل التطبيق (الصوت على مستوى الموديول).
// سلّم اتصال الإذاعة (من الأسرع للأضمن) — التفاصيل عند playRadio:
//   1) مرايا المحطة مباشرة (https) — المتصفح بيتابع التحويلة بنفسه؛ المتصفحات
//      الحديثة بترقّي أي صوت مختلط (http) إلى https تلقائيًا (mixed-content
//      auto-upgrade) فالبث بيشتغل من CDN radiojar مباشرة — الصوت مش عابر من
//      أي سيرفر للتطبيق
//   2) مرآة فشلت؟ المرآة اللي بعدها فورًا — كل محاولة بتاخد توكن جديد
//   3) كل المرايا فشلت — رسالة فشل واضحة + زر إعادة المحاولة
//
// ملاحظة معمارية (Stage 3): مفيش سيرفر خالص — التطبيق ملفات ساكنة. مفيش
// بروكسي نفس الأصل ولا محلّل على السيرفر؛ المرايا هي طريق البث الوحيد.

import {
  SURAHS, RECITERS, surahUrl, type Station,
} from "./quran-data";
import { stationMirrors } from "./radio-stations";

type QKind = "radio" | "reciter";
export type QState = {
  kind: QKind | null;
  station: Station | null;
  reciter: string | null;
  surah: number | null; // index into SURAHS
  loading: boolean;
  reconnect: boolean; // بنعيد الاتصال بنفس المحطة (مش أول اتصال)
  error: "radio" | "reciter" | "offline" | null; // offline = قاعدة «القرآن أونلاين فقط»
};

let sharedAudio: HTMLAudioElement | null = null;
let sharedVolume = 0.9;
let qState: QState = { kind: null, station: null, reciter: null, surah: null, loading: false, reconnect: false, error: null };
const listeners = new Set<() => void>();

// radio connection bookkeeping — سلّم الاتصال بيتأكد إن الصوت يشتغل دايمًا
let radioTries = 0;
let connectSeq = 0; // يبطل أي اتصال قديم لما يبدأ اتصال جديد (يمنع سباقات التبديل)
let radioStallTimer: ReturnType<typeof setTimeout> | null = null;
let radioRetryTimer: ReturnType<typeof setTimeout> | null = null;
let lastStation: Station = "cairo";
let lastAudioProgressAt = 0;

export function getQState(): QState { return qState; }
export function getSharedAudio(): HTMLAudioElement | null { return sharedAudio; }
export function subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; }
export function getVolume(): number { return sharedVolume; }

export function setEngineVolume(v: number): void {
  sharedVolume = v;
  if (sharedAudio) sharedAudio.volume = v;
}

/** يفشل لو play() معلّقة أكتر من المهلة (مصدر بطيء/محجوب) */
function withTimeout(p: Promise<unknown>, ms: number) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("connect-timeout")), ms);
    p.then(
      () => { clearTimeout(t); resolve(null); },
      (e: unknown) => { clearTimeout(t); reject(e instanceof Error ? e : new Error("play-failed")); },
    );
  });
}

function clearRadioStall() {
  if (radioStallTimer) { clearTimeout(radioStallTimer); radioStallTimer = null; }
}

function scheduleStallRecover() {
  if (qState.kind !== "radio" || qState.loading) return;
  if (radioStallTimer) return;
  radioStallTimer = setTimeout(recoverRadio, 5_000);
}

function notify() { listeners.forEach((l) => l()); }
function setState(patch: Partial<QState>) { qState = { ...qState, ...patch }; notify(); }

function getAudio() {
  if (!sharedAudio) {
    sharedAudio = new Audio();
    sharedAudio.preload = "none";
    sharedAudio.volume = sharedVolume;
    sharedAudio.addEventListener("pause", notify);
    sharedAudio.addEventListener("playing", notify);
    sharedAudio.addEventListener("playing", () => {
      lastAudioProgressAt = Date.now();
      clearRadioStall();
    });
    // التقطيع/انتظار البافر: لو استمر 5 ثواني — استرجاع
    sharedAudio.addEventListener("stalled", scheduleStallRecover);
    sharedAudio.addEventListener("waiting", scheduleStallRecover);
    // خطأ شبكة أثناء البث المباشر → قفزة فورية للمرآة التالية (سلوك النسخة الأولى)
    sharedAudio.addEventListener("error", () => {
      if (qState.kind !== "radio" || qState.loading) return;
      recoverRadio();
    });
    sharedAudio.addEventListener("timeupdate", () => {
      lastAudioProgressAt = Date.now();
      clearRadioStall(); // البيانات رجعت تتحرك — ألغِ أي استرجاع مجدول
      notify();
    });
    sharedAudio.addEventListener("loadedmetadata", notify);
    // البث المجمد أحيانًا مش بيبعت stalled خالص — حارس زمني: الصوت شغال
    // رسميًا لكن الزمن واقف 9 ثواني = بث متجمد → استرجاع فوري
    setInterval(() => {
      if (qState.kind !== "radio" || qState.loading || !sharedAudio || sharedAudio.paused) return;
      if (!lastAudioProgressAt || Date.now() - lastAudioProgressAt < 9_000) return;
      if (radioStallTimer) return;
      radioStallTimer = setTimeout(recoverRadio, 300);
    }, 3_000);
    // auto-advance inside the surah list (reciter mode only)
    sharedAudio.addEventListener("ended", () => {
      if (qState.kind === "reciter" && qState.reciter && qState.surah !== null) {
        const next = (qState.surah + 1) % SURAHS.length;
        void playSurah(qState.reciter, next);
      } else if (qState.kind === "radio") {
        recoverRadio(); // البث المباشر انقطع — بيعيد الاتصال بنفس المحطة
      } else {
        setState({ kind: null, station: null, reciter: null, surah: null, loading: false });
      }
    });
  }
  return sharedAudio;
}

/** قاعدة المنتج: صوت القرآن أونلاين فقط — مفيش تشغيل من غير إنترنت.
 * الصوت بيتشغّل من البث مباشرةً وأول ما يرجع النت الزر يشتغل تاني. */
function offlineNow(): boolean {
  return typeof navigator !== "undefined" && typeof navigator.onLine === "boolean" && !navigator.onLine;
}

/** سلّم اتصال الإذاعة — من الأسرع للأضمن:
 * 1) مرايا https مباشرة — المتصفح بتابع تحويلة radiojar بنفسه
 *    (المتصفحات الحديثة بترقّي الصوت المختلط تلقائيًا لـ https فالمرآة بتشتغل)
 * 2) مرآة ما لعبتش — اللي بعدها فورًا بترتيب عشوائي (كل زيارة بتاخد توكن جديد)
 * 3) كل المرايا فشلت — رسالة فشل واضحة + زر إعادة المحاولة */
export async function playRadio(st: Station, isRetry = false) {
  if (offlineNow()) {
    failOffline();
    return;
  }
  const a = getAudio();
  const seq = ++connectSeq;
  lastStation = st;
  clearRadioStall();
  if (radioRetryTimer) { clearTimeout(radioRetryTimer); radioRetryTimer = null; }
  setState({ kind: "radio", station: st, reciter: null, surah: null, loading: true, reconnect: isRetry, error: null });
  // قرآن أونلاين فقط: لا يوجد تخزين مسبق — البث يبدأ فقط عند التشغيل
  a.preload = "none";

  // مرايا بترتيب عشوائي — أول واحدة بتشتغل تكفي
  const mirrors = stationMirrors(st).slice();
  for (let i = mirrors.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = mirrors[i]!; mirrors[i] = mirrors[j]!; mirrors[j] = tmp;
  }
  for (const mirror of mirrors) {
    a.src = mirror;
    try {
      await withTimeout(a.play(), 8_000); // مهلة 8 ثواني لكل مرآة
      if (seq !== connectSeq) return;
      radioTries = 0;
      setState({ loading: false });
      return;
    } catch {
      if (seq !== connectSeq) return;
      // المرآة دي ما لعبتش — اللي بعدها (كل محاولة بتاخد توكن جديد)
    }
  }

  // كل المرايا فشلت — رسالة واضحة وزر إعادة المحاولة
  failRadio();
}

/** استرجاع البث لو انقطع أثناء التشغيل: إعادة السلّم كامل (توكن جديد أولًا)
 * — أول محاولتين فورية (بافر المتصفح بيغطي الفجوة) وبعدين تأخير متدرّج */
function recoverRadio() {
  if (qState.kind !== "radio" || qState.loading || !qState.station) return;
  const st = qState.station;
  if (radioTries >= 5) {
    failRadio();
    return;
  }
  radioTries += 1;
  setState({ reconnect: true });
  if (radioRetryTimer) clearTimeout(radioRetryTimer);
  if (radioTries <= 2) {
    void playRadio(st, true);
    return;
  }
  radioRetryTimer = setTimeout(() => {
    radioRetryTimer = null;
    if (qState.kind !== "radio" || qState.station !== st) return;
    void playRadio(st, true);
  }, Math.min(1000 * radioTries, 4_000));
}

/** فشل نهائي بعد كل المحاولات — رسالة واضحة وزر إعادة المحاولة */
function failRadio() {
  radioTries = 0;
  const a = sharedAudio;
  if (a) { a.pause(); a.removeAttribute("src"); }
  setState({ kind: null, station: null, loading: false, reconnect: false, error: offlineNow() ? "offline" : "radio" });
}

/** رسالة «محتاج إنترنت» — قاعدة القرآن أونلاين فقط */
function failOffline() {
  radioTries = 0;
  const a = sharedAudio;
  if (a) { a.pause(); a.removeAttribute("src"); }
  setState({ kind: null, station: null, reciter: null, surah: null, loading: false, reconnect: false, error: "offline" });
}

/** زر «حاول تاني» — يعيد آخر محطة كانت مقصودة */
export function retryRadio() {
  void playRadio(lastStation);
}

export async function playSurah(recKey: string, idx: number, useFb = false) {
  if (offlineNow()) {
    failOffline();
    return;
  }
  const rec = RECITERS.find((r) => r.key === recKey);
  if (!rec) return;
  const surah = SURAHS[idx];
  if (surah == null) return;
  const a = getAudio();
  const seq = ++connectSeq;
  if (radioStallTimer) { clearTimeout(radioStallTimer); radioStallTimer = null; }
  setState({ kind: "reciter", station: null, reciter: recKey, surah: idx, loading: true, error: null });
  const base = useFb && rec.fb ? rec.fb : rec.base;
  a.src = surahUrl(base, surah);
  try {
    await a.play();
    if (seq !== connectSeq) return; // طلب أحدث صار — اتجاهَل
    setState({ loading: false });
  } catch {
    if (seq !== connectSeq) return;
    if (offlineNow()) {
      setState({ loading: false, error: "offline" });
      return;
    }
    if (!useFb && rec.fb) return playSurah(recKey, idx, true);
    setState({ loading: false, error: "reciter" });
  }
}

export function togglePause() {
  const a = getAudio();
  if (!a.src) return;
  if (a.paused) void a.play().catch(() => {});
  else a.pause();
}

export function stopAll() {
  const a = getAudio();
  clearRadioStall();
  if (radioRetryTimer) { clearTimeout(radioRetryTimer); radioRetryTimer = null; }
  a.pause();
  a.removeAttribute("src");
  setState({ kind: null, station: null, reciter: null, surah: null, loading: false, reconnect: false, error: null });
}

/** التنقل بين السور داخل قائمة التلاوات */
export function stepSurah(delta: number) {
  if (qState.kind !== "reciter" || qState.reciter === null || qState.surah === null) return;
  const next = (qState.surah + delta + SURAHS.length) % SURAHS.length;
  void playSurah(qState.reciter, next);
}

export function seekRatio(ratio: number) {
  const a = sharedAudio;
  if (!a || !a.src || !isFinite(a.duration) || a.duration <= 0) return;
  a.currentTime = Math.min(Math.max(ratio, 0), 1) * a.duration;
}

export function fmt(sec: number) {
  if (!isFinite(sec) || sec < 0) return "–:––";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}
