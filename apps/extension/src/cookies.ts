/**
 * Durante a sessão de edição o site roda num iframe de outro site (o editor): o navegador não envia cookies
 * SameSite=Lax/Strict e o usuário aparece deslogado. Aqui os cookies do site viram `SameSite=None; Secure`
 * enquanto a sessão durar, guardando o valor original para restaurar no fim (ver docs/DECISOES.md D-034).
 */

export interface SavedCookie {
  url: string;
  name: string;
  /** Ausente = cookie host-only. */
  domain?: string;
  path: string;
  storeId: string;
  sameSite: chrome.cookies.SameSiteStatus;
  secure: boolean;
}

/** Subconjunto de chrome.cookies usado (injetável nos testes). */
export interface CookiesApi {
  getAll(d: { url: string }): Promise<chrome.cookies.Cookie[]>;
  get(d: { url: string; name: string; storeId?: string }): Promise<chrome.cookies.Cookie | null>;
  set(d: chrome.cookies.SetDetails): Promise<chrome.cookies.Cookie | null>;
}

/** `Secure` só pode ser gravado em https ou em localhost/127.0.0.1. */
export const canBeSecure = (origin: string) =>
  /^https:|^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|$)/.test(origin);

/** O cookie pertence ao host do site? (domínio exato ou superdomínio com ponto). */
export function cookieMatchesOrigin(c: Pick<chrome.cookies.Cookie, 'domain'>, origin: string): boolean {
  const host = new URL(origin).hostname;
  const d = c.domain.replace(/^\./, '');
  return host === d || host.endsWith(`.${d}`);
}

const details = (
  c: chrome.cookies.Cookie,
  url: string,
  sameSite: chrome.cookies.SameSiteStatus,
  secure: boolean,
) => ({
  url,
  name: c.name,
  value: c.value,
  path: c.path,
  storeId: c.storeId,
  httpOnly: c.httpOnly,
  sameSite,
  secure,
  ...(c.hostOnly ? {} : { domain: c.domain }),
  ...(c.session ? {} : { expirationDate: c.expirationDate }),
});

/** Passa para SameSite=None os cookies do site (todos, ou só `only`) e devolve o que restaurar depois. */
export async function relaxCookies(
  api: CookiesApi,
  origin: string,
  only?: chrome.cookies.Cookie[],
): Promise<SavedCookie[]> {
  if (!canBeSecure(origin)) return [];
  const url = `${origin}/`;
  const list = only ?? (await api.getAll({ url }));
  const saved: SavedCookie[] = [];
  for (const c of list) {
    if (c.sameSite === 'no_restriction' || !cookieMatchesOrigin(c, origin)) continue;
    await api.set(details(c, url, 'no_restriction', true));
    saved.push({
      url,
      name: c.name,
      ...(c.hostOnly ? {} : { domain: c.domain }),
      path: c.path,
      storeId: c.storeId,
      sameSite: c.sameSite,
      secure: c.secure,
    });
  }
  return saved;
}

/** Devolve SameSite/Secure originais aos cookies que ainda existem (valor atual preservado). */
export async function restoreCookies(api: CookiesApi, saved: SavedCookie[]): Promise<void> {
  for (const s of saved) {
    const cur = await api.get({ url: s.url, name: s.name, storeId: s.storeId });
    if (!cur || cur.sameSite !== 'no_restriction') continue;
    await api.set(details(cur, s.url, s.sameSite, s.secure));
  }
}
