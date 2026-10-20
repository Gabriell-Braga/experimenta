// Assinatura AWS Signature Version 4 com Web Crypto (sem SDK): S3 e compatíveis (R2, GCS com chave HMAC).
// https://docs.aws.amazon.com/IAM/latest/UserGuide/create-signed-request.html — conferida com os vetores
// oficiais em sigv4.test.ts. Caminho no estilo do S3: cada segmento codificado uma vez, sem normalizar.

const enc = new TextEncoder();
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');

export async function sha256Hex(data: string | Uint8Array<ArrayBuffer>): Promise<string> {
  return hex(await crypto.subtle.digest('SHA-256', typeof data === 'string' ? enc.encode(data) : data));
}
async function hmac(key: ArrayBuffer | Uint8Array<ArrayBuffer>, data: string) {
  const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return crypto.subtle.sign('HMAC', k, enc.encode(data));
}

/** Codificação do SigV4: só A-Z a-z 0-9 - _ . ~ ficam como estão. */
export const awsEncode = (s: string) =>
  encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

export interface SigV4Credentials {
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  service: string;
}

/**
 * Assina uma requisição: devolve os cabeçalhos a enviar (os dados + `host`, `x-amz-date` e `authorization`).
 * Todos os cabeçalhos passados entram na assinatura. `payloadHash` = SHA-256 hex do corpo (no S3, mande
 * também em `x-amz-content-sha256`).
 */
export async function signV4(
  req: { method: string; url: string; headers?: Record<string, string>; payloadHash: string },
  cred: SigV4Credentials,
  now = new Date(),
): Promise<Record<string, string>> {
  const url = new URL(req.url);
  const amzDate = now
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');
  const day = amzDate.slice(0, 8);
  const headers: Record<string, string> = { host: url.host, 'x-amz-date': amzDate };
  for (const [k, v] of Object.entries(req.headers ?? {})) headers[k.toLowerCase()] = v;
  const names = Object.keys(headers).sort();
  const signed = names.join(';');
  const canonicalHeaders = names.map((k) => `${k}:${headers[k]!.trim().replace(/\s+/g, ' ')}\n`).join('');
  const path = decodeURIComponent(url.pathname)
    .split('/')
    .map((s) => awsEncode(s))
    .join('/');
  const query = [...url.searchParams]
    .map(([k, v]) => [awsEncode(k), awsEncode(v)] as const)
    .sort(([a, x], [b, y]) => (a < b ? -1 : a > b ? 1 : x < y ? -1 : x > y ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('&');
  const canonical = [req.method, path || '/', query, canonicalHeaders, signed, req.payloadHash].join('\n');
  const scope = `${day}/${cred.region}/${cred.service}/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, await sha256Hex(canonical)].join('\n');
  let key = await hmac(enc.encode(`AWS4${cred.secretAccessKey}`), day);
  for (const part of [cred.region, cred.service, 'aws4_request']) key = await hmac(key, part);
  const signature = hex(await hmac(key, toSign));
  return {
    ...headers,
    authorization: `AWS4-HMAC-SHA256 Credential=${cred.accessKeyId}/${scope}, SignedHeaders=${signed}, Signature=${signature}`,
  };
}
