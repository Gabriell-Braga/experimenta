import { expect, test } from 'vitest';
import {
  base32Decode,
  base32Encode,
  hashRecoveryCode,
  hotp,
  newRecoveryCodes,
  newTotpSecret,
  otpauthUri,
  verifyTotp,
} from './totp';

const enc = (s: string) => new TextEncoder().encode(s);
const RFC_KEY = enc('12345678901234567890');

test('base32 (RFC 4648): vetores e ida e volta', () => {
  expect(base32Encode(enc('foobar'))).toBe('MZXW6YTBOI');
  expect(base32Encode(enc('f'))).toBe('MY');
  expect(new TextDecoder().decode(base32Decode('mzxw 6ytb-oi======'))).toBe('foobar');
  const s = newTotpSecret();
  expect(s).toMatch(/^[A-Z2-7]{32}$/);
  expect(base32Encode(base32Decode(s))).toBe(s);
  expect(() => base32Decode('1!')).toThrow();
});

test('HOTP: vetores do RFC 4226 (apêndice D)', async () => {
  const want = [
    '755224',
    '287082',
    '359152',
    '969429',
    '338314',
    '254676',
    '287922',
    '162583',
    '399871',
    '520489',
  ];
  for (let i = 0; i < want.length; i++) expect(await hotp(RFC_KEY, i)).toBe(want[i]);
});

test('TOTP: vetores SHA-1 do RFC 6238 (apêndice B, 8 dígitos)', async () => {
  const cases: [number, string][] = [
    [59, '94287082'],
    [1111111109, '07081804'],
    [1111111111, '14050471'],
    [1234567890, '89005924'],
    [2000000000, '69279037'],
    [20000000000, '65353130'],
  ];
  for (const [t, code] of cases) expect(await hotp(RFC_KEY, Math.floor(t / 30), 8)).toBe(code);
});

test('verifyTotp: aceita ±1 passo, recusa replay, fora da janela e formato errado', async () => {
  const secret = base32Encode(RFC_KEY);
  const now = 1111111111_000;
  const step = Math.floor(now / 30_000);
  const code = await hotp(RFC_KEY, step);
  expect(await verifyTotp(secret, code, -1, now)).toBe(step);
  expect(await verifyTotp(secret, code.slice(0, 3) + ' ' + code.slice(3), -1, now)).toBe(step);
  expect(await verifyTotp(secret, await hotp(RFC_KEY, step - 1), -1, now)).toBe(step - 1);
  expect(await verifyTotp(secret, await hotp(RFC_KEY, step + 1), -1, now)).toBe(step + 1);
  expect(await verifyTotp(secret, await hotp(RFC_KEY, step - 2), -1, now)).toBeNull();
  expect(await verifyTotp(secret, code, step, now)).toBeNull(); // já usado
  expect(await verifyTotp(secret, 'abcdef', -1, now)).toBeNull();
  expect(await verifyTotp(secret, '1234567', -1, now)).toBeNull();
});

test('códigos de recuperação e URI otpauth', async () => {
  const codes = newRecoveryCodes();
  expect(codes).toHaveLength(10);
  expect(new Set(codes).size).toBe(10);
  for (const c of codes) expect(c).toMatch(/^[A-Z2-7]{5}-[A-Z2-7]{5}$/);
  expect(await hashRecoveryCode(codes[0]!.toLowerCase().replace('-', ' '))).toBe(
    await hashRecoveryCode(codes[0]!),
  );
  expect(otpauthUri('ABC', 'a@b.com')).toBe(
    'otpauth://totp/Experimenta%3Aa%40b.com?secret=ABC&issuer=Experimenta&algorithm=SHA1&digits=6&period=30',
  );
});
