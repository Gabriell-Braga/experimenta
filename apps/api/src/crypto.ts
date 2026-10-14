// Só Web Crypto: o mesmo código roda em Node 22 e em Cloudflare Workers.

const enc = new TextEncoder();

export const b64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
const fromB64url = (s: string): Uint8Array<ArrayBuffer> =>
  Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

export const randomToken = (bytes = 24) => b64url(crypto.getRandomValues(new Uint8Array(bytes)));
export const newId = (prefix: string) => `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;

/** Workers limita PBKDF2 a 100 mil iterações. */
const ITERATIONS = 100_000;

async function pbkdf2(
  password: string,
  salt: Uint8Array<ArrayBuffer>,
  iterations: number,
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    key,
    256,
  );
  return new Uint8Array(bits);
}

/** Formato: `pbkdf2:<iterações>:<salt>:<hash>` (base64url). */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2:${ITERATIONS}:${b64url(salt)}:${b64url(await pbkdf2(password, salt, ITERATIONS))}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [kind, iter, salt, hash] = stored.split(':');
  if (kind !== 'pbkdf2' || !iter || !salt || !hash) return false;
  const actual = await pbkdf2(password, fromB64url(salt), Number(iter));
  const expected = fromB64url(hash);
  // Comparação em tempo constante.
  let diff = actual.length ^ expected.length;
  for (let i = 0; i < actual.length; i++) diff |= actual[i]! ^ (expected[i] ?? 0);
  return diff === 0;
}

export async function sha1(text: string): Promise<string> {
  return b64url(new Uint8Array(await crypto.subtle.digest('SHA-1', enc.encode(text))));
}
