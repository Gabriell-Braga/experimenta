import { resolveTarget } from '@abtest/selector';
import type { HeatmapData } from '@abtest/shared';

const CSS = `
.heat{position:fixed;inset:0;pointer-events:none}
.heat-badges,.heat-bands,.heat-scroll{position:fixed;inset:0;pointer-events:none;overflow:hidden}
.heat-badge{position:absolute;transform:translate(-50%,-50%);min-width:18px;padding:1px 6px;border-radius:4px;background:#16181de8;color:#d4f15b;font:600 11px/16px ui-monospace,Menlo,monospace;text-align:center;box-shadow:0 1px 3px #0005;white-space:nowrap}
.heat-badge.fr{background:#e8552d;color:#fff}
.heat-outline{position:absolute;border:1.5px solid #d4f15b;border-radius:3px;background:#d4f15b14}
.heat-outline.fr{border-color:#e8552d;background:#e8552d14}
.heat-band{position:absolute;left:0;right:0;border-top:1px dashed #16181d88}
.heat-band span{position:absolute;right:8px;top:-9px;padding:0 6px;border-radius:3px;background:#16181d;color:#d4f15b;font:600 11px/16px ui-monospace,Menlo,monospace}
.heat-slice{position:absolute;left:0;right:0;mix-blend-mode:multiply}
`;

/** Rampa de cor do mapa de calor por intensidade (0..255): azul → verde → amarelo → vermelho. */
export function heatColor(a: number): [number, number, number] {
  const t = a / 255;
  if (t < 0.33) return [0, Math.round(t * 3 * 255), 255];
  if (t < 0.66) return [Math.round((t - 0.33) * 3 * 255), 255, Math.round(255 - (t - 0.33) * 3 * 255)];
  return [255, Math.round(255 - (t - 0.66) * 3 * 255), 0];
}

/**
 * Camada de mapa de calor no Shadow DOM do agent. Pontos de clique são relativos ao elemento (rx, ry),
 * então o desenho acompanha scroll, resize e layouts diferentes; recalcula a cada frame de scroll.
 * Modos: `heat` (calor + contagens + faixas de scroll), `click` (contagem por elemento), `scroll`
 * (scrollmap: cor por % de visitantes que chegou a cada trecho), `move` (calor do movimento do mouse)
 * e `frustration` (rage/dead clicks por elemento).
 */
export function createHeatmapLayer(doc: Document, root: ShadowRoot) {
  const win = doc.defaultView!;
  const style = doc.createElement('style');
  style.textContent = CSS;
  const canvas = doc.createElement('canvas');
  canvas.className = 'heat';
  const scrollLayer = doc.createElement('div');
  scrollLayer.className = 'heat-scroll';
  const badges = doc.createElement('div');
  badges.className = 'heat-badges';
  const bands = doc.createElement('div');
  bands.className = 'heat-bands';
  let data: HeatmapData | null = null;
  let raf = 0;

  const rectOf = (selector: string) => {
    const el = resolveTarget({ selector, alternates: [] }, doc)?.el;
    const r = el?.getBoundingClientRect();
    return el && r && (r.width || r.height) ? r : null;
  };

  const badge = (r: DOMRect, text: string, title: string, selector: string, fr = false) => {
    const b = doc.createElement('div');
    b.className = fr ? 'heat-badge fr' : 'heat-badge';
    b.dataset.selector = selector;
    b.textContent = text;
    b.title = title;
    b.style.left = `${r.right}px`;
    b.style.top = `${r.top}px`;
    badges.append(b);
  };
  const outline = (r: DOMRect, fr = false) => {
    const o = doc.createElement('div');
    o.className = fr ? 'heat-outline fr' : 'heat-outline';
    Object.assign(o.style, {
      left: `${r.left}px`,
      top: `${r.top}px`,
      width: `${r.width}px`,
      height: `${r.height}px`,
    });
    badges.append(o);
  };

  const draw = () => {
    badges.replaceChildren();
    bands.replaceChildren();
    scrollLayer.replaceChildren();
    const w = win.innerWidth;
    const h = win.innerHeight;
    const dpr = win.devicePixelRatio || 1;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    const ctx = canvas.getContext?.('2d') ?? null;
    if (!data) return { resolved: 0, missing: 0 };
    const mode = data.mode ?? 'heat';
    if (ctx) ctx.scale(dpr, dpr);
    const blob = (x: number, y: number, radius = 22) => {
      if (!ctx || x < -30 || y < -30 || x > w + 30 || y > h + 30) return;
      const g = ctx.createRadialGradient(x, y, 0, x, y, radius);
      g.addColorStop(0, 'rgba(0,0,0,0.12)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
    };

    let resolved = 0;
    let missing = 0;
    if (mode === 'heat' || mode === 'click') {
      for (const e of data.clicks.elements) {
        const r = rectOf(e.selector);
        if (!r) {
          missing++;
          continue;
        }
        resolved++;
        if (mode === 'heat')
          for (const [rx, ry] of e.points) blob(r.left + rx * r.width, r.top + ry * r.height);
        if (mode === 'click') outline(r);
        const share = Math.round((e.count / (data.clicks.total || 1)) * 100);
        badge(
          r,
          mode === 'click' ? `${e.count} · ${share}%` : String(e.count),
          `${e.count} cliques (${share}%) em ${e.selector}`,
          e.selector,
        );
      }
    } else if (mode === 'move') {
      for (const [x, y] of data.moves) blob(x * w, y - win.scrollY, 18);
    } else if (mode === 'frustration') {
      for (const f of data.frustration) {
        const r = rectOf(f.selector);
        if (!r) {
          missing++;
          continue;
        }
        resolved++;
        outline(r, true);
        for (const [rx, ry] of f.points) blob(r.left + rx * r.width, r.top + ry * r.height, 16);
        const parts = [f.rage && `${f.rage} rage`, f.dead && `${f.dead} dead`].filter(Boolean).join(' · ');
        badge(r, parts, `${f.rage} rage clicks e ${f.dead} dead clicks em ${f.selector}`, f.selector, true);
      }
    }
    // Coloriza pela intensidade acumulada no canal alfa.
    if (ctx && canvas.width && canvas.height && mode !== 'click' && mode !== 'scroll') {
      const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const px = img.data;
      // Normaliza pela maior densidade: com muitos pontos o calor não satura tudo em vermelho.
      let max = 0;
      for (let i = 3; i < px.length; i += 4) if (px[i]! > max) max = px[i]!;
      for (let i = 3; i < px.length; i += 4) {
        const a = px[i]!;
        if (!a) continue;
        const n = Math.round((a / max) * 255);
        const [r, g, bl] = heatColor(n);
        px[i - 3] = r;
        px[i - 2] = g;
        px[i - 1] = bl;
        px[i] = Math.min(190, 40 + n);
      }
      ctx.putImageData(img, 0, 0);
    }
    const docH = doc.documentElement.scrollHeight;
    // Scrollmap: cada trecho de 10% pintado pela fração de visitantes que chegou até ele.
    if (mode === 'scroll' && data.scroll.pageviews) {
      let prev = 0;
      for (const { depth, pct } of data.scroll.reached) {
        const top = (prev / 100) * docH - win.scrollY;
        const bottom = (depth / 100) * docH - win.scrollY;
        prev = depth;
        if (bottom < 0 || top > h) continue;
        const [r, g, b] = heatColor(Math.round((pct / 100) * 255));
        const s = doc.createElement('div');
        s.className = 'heat-slice';
        s.dataset.depth = String(depth);
        Object.assign(s.style, {
          top: `${top}px`,
          height: `${bottom - top}px`,
          background: `rgba(${r},${g},${b},0.28)`,
        });
        scrollLayer.append(s);
      }
    }
    // Faixas de scroll: posição = % da altura do documento.
    if ((mode === 'heat' || mode === 'scroll') && data.scroll.pageviews)
      for (const { depth, pct } of data.scroll.reached) {
        const y = (depth / 100) * docH - win.scrollY;
        if (y < 0 || y > h) continue;
        const line = doc.createElement('div');
        line.className = 'heat-band';
        line.dataset.depth = String(depth);
        line.style.top = `${y}px`;
        const label = doc.createElement('span');
        label.textContent = `${pct}% chegaram aqui`;
        line.append(label);
        bands.append(line);
      }
    return { resolved, missing };
  };

  const schedule = () => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(draw);
  };

  return {
    show(d: HeatmapData) {
      data = d;
      if (!canvas.isConnected) root.append(style, scrollLayer, canvas, bands, badges);
      win.addEventListener('scroll', schedule, true);
      win.addEventListener('resize', schedule);
      return draw();
    },
    hide() {
      data = null;
      win.removeEventListener('scroll', schedule, true);
      win.removeEventListener('resize', schedule);
      for (const n of [style, scrollLayer, canvas, bands, badges]) n.remove();
    },
  };
}
