export const normalizeNfcUid = (uid: string | null | undefined) =>
  (uid ?? "").trim().replace(/[\s:.-]/g, "").toLowerCase();
