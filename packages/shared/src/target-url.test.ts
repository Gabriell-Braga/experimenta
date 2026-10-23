import { expect, test } from 'vitest';
import { stripPii, targetUrlError } from './target-url';

const SITES = ['https://www.loja.com.br/'];

test('domínio: sites do workspace, subdomínios e localhost; o resto é recusado', () => {
  expect(targetUrlError('https://loja.com.br/x', SITES)).toBeNull();
  expect(targetUrlError('https://m.loja.com.br/', SITES)).toBeNull();
  expect(targetUrlError('http://localhost:5180/', SITES)).toBeNull();
  expect(targetUrlError('https://www.instagram.com/p/1', SITES)).toContain('não é um site deste workspace');
  expect(targetUrlError('https://loja.com.br.mal.com/', SITES)).toContain('não é um site');
  expect(targetUrlError('ftp://loja.com.br/', SITES)).toContain('http');
});

test('dados pessoais na URL: por nome do parâmetro ou valor (e-mail, CPF, telefone)', () => {
  expect(targetUrlError('https://loja.com.br/?nome=Ana', SITES)).toContain('nome');
  expect(targetUrlError('https://loja.com.br/?q=ana@x.com', SITES)).toContain('q');
  expect(targetUrlError('https://loja.com.br/?doc=123.456.789-09', SITES)).toContain('doc');
  expect(targetUrlError('https://loja.com.br/?c=%2B55%20(11)%2099999-0000', SITES)).toContain('c');
  expect(targetUrlError('https://loja.com.br/u/ana@x.com', SITES)).toContain('e-mail no caminho');
  // Ids numéricos, UTMs e datas passam.
  expect(targetUrlError('https://loja.com.br/?id=12345678901&utm_source=ig&d=2026-10-23', SITES)).toBeNull();
});

test('stripPii tira só os parâmetros pessoais', () => {
  expect(stripPii('https://loja.com.br/?email=a%40b.com&utm_source=x&telefone=1')).toEqual({
    url: 'https://loja.com.br/?utm_source=x',
    removed: ['email', 'telefone'],
  });
  expect(stripPii('https://loja.com.br/?a=1')).toEqual({ url: 'https://loja.com.br/?a=1', removed: [] });
});
