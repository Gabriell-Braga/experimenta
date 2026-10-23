// URL alvo de experimento: só nos domínios do workspace e sem dados pessoais na URL (D-099).
// A API recusa (fronteira de confiança); o editor tira os parâmetros pessoais da página aberta e avisa.

/** E-mail em texto livre (também usado pelo maskPii da API). */
export const EMAIL_RE = /[\w.%+-]+@[\w-]+(?:\.[\w-]+)+/;
/** Nomes de parâmetro que costumam carregar dado pessoal. */
const PII_KEY =
  /^(e-?mail|mail|phone|telefone|fone|tel|celular|cel|mobile|whatsapp|cpf|cnpj|rg|nome|name|first_?name|last_?name|full_?name|sobrenome|nome_?completo|endereco|address|nascimento|birth_?date|dob)$/i;
const CPF_RE = /\d{3}\.\d{3}\.\d{3}-\d{2}/;

/** Valor com cara de telefone: 10 a 15 dígitos com `+`, parênteses, espaço ou hífen. Só dígitos não conta (ids). */
function isPhone(v: string): boolean {
  if (!/^\+?[\d\s().-]+$/.test(v) || !/[+\s()-]/.test(v)) return false;
  const n = v.replace(/\D/g, '').length;
  return n >= 10 && n <= 15;
}

/** Parâmetros da query com dado pessoal (pelo nome ou pelo valor: e-mail, CPF, telefone). */
export function piiParams(url: URL): string[] {
  const out = new Set<string>();
  for (const [k, v] of url.searchParams)
    if (PII_KEY.test(k) || EMAIL_RE.test(v) || CPF_RE.test(v) || isPhone(v)) out.add(k);
  return [...out];
}

/** Tira os parâmetros pessoais da URL (editor). URL inválida volta como veio. */
export function stripPii(href: string): { url: string; removed: string[] } {
  let u: URL;
  try {
    u = new URL(href);
  } catch {
    return { url: href, removed: [] };
  }
  const removed = piiParams(u);
  for (const k of removed) u.searchParams.delete(k);
  return { url: removed.length ? u.href : href, removed };
}

const LOCAL = new Set(['localhost', '127.0.0.1', '[::1]']);
const bare = (h: string) => h.replace(/^www\./, '');

/** O host é um dos sites do workspace (ou subdomínio dele)? localhost sempre vale (dev e testes do cliente). */
export function inWorkspace(url: URL, siteUrls: string[]): boolean {
  const h = url.hostname;
  if (LOCAL.has(h)) return true;
  return siteUrls.some((s) => {
    try {
      const d = bare(new URL(s).hostname);
      return bare(h) === d || h.endsWith(`.${d}`);
    } catch {
      return false;
    }
  });
}

/** Erro legível da URL alvo, ou null se pode ser usada. */
export function targetUrlError(href: string, siteUrls: string[]): string | null {
  let u: URL;
  try {
    u = new URL(href);
  } catch {
    return `URL inválida: ${href}`;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:')
    return 'A URL precisa começar com http:// ou https://.';
  if (!inWorkspace(u, siteUrls))
    return `${u.hostname} não é um site deste workspace. Use uma página de ${siteUrls.map((s) => s.replace(/^https?:\/\/|\/.*$/g, '')).join(', ') || '(cadastre o site do projeto)'}.`;
  const pii = piiParams(u);
  if (pii.length)
    return `A URL tem dados pessoais nos parâmetros ${pii.join(', ')}: tire-os antes de salvar (eles ficariam gravados no teste).`;
  let rest = u.pathname + u.hash;
  try {
    rest = decodeURIComponent(rest);
  } catch {
    /* fica cru */
  }
  if (EMAIL_RE.test(rest)) return 'A URL tem um e-mail no caminho: use uma página sem dados pessoais.';
  return null;
}
