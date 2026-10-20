import { b64url } from './crypto';

// Token OAuth do Google com conta de serviço, sem SDK: JWT RS256 assinado com Web Crypto e trocado no endpoint
// de token (fluxo "JWT bearer", https://developers.google.com/identity/protocols/oauth2/service-account).

export interface ServiceAccount {
  client_email: string;
  private_key: string;
}

/** Lê o JSON da chave da conta de serviço; null se não for uma. */
export function parseServiceAccount(text: string): ServiceAccount | null {
  try {
    const j = JSON.parse(text) as Partial<ServiceAccount>;
    if (typeof j.client_email !== 'string' || !/^[^\s@]+@[^\s@]+$/.test(j.client_email)) return null;
    if (typeof j.private_key !== 'string' || !j.private_key.includes('BEGIN PRIVATE KEY')) return null;
    return { client_email: j.client_email, private_key: j.private_key };
  } catch {
    return null;
  }
}

const enc = new TextEncoder();

/** PEM PKCS#8 → chave de assinatura RSASSA-PKCS1-v1_5 / SHA-256. */
async function importKey(pem: string) {
  const der = Uint8Array.from(atob(pem.replace(/-----(BEGIN|END) PRIVATE KEY-----|\s/g, '')), (c) =>
    c.charCodeAt(0),
  );
  return crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, [
    'sign',
  ]);
}

/** JWT assinado com RS256. */
export async function signJwt(claims: Record<string, unknown>, pem: string): Promise<string> {
  const part = (o: unknown) => b64url(enc.encode(JSON.stringify(o)));
  const input = `${part({ alg: 'RS256', typ: 'JWT' })}.${part(claims)}`;
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', await importKey(pem), enc.encode(input));
  return `${input}.${b64url(new Uint8Array(sig))}`;
}

export const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';

/**
 * Token de acesso (1 h) para o escopo pedido. O endereço do token é fixo (não vem do JSON da chave: a API
 * não chama endereços escolhidos pelo cliente); só os testes o trocam.
 */
export async function googleAccessToken(
  sa: ServiceAccount,
  scope: string,
  opts: { tokenUrl?: string; now?: number; timeoutMs?: number } = {},
): Promise<string> {
  const iat = Math.floor((opts.now ?? Date.now()) / 1000);
  const assertion = await signJwt(
    { iss: sa.client_email, scope, aud: GOOGLE_TOKEN_URL, iat, exp: iat + 3600 },
    sa.private_key,
  );
  const r = await fetch(opts.tokenUrl ?? GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }).toString(),
    signal: AbortSignal.timeout(opts.timeoutMs ?? 15_000),
  });
  const j = (await r.json().catch(() => ({}))) as { access_token?: string; error_description?: string };
  if (!r.ok || !j.access_token)
    throw new Error(`Google recusou a conta de serviço (${r.status}): ${j.error_description ?? 'sem token'}`);
  return j.access_token;
}
