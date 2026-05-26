/**
 * Hash SHA-256 d'un payload JSON pour cle de cache.
 * Utilise Web Crypto disponible nativement dans Cloudflare Workers.
 */
export async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const buf = await crypto.subtle.digest('SHA-256', data);
  const bytes = new Uint8Array(buf);
  let out = '';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
}
