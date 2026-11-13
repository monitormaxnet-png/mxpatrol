/** Constant-time check that an Authorization header carries the exact service-role key. */
export function isServiceRoleBearer(header: string | null | undefined, serviceKey: string | null | undefined): boolean {
  if (!header || !serviceKey) return false;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (!match) return false;
  const a = new TextEncoder().encode(match[1]);
  const b = new TextEncoder().encode(serviceKey);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}
