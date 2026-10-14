import { resolveTarget } from '@abtest/selector';
import type { HeatmapData } from '@abtest/shared';

const CSS = `
.heat{position:fixed;inset:0;pointer-events:none}
.heat-badges,.heat-bands{position:fixed;inset:0;pointer-events:none;overflow:hidden}
.heat-badge{position:absolute;transform:translate(-50%,-50%);min-width:18px;padding:1px 6px;border-radius:9px;background:#111827e6;color:#fff;font:600 11px/16px system-ui,sans-serif;text-align:center;box-shadow:0 1px 3px #0005}
.heat-band{position:absolute;left:0;right:0;border-top:1px dashed #ef4444aa}
.heat-band span{position:absolute;right:8px;top:-9px;padding:0 6px;border-radius:3px;background:#ef4444;color:#fff;font:600 11px/16px system-ui,sans-serif}
`;

/** Rampa de cor do mapa de calor por intensidade (0..255): azul → verde → amarelo → vermelho. */
export function heatColor(a: number): [number, number, number] {
  const t = a / 255;
  if (t < 0.33) return [0, Math.round(t * 3 * 255), 255];
  if (t < 0.66) return [Math.round((t - 0.33) * 3 * 255), 255, Math.round(255 - (t - 0.33) * 3 * 255)];
  return [255, Math.round(255 - (t - 0.66) * 3 * 255), 0];
}

/**
 * Camada de mapa de calor no Shadow DOM do agent. Pontos são relativos ao elemento (rx, ry),
 * então o desenho acompanha scroll, resize e layouts diferentes; recalcula a cada frame de scroll.
 */
export function createHeatmapLayer(doc: Document, root: ShadowRoot) {
  const win = doc.defaultView!;
  const style = doc.createElement('style');
  style.textContent = CSS;
  const canvas = doc.createElement('canvas');
  canvas.className = 'heat';
  const badges = doc.createElement('div');
  badges.className = 'heat-badges';
  const bands = doc.createElement('div');
  bands.className = 'heat-bands';
  let data: HeatmapData | null = null;
  let raf = 0;

  const draw = () => {
    badges.replaceChildren();
    bands.replaceChildren();
    const w = win.innerWidth;
    const h = win.innerHeight;
    const dpr = win.devicePixelRatio || 1;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    const ctx = canvas.getContext?.('2d') ?? null;
    if (!data) return { resolved: 0, missing: 0 };

    let resolved = 0;
    if (ctx) ctx.scale(dpr, dpr);
    for (const e of data.clicks.elements) {
      const el = resolveTarget({ selector: e.selector, alternates: [] }, doc)?.el;
      const r = el?.getBoundingClientRect();
      if (!el || !r || (!r.width && !r.height)) continue;
      resolved++;
      if (ctx)
        for (const [rx, ry] of e.points) {
          const x = r.left + rx * r.width;
          const y = r.top + ry * r.height;
          if (x < -30 || y < -30 || x > w + 30 || y > h + 30) continue;
          const g = ctx.createRadialGradient(x, y, 0, x, y, 22);
          g.addColorStop(0, 'rgba(0,0,0,0.35)');
          g.addColorStop(1, 'rgba(0,0,0,0)');
          ctx.fillStyle = g;
          ctx.fillRect(x - 22, y - 22, 44, 44);
        }
      const b = doc.createElement('div');
      b.className = 'heat-badge';
      b.dataset.selector = e.selector;
      b.textContent = String(e.count);
      b.title = `${e.count} cliques (${Math.round((e.count / (data.clicks.total || 1)) * 100)}%) em ${e.selector}`;
      b.style.left = `${r.right}px`;
      b.style.top = `${r.top}px`;
      badges.append(b);
    }
    // Coloriza pela intensidade acumulada no canal alfa.
    if (ctx && canvas.width && canvas.height) {
      const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const px = img.data;
      for (let i = 3; i < px.length; i += 4) {
        const a = px[i]!;
        if (!a) continue;
        const [r, g, bl] = heatColor(a);
        px[i - 3] = r;
        px[i - 2] = g;
        px[i - 1] = bl;
        px[i] = Math.min(200, a * 2);
      }
      ctx.putImageData(img, 0, 0);
    }
    // Faixas de scroll: posição = % da altura do documento.
    const docH = doc.documentElement.scrollHeight;
    if (data.scroll.pageviews)
      for (const { depth, pct } of data.scroll.reached) {
        const y = (depth / 100) * docH - win.scrollY;
        if (y < 0 || y > h) continue;
        const line = doc.createElement('div');
        line.className = 'heat-band';
        line.dataset.depth = String(depth);
        line.style.top = `${y}px`;
        line.innerHTML = `<span>${pct}% chegaram aqui</span>`;
        bands.append(line);
      }
    return { resolved, missing: data.clicks.elements.length - resolved };
  };

  const schedule = () => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(draw);
  };

  return {
    show(d: HeatmapData) {
      data = d;
      if (!canvas.isConnected) root.append(style, canvas, bands, badges);
      win.addEventListener('scroll', schedule, true);
      win.addEventListener('resize', schedule);
      return draw();
    },
    hide() {
      data = null;
      win.removeEventListener('scroll', schedule, true);
      win.removeEventListener('resize', schedule);
      for (const n of [style, canvas, bands, badges]) n.remove();
    },
  };
}
