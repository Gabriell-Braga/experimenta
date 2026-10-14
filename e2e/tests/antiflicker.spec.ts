import { expect, test, type Page } from '@playwright/test';
import { PNG } from 'pngjs';
import { experiment, makeConfig, serveSnippet } from '../helpers';

interface Frame {
  t: number;
  title?: { text: string; visible: boolean };
  cta?: { bg: string; visible: boolean };
  subtitle?: { visible: boolean };
  banner?: { text: string; visible: boolean };
  htmlOpacity: string;
}

/** Amostra, a cada frame (rAF), o que está visível — desde antes do primeiro script da página. */
async function recordFrames(page: Page) {
  await page.addInitScript(() => {
    const frames: unknown[] = [];
    (window as unknown as { __frames: unknown[] }).__frames = frames;
    const t0 = performance.now();
    const read = (sel: string) => {
      const el = document.querySelector(sel) as HTMLElement | null;
      if (!el) return undefined;
      const cs = getComputedStyle(el);
      return {
        text: el.textContent ?? '',
        visible: cs.visibility !== 'hidden' && cs.display !== 'none',
        bg: cs.backgroundColor,
      };
    };
    const loop = () => {
      frames.push({
        t: performance.now() - t0,
        title: read('#hero-title'),
        cta: read('[data-testid=cta-comprar]'),
        subtitle: read('.hero-subtitle'),
        banner: read('.promo-banner'),
        htmlOpacity: getComputedStyle(document.documentElement).opacity,
      });
      if (performance.now() - t0 < 2500) requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  });
  return async () => {
    await page.waitForFunction(() => {
      const f = (window as unknown as { __frames: { t: number }[] }).__frames;
      return f.length > 0 && f[f.length - 1]!.t >= 2400;
    });
    return page.evaluate(() => (window as unknown as { __frames: Frame[] }).__frames);
  };
}

/** Captura os frames realmente pintados pelo Chrome (CDP screencast, PNG). */
async function screencast(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  const frames: Buffer[] = [];
  cdp.on('Page.screencastFrame', (f) => {
    frames.push(Buffer.from(f.data, 'base64'));
    cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
  });
  await cdp.send('Page.startScreencast', { format: 'png', everyNthFrame: 1 });
  return async () => {
    await cdp.send('Page.stopScreencast');
    return frames;
  };
}

/** Conta pixels da cor dada (tolerância por canal) dentro do retângulo. */
function countColor(
  png: Buffer,
  box: { x: number; y: number; width: number; height: number },
  rgb: number[],
  scale: number,
) {
  const img = PNG.sync.read(png);
  let n = 0;
  for (let y = Math.floor(box.y * scale); y < Math.min(img.height, (box.y + box.height) * scale); y++)
    for (let x = Math.floor(box.x * scale); x < Math.min(img.width, (box.x + box.width) * scale); x++) {
      const i = (y * img.width + x) * 4;
      if (
        Math.abs(img.data[i]! - rgb[0]!) < 25 &&
        Math.abs(img.data[i + 1]! - rgb[1]!) < 25 &&
        Math.abs(img.data[i + 2]! - rgb[2]!) < 25
      )
        n++;
    }
  return n;
}

const BLUE = [37, 99, 235]; // .btn-primary original (#2563eb)
const RED = [255, 0, 0];

test('anti-flicker por elemento: nenhum frame mostra o conteúdo original dos elementos alterados', async ({
  page,
}) => {
  await serveSnippet(
    page,
    makeConfig([
      experiment([
        { id: 'o1', order: 0, type: 'setText', target: { selector: '#hero-title' }, value: 'Corra mais' },
        {
          id: 'o2',
          order: 1,
          type: 'setStyle',
          target: { selector: '[data-testid="cta-comprar"]' },
          value: { 'background-color': '#ff0000', 'border-color': '#ff0000' },
        },
        // Elemento que o site cria 800 ms depois do load.
        { id: 'o3', order: 2, type: 'setText', target: { selector: '.promo-banner' }, value: 'Oferta B' },
      ]),
    ]),
  );
  const frames = await recordFrames(page);
  const stopCast = await screencast(page);
  await page.goto('/');
  const all = await frames();
  const painted = await stopCast();

  const withTitle = all.filter((f) => f.title);
  expect(withTitle.length).toBeGreaterThan(10);
  for (const f of withTitle) if (f.title!.visible) expect(f.title!.text).toBe('Corra mais');
  for (const f of all.filter((f) => f.cta?.visible)) expect(f.cta!.bg).toBe('rgb(255, 0, 0)');
  const withBanner = all.filter((f) => f.banner);
  expect(withBanner.length).toBeGreaterThan(0);
  for (const f of withBanner) if (f.banner!.visible) expect(f.banner!.text).toBe('Oferta B');

  // Elementos NÃO alterados aparecem desde o primeiro frame em que existem (não esconde a página).
  expect(all.find((f) => f.subtitle)!.subtitle!.visible).toBe(true);
  expect(all.every((f) => f.htmlOpacity === '1')).toBe(true);

  // Frames pintados: o botão nunca aparece azul (original); no fim está vermelho.
  const box = (await page.locator('[data-testid=cta-comprar]').boundingBox())!;
  const scale = PNG.sync.read(painted.at(-1)!).width / page.viewportSize()!.width;
  expect(painted.length).toBeGreaterThan(0);
  for (const png of painted) expect(countColor(png, box, BLUE, scale)).toBe(0);
  expect(countColor(painted.at(-1)!, box, RED, scale)).toBeGreaterThan(100);
  await expect(page.locator('style[data-abt-antiflicker]')).toHaveCount(0);
});

test('sem anti-flicker o teste detecta flicker (controle negativo)', async ({ page }) => {
  // Sem snippet; o texto muda 300 ms depois do load (como um script tardio): o original é pintado primeiro.
  await page.route('http://localhost:4000/cdn/demo.js', (r) => r.fulfill({ body: '' }));
  const frames = await recordFrames(page);
  await page.goto('/');
  await page.evaluate(() => {
    const t = document.querySelector('#hero-title')!;
    setTimeout(() => (t.textContent = 'Corra mais'), 300);
  });
  const all = await frames();
  expect(all.some((f) => f.title?.visible && f.title.text !== 'Corra mais')).toBe(true);
});

test('modo página esconde tudo e o timeout de segurança libera a página', async ({ page }) => {
  await serveSnippet(
    page,
    makeConfig([
      experiment([{ id: 'o1', order: 0, type: 'hide', target: { selector: '#nunca-existe' } }], {
        antiFlicker: { mode: 'page', timeoutMs: 600 },
      }),
    ]),
  );
  const frames = await recordFrames(page);
  await page.goto('/');
  const all = await frames();
  const firstWithBody = all.find((f) => f.subtitle)!;
  expect(firstWithBody.htmlOpacity).toBe('0');
  const shown = all.find((f) => f.htmlOpacity === '1' && f.subtitle)!;
  expect(shown.t).toBeGreaterThan(500);
  expect(shown.t).toBeLessThan(1500);
});
