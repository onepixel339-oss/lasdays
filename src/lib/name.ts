// ═══════════════ Name validation — used by the local profile store ═══════════════
// One set of rules for the onboarding screen and the LocalStore (same behavior
// the original server auth applied — kept identical so historical data matches).

/** Lowercased, whitespace-collapsed, trimmed login key. Unique per account. */
export function normalizeName(raw: string): string {
  return raw.trim().replace(/\s+/g, " ").toLowerCase();
}

export function isValidName(raw: string): boolean {
  const name = raw.trim();
  if (name.length < 3 || name.length > 24) return false;
  if (/\s/.test(name) && name.replace(/\s/g, "").length < 3) return false;
  // no control characters
  if (/[\u0000-\u001f\u007f]/.test(name)) return false;
  return true;
}

export function isReservedName(normalizedKey: string): boolean {
  return normalizedKey.startsWith("guest_");
}
