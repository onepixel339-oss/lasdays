// ═══════════════ Radio stations — مصدر واحد للحقيقة (single source of truth) ═══════════════
// كل المرايا لنفس البث — نقاط دخول مختلفة فقط على عُقد radiojar.
// المستهلك: مشغّل القرآن على الكلاينت (سلّم المرايا في quran-player.ts) —
// مفيش سيرفر للتطبيق؛ المتصفح بتابع تحويلة radiojar بنفسه.

export type RadioStation = "cairo" | "saudi";

export const RADIO_STATIONS: Record<RadioStation, string[]> = {
  // إذاعة القرآن الكريم من القاهرة
  cairo: [
    "https://n0b.radiojar.com/8s5u5tpdtwzuv",
    "https://stream.radiojar.com/8s5u5tpdtwzuv",
    "https://n03.radiojar.com/8s5u5tpdtwzuv",
    "https://n04.radiojar.com/8s5u5tpdtwzuv",
  ],
  // إذاعة القرآن الكريم من السعودية (هيئة الإذاعة والتلفزيون)
  saudi: [
    "https://stream.radiojar.com/0tpy1h0kxtzuv",
    "https://n09.radiojar.com/0tpy1h0kxtzuv",
    "https://n01.radiojar.com/0tpy1h0kxtzuv",
  ],
};

/** مرايا محطة — برجوع لالقاهرة لأي قيمة غير معروفة (آمن افتراضيًا) */
export function stationMirrors(s: string): string[] {
  return s in RADIO_STATIONS ? RADIO_STATIONS[s as RadioStation] : RADIO_STATIONS.cairo;
}
