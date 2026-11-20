// ═══════════════ StoreError — one error shape for both stores ═══════════════
// `code` matches the API error codes the UI already maps to i18n strings
// ("no_account", "username_taken", "title_required", …).

export class StoreError extends Error {
  code: string;
  status: number;
  constructor(code: string, status = 400) {
    super(code);
    this.name = "StoreError";
    this.code = code;
    this.status = status;
  }
}

export function fail(code: string, status = 400): never {
  throw new StoreError(code, status);
}
