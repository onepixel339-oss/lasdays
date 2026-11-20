// ═══════════════ Ambient soundscapes — real recorded loops (CC0), gapless via WebAudio ═══════════════
// تسجيلات حقيقية (مطر/مقهى/أمواج/رياح/ضوضاء بيضاء/بنية) بدل التوليف الصوتي —
// الملف بيتحمّل أول مرة بس ويتفك في الذاكرة، واللوب عبر AudioBufferSourceNode بلا أي فجوة مسموعة.
// مشهد واحد في المرة — نفس واجهة المحرك القديم (ambStart / ambStop / ambSetVolume).

export type AmbKey = "rain" | "cafe" | "waves" | "wind" | "white" | "brown";

export const AMB_KEYS: AmbKey[] = ["rain", "cafe", "waves", "wind", "white", "brown"];

const URLS: Record<AmbKey, string> = {
  rain: "/sounds/rain.mp3",
  cafe: "/sounds/cafe.mp3",
  waves: "/sounds/waves.mp3",
  wind: "/sounds/wind.mp3",
  white: "/sounds/white.mp3",
  brown: "/sounds/brown.mp3",
};

interface EngineState {
  ctx: AudioContext | null;
  current: { key: AmbKey; src: AudioBufferSourceNode; gain: GainNode } | null;
  buffers: Map<AmbKey, AudioBuffer>;
  pending: Map<AmbKey, Promise<AudioBuffer>>;
  seq: number;
}

const G = globalThis as unknown as { __ldAmb2?: EngineState };
function state(): EngineState {
  if (!G.__ldAmb2) {
    G.__ldAmb2 = { ctx: null, current: null, buffers: new Map(), pending: new Map(), seq: 0 };
  }
  return G.__ldAmb2;
}

function getCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const s = state();
  if (!s.ctx) {
    try {
      s.ctx = new AudioContext();
    } catch {
      return null; // متصفح بدون دعم — صمت
    }
  }
  if (s.ctx.state === "suspended") void s.ctx.resume();
  return s.ctx;
}

/** تحميل الصوت وفك ترميزه — مرة واحدة لكل مشهد ثم من الذاكرة */
function getBuffer(key: AmbKey, ctx: AudioContext): Promise<AudioBuffer> {
  const s = state();
  const cached = s.buffers.get(key);
  if (cached) return Promise.resolve(cached);
  let p = s.pending.get(key);
  if (!p) {
    p = (async () => {
      const res = await fetch(URLS[key]);
      if (!res.ok) throw new Error("sound-missing");
      const arr = await res.arrayBuffer();
      const buf = await ctx.decodeAudioData(arr);
      s.buffers.set(key, buf);
      return buf;
    })().finally(() => s.pending.delete(key));
    s.pending.set(key, p);
  }
  return p;
}

/** تشغيل مشهد — بيتفادى التداخل لو المستخدم داس على مشاهد بسرعة */
export async function ambStart(key: AmbKey, volume = 0.6): Promise<void> {
  const ctx = getCtx();
  if (!ctx) return;
  ambStop();
  const s = state();
  const mySeq = ++s.seq;
  try {
    const buf = await getBuffer(key, ctx);
    if (mySeq !== s.seq) return; // طلب أحدث صار في أثناء التحميل — اتجاهَل
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const gain = ctx.createGain();
    // fade-in قصير — بيمسح أي نقرة صوتية عند البداية
    gain.gain.setValueAtTime(0, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(volume, ctx.currentTime + 0.25);
    src.connect(gain);
    gain.connect(ctx.destination);
    src.start();
    s.current = { key, src, gain };
  } catch {
    /* فشل تحميل (أوفلاين مثلًا) — صمت بلا إزعاج */
  }
}

/** إيقاف المشهد الحالي — fade-out قصير بدل قطع مباغت */
export function ambStop(): void {
  const s = state();
  s.seq++;
  const cur = s.current;
  if (!cur) return;
  s.current = null;
  try {
    const ctx = s.ctx;
    if (!ctx) return;
    cur.gain.gain.cancelScheduledValues(ctx.currentTime);
    cur.gain.gain.setValueAtTime(cur.gain.gain.value, ctx.currentTime);
    cur.gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.12);
    setTimeout(() => {
      try {
        cur.src.stop();
        cur.src.disconnect();
        cur.gain.disconnect();
      } catch { /* already stopped */ }
    }, 180);
  } catch { /* ignore */ }
}

/** تغيير مستوى صوت المشهد الشغّال */
export function ambSetVolume(v: number): void {
  const s = state();
  if (!s.current || !s.ctx) return;
  try {
    s.current.gain.gain.cancelScheduledValues(s.ctx.currentTime);
    s.current.gain.gain.setTargetAtTime(v, s.ctx.currentTime, 0.05);
  } catch { /* ignore */ }
}
