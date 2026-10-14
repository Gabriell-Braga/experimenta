import { expect, test, type Page } from '@playwright/test';

const APP = 'http://localhost:5173';
const SITE = 'http://localhost:5180';

/**
 * Página "host" que imita o app do editor: cria a sessão na API, abre o site num iframe com ?abt_edit,
 * responde ao hello do snippet e espera o evento `ready` do agent.
 */
function hostHtml(opts: { token?: string; ackToken?: string } = {}) {
  return `<!doctype html><html><body><iframe id="f" style="width:1000px;height:700px"></iframe><script>
  (async () => {
    let token = ${JSON.stringify(opts.token ?? null)};
    if (!token) {
      const r = await fetch('http://localhost:4000/edit-sessions', { method: 'POST', headers: {'content-type':'application/json'}, body: JSON.stringify({ accountId: 'demo' }) }).catch(() => null);
      window.__status = r ? r.status : 'bloqueado-cors';
      if (!r) return;
      if (!r.ok) return;
      token = (await r.json()).token;
    }
    window.__token = token;
    const f = document.getElementById('f');
    window.addEventListener('message', (e) => {
      if (e.origin !== '${SITE}' || e.source !== f.contentWindow) return;
      if (e.data && e.data.kind === 'hello') { window.__hello = true; f.contentWindow.postMessage({ abt: 1, kind: 'hello-ack', token: ${JSON.stringify(opts.ackToken ?? null)} || token }, '${SITE}'); }
      if (e.data && e.data.kind === 'evt' && e.data.event === 'ready') window.__ready = e.data.payload;
    });
    f.src = '${SITE}/?abt_edit=' + encodeURIComponent(token);
  })();
  </script></body></html>`;
}

async function openHost(page: Page, origin: string, html: string) {
  await page.route(`${origin}/host`, (r) => r.fulfill({ contentType: 'text/html', body: html }));
  await page.goto(`${origin}/host`);
}

const agentLoaded = (page: Page) => page.frameLocator('#f').locator('script[src$="/agent.js"]').count();

test('handshake completo: token válido + origin exato → agent carrega e emite ready', async ({ page }) => {
  await openHost(page, APP, hostHtml());
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __ready?: { url: string } }).__ready?.url))
    .toContain(`${SITE}/?abt_edit=`);
  // Modo edição não aplica experimentos nem mostra eventos de visitante.
  expect(await page.frameLocator('#f').locator('style[data-abt-antiflicker]').count()).toBe(0);
});

test('origin fora da lista não consegue criar sessão (CORS bloqueia; a API também responde 403)', async ({
  page,
  request,
}) => {
  await openHost(page, 'http://localhost:5174', hostHtml());
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __status?: unknown }).__status))
    .toBe('bloqueado-cors');
  const direct = await request.post('http://localhost:4000/edit-sessions', {
    headers: { origin: 'http://localhost:5174' },
    data: { accountId: 'demo' },
  });
  expect(direct.status()).toBe(403);
});

test('página maliciosa com token roubado não recebe o hello nem carrega o agent', async ({
  page,
  request,
}) => {
  const res = await request.post('http://localhost:4000/edit-sessions', {
    headers: { origin: APP },
    data: { accountId: 'demo' },
  });
  const { token } = await res.json();
  await openHost(page, 'http://localhost:5174', hostHtml({ token }));
  await page.frameLocator('#f').locator('#hero-title').waitFor();
  await page.waitForTimeout(1500);
  expect(await page.evaluate(() => (window as unknown as { __hello?: boolean }).__hello)).toBeUndefined();
  expect(await agentLoaded(page)).toBe(0);
});

test('ack com token errado não carrega o agent; token inválido nem inicia', async ({ page }) => {
  await openHost(page, APP, hostHtml({ ackToken: 'errado' }));
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __hello?: boolean }).__hello))
    .toBe(true);
  await page.waitForTimeout(500);
  expect(await agentLoaded(page)).toBe(0);

  await openHost(page, APP, hostHtml({ token: 'token-falso' }));
  await page.frameLocator('#f').locator('#hero-title').waitFor();
  await page.waitForTimeout(1000);
  expect(await page.evaluate(() => (window as unknown as { __hello?: boolean }).__hello)).toBeUndefined();
});

test('site aberto direto (fora de iframe) com ?abt_edit roda normal, sem agent', async ({ page }) => {
  await page.goto(`${SITE}/?abt_edit=qualquer`);
  await page.waitForTimeout(500);
  expect(await page.locator('script[src$="/agent.js"]').count()).toBe(0);
  expect(await page.evaluate(() => typeof (window as unknown as { abt?: unknown }).abt)).toBe('object');
});
