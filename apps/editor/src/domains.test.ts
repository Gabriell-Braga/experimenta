import { expect, test } from 'vitest';
import { domainOf, domainsOf, withoutDomains } from './domains';

const rows = [
  { page: 'https://loja.com/loja' },
  { page: 'https://loja.com/loja/checkout' },
  { page: 'https://antigo.pages.dev/loja' },
  { page: 'app://com.loja/Carrinho' },
];
const page = (r: { page: string }) => r.page;

test('domínio de páginas e telas do app; URL inválida não tem domínio', () => {
  expect(domainOf('https://loja.com:8080/x?a=1')).toBe('loja.com:8080');
  expect(domainOf('app://com.loja/Carrinho')).toBe('com.loja');
  expect(domainOf('')).toBe('');
});

test('domínios do mais frequente ao menos; esconder domínios antigos', () => {
  expect(domainsOf(rows, page)).toEqual(['loja.com', 'antigo.pages.dev', 'com.loja']);
  expect(withoutDomains(rows, page, ['antigo.pages.dev']).map(page)).toEqual([
    'https://loja.com/loja',
    'https://loja.com/loja/checkout',
    'app://com.loja/Carrinho',
  ]);
  expect(withoutDomains(rows, page, [])).toBe(rows);
});
