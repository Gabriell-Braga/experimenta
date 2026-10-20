// Código que o cliente cola na plataforma do site (fase 19.1): Shopify (tema + pixel do checkout) e WordPress.

/** URL do script da conta (o mesmo da tela Instalação). */
export const scriptUrl = (api: string, account: string) => `${api}/cdn/${account}.js`;

/**
 * Shopify, `layout/theme.liquid`: snippet como primeiro item do <head>, cliente logado identificado (perfil do
 * CDP com e-mail, base da sincronização com CRMs) e produto visto (recomendações).
 */
export function shopifyTheme(api: string, account: string): string {
  return `<script src="${scriptUrl(api, account)}"></script>
{%- if customer -%}
<script>abq.push(['identify', 'shopify-{{ customer.id }}', { email: {{ customer.email | json }} }]);</script>
{%- endif -%}
{%- if template contains 'product' -%}
<script>abq.push(['product', { id: {{ product.id | json }}, name: {{ product.title | json }}, price: {{ product.price | divided_by: 100.0 | json }} }]);</script>
{%- endif -%}`;
}

/**
 * Shopify, Configurações → Eventos do cliente → Pixel personalizado. O checkout não roda o tema (nem o snippet):
 * o pixel lê o visitante (cookie `_abt_vid`) e as variações (`_abt_a`) do domínio da loja, busca a config
 * publicada e manda a compra como evento `purchase` com valor e como conversão das metas "evento customizado
 * purchase" de cada teste em que o visitante está. Ids fixos por pedido: recarregar a página não duplica.
 */
export function shopifyPixel(api: string, account: string): string {
  return `// Experimenta: compra do checkout vira conversão (meta "evento customizado" purchase).
const ABT_CONFIG = '${api}/cdn/${account}.json';
analytics.subscribe('checkout_completed', async (event) => {
  const visitorId = await browser.cookie.get('_abt_vid');
  if (!visitorId) return;
  let assigned = {};
  try {
    assigned = JSON.parse((await browser.localStorage.getItem('_abt_a')) || '{}');
  } catch (e) {}
  const cfg = await (await fetch(ABT_CONFIG)).json();
  const checkout = event.data.checkout;
  const value = Number((checkout.totalPrice && checkout.totalPrice.amount) || 0);
  const order = String((checkout.order && checkout.order.id) || event.id);
  const id = 'shopify-' + cfg.accountId + '-' + order;
  const base = { ts: Date.now(), accountId: cfg.accountId, visitorId: visitorId, url: event.context.document.location.href };
  const events = [
    Object.assign({ eventId: id, type: 'event', name: 'purchase', value: value, props: { order: order, currency: checkout.currencyCode || '' } }, base),
  ];
  for (const x of cfg.experiments || []) {
    const v = x.variations.find((v) => v.id === assigned[x.id]);
    if (!v) continue;
    for (const g of x.goals)
      if (g.type === 'custom' && g.event === 'purchase')
        events.push(Object.assign({ eventId: id + '-' + x.id + '-' + g.id, type: 'conversion', experimentId: x.id, experimentKey: x.key, variationId: v.id, variationKey: v.key, goalId: g.id, goalKey: g.key, value: value }, base));
  }
  await fetch(cfg.trackingUrl, { method: 'POST', body: JSON.stringify({ events: events }), keepalive: true, headers: { 'content-type': 'text/plain' } });
});`;
}

/** Plugin do WordPress (integrations/wordpress) com a URL desta conta, num .zip montado no navegador. */
export async function downloadWordpressPlugin(url: string): Promise<void> {
  const [{ zipSync, strToU8 }, php] = await Promise.all([
    import('fflate'),
    import('../../../integrations/wordpress/experimenta/experimenta.php?raw'),
  ]);
  const src = php.default.replace('__EXPERIMENTA_SCRIPT_URL__', url.replace(/[\\']/g, ''));
  const zip = zipSync({ 'experimenta/experimenta.php': strToU8(src) });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([zip], { type: 'application/zip' }));
  a.download = 'experimenta-wordpress.zip';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
