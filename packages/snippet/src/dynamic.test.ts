// @vitest-environment jsdom
import type { Operation } from '@abtest/shared';
import { expect, test } from 'vitest';
import type { Profile } from './data';
import { renderOperations, renderTemplate } from './dynamic';

const profile: Profile = {
  pv: 1,
  s: 1,
  ev: {},
  f: 0,
  l: 0,
  a: { nome: 'Ana' },
  t: { utm_campaign: 'black' },
};

test('tokens: atributo, query, utm (URL ou 1ª visita), cookie, variável JS e padrão', () => {
  history.replaceState(null, '', '/?cupom=OFF10');
  document.cookie = 'cidade=Recife; Path=/';
  (window as unknown as { loja: unknown }).loja = { frete: { gratis: 'sim' } };
  const t = (s: string) => renderTemplate(s, window, profile, 'text');
  expect(t('Olá, {{attr.nome|visitante}}!')).toBe('Olá, Ana!');
  expect(t('Olá, {{ attr.apelido | visitante }}!')).toBe('Olá, visitante!');
  expect(t('Use {{query.cupom}}')).toBe('Use OFF10');
  expect(t('{{utm.utm_campaign}}')).toBe('black');
  expect(t('Entrega em {{cookie.cidade|sua cidade}}')).toBe('Entrega em Recife');
  expect(t('Frete grátis: {{js.loja.frete.gratis|não}}')).toBe('Frete grátis: sim');
  expect(t('sem tokens')).toBe('sem tokens');
});

test('XSS: HTML escapado; atributo de URL codificado; atributo de evento intocado', () => {
  history.replaceState(
    null,
    '',
    `/?q=${encodeURIComponent('<img src=x onerror=alert(1)>')}&u=${encodeURIComponent('javascript:alert(1)')}`,
  );
  const target = { selector: 'h1', alternates: [] };
  const ops = renderOperations(
    [
      { id: '1', order: 0, type: 'setHTML', target, value: '<b>{{query.q}}</b>' },
      {
        id: '2',
        order: 1,
        type: 'insertHTML',
        target,
        value: { position: 'after', html: '<p>{{query.q}}</p>' },
      },
      { id: '3', order: 2, type: 'setAttribute', target, value: { name: 'href', value: '{{query.u}}' } },
      { id: '4', order: 3, type: 'setAttribute', target, value: { name: 'onclick', value: '{{query.u}}' } },
      { id: '5', order: 4, type: 'setText', target, value: '{{query.q}}' },
    ] as Operation[],
    window,
    profile,
  );
  expect((ops[0] as { value: string }).value).toBe('<b>&#60;img src=x onerror=alert(1)&#62;</b>');
  expect((ops[1] as { value: { html: string } }).value.html).not.toContain('<img');
  expect((ops[2] as { value: { value: string } }).value.value).toBe('javascript%3Aalert(1)');
  expect((ops[3] as { value: { value: string } }).value.value).toBe('{{query.u}}');
  expect((ops[4] as { value: string }).value).toBe('<img src=x onerror=alert(1)>'); // textContent: seguro
});
