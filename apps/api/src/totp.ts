// Login em duas etapas (fase 16.5): TOTP (RFC 6238) sobre HOTP (RFC 4226) com HMAC-SHA1 do Web Crypto,
// o mesmo código em Node e no Worker. Códigos de recuperação de uso único (só o hash fica guardado).
import { sha256hex } from './crypto';

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(bytes: Uint8Array): string {
  let out = '';
  let bits = 0;
  let value = 0;
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text: string): Uint8Array<ArrayBuffer> {
  const clean = text.toUpperCase().replace(/[\s=-]/g, '');
  const out: number[] = [];
  let bits = 0;
  let value = 0;
  for (const ch of clean) {
    const i = B32.indexOf(ch);
    if (i < 0) throw new Error('base32 inválido');
    value = ((value << 5) | i) & 0xffff;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Uint8Array.from(out);
}

/** HOTP (RFC 4226): HMAC-SHA1 do contador (8 bytes big-endian) + truncamento dinâmico. */
export async function hotp(key: Uint8Array<ArrayBuffer>, counter: number, digits = 6): Promise<string> {
  const msg = new DataView(new ArrayBuffer(8));
  msg.setUint32(0, Math.floor(counter / 2 ** 32));
  msg.setUint32(4, counter >>> 0);
  const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const h = new Uint8Array(await crypto.subtle.sign('HMAC', k, msg.buffer));
  const o = h[19]! & 15;
  const bin = ((h[o]! & 0x7f) << 24) | (h[o + 1]! << 16) | (h[o + 2]! << 8) | h[o + 3]!;
  return String(bin % 10 ** digits).padStart(digits, '0');
}

export const TOTP_STEP_S = 30;
export const stepAt = (ms: number) => Math.floor(ms / 1000 / TOTP_STEP_S);

/** Segredo novo: 20 bytes (160 bits, o tamanho do HMAC-SHA1), em base32 para o app autenticador. */
export const newTotpSecret = () => base32Encode(crypto.getRandomValues(new Uint8Array(20)));

/**
 * Confere um código de 6 dígitos aceitando ±1 passo (relógio do celular fora por até 30 s).
 * Devolve o passo usado, ou null. Passos <= `lastStep` são recusados: o mesmo código não vale duas vezes.
 */
export async function verifyTotp(
  secret: string,
  code: string,
  lastStep = -1,
  now = Date.now(),
): Promise<number | null> {
  const c = code.replace(/\s/g, '');
  if (!/^\d{6}$/.test(c)) return null;
  const key = base32Decode(secret);
  const step = stepAt(now);
  for (const s of [step, step - 1, step + 1]) if (s > lastStep && (await hotp(key, s)) === c) return s;
  return null;
}

/** URI que os apps autenticadores leem (Google Authenticator, 1Password, Authy…), também como QR. */
export const otpauthUri = (secret: string, email: string, issuer = 'Experimenta') =>
  `otpauth://totp/${encodeURIComponent(`${issuer}:${email}`)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=${TOTP_STEP_S}`;

/** Códigos de recuperação: `XXXXX-XXXXX` em base32 (50 bits cada). */
export function newRecoveryCodes(n = 10): string[] {
  return Array.from({ length: n }, () => {
    const s = base32Encode(crypto.getRandomValues(new Uint8Array(7))).slice(0, 10);
    return `${s.slice(0, 5)}-${s.slice(5)}`;
  });
}
/** Hash do código normalizado (maiúsculas, sem traço/espaço): o usuário pode digitar de qualquer jeito. */
export const hashRecoveryCode = (code: string) => sha256hex(`rc:${code.toUpperCase().replace(/[\s-]/g, '')}`);
