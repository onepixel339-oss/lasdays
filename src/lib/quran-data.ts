// ═══════════════ Quran data: stations + curated surahs + reciters ═══════════════

export type Station = "cairo" | "saudi";
export const STATIONS = ["cairo", "saudi"] as const;

export const stationLabel = (s: Station) => (s === "saudi" ? "quran.radioSaudi" : "quran.radio");
export const stationLive = (s: Station) => (s === "saudi" ? "quran.radioSaudiLive" : "quran.radioLive");

// سور مختارة — تشكيلة ثابتة
export const SURAHS = [1, 2, 3, 12, 18, 19, 36, 55, 56, 67, 73, 78];

export const RECITERS: { key: string; base: string; fb: string | null }[] = [
  {
    key: "husary",
    base: "https://download.quranicaudio.com/quran/mahmood_khaleel_al-husaree_iza3a/",
    fb: "https://download.quranicaudio.com/quran/mahmood_khaleel_al-husaree/",
  },
  {
    key: "basit",
    base: "https://download.quranicaudio.com/quran/abdul_basit_murattal/",
    fb: "https://download.quranicaudio.com/quran/abdulbaset_mujawwad/",
  },
  {
    key: "minsh",
    base: "https://download.quranicaudio.com/quran/muhammad_siddeeq_al-minshaawee/",
    fb: "https://download.quranicaudio.com/quran/minshawi_mujawwad/",
  },
  {
    key: "ajamy",
    base: "https://download.quranicaudio.com/quran/ahmed_ibn_3ali_al-3ajamy/",
    fb: null,
  },
];

export const surahUrl = (base: string, num: number) => base + String(num).padStart(3, "0") + ".mp3";
