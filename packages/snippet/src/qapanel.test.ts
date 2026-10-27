// @vitest-environment jsdom
import { ExperimentSchema, type PublishedConfig } from '@abtest/shared';
import { beforeEach, expect, test } from 'vitest';
import { qaPanel } from './qapanel';
import { start } from './runtime';

const exp = (id: string, url: string) =>
  ExperimentSchema.parse({
    id,
    key: id,
    name: `Teste ${id}`,
    status: 'running',
    segmentation: { urls: [{ match: 'contains', value: url }] },
    variations: [{ id: `${id}v`, key: 'b', name: 'B', weight: 1 }],
  });

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  document.body.innerHTML = '';
  history.replaceState(null, '', '/loja/produto');
});

test('log por página: variação aplicada, regra de URL que não bateu e metas que dispararam; persiste na sessão', () => {
  const config = {
    accountId: 'acc',
    version: 1,
    publishedAt: '',
    experiments: [exp('a', '/loja'), exp('c', '/checkout')],
  } as PublishedConfig;
  const rt = start(window, config, { forced: { a: 'b' } })!;
  const { host } = qaPanel(window, rt, 'Modo QA');
  const rows = () =>
    [...host.shadowRoot!.querySelectorAll('.i')].map(
      (r) => `${(r as HTMLElement).dataset.k} ${r.textContent}`,
    );
  expect(rows()).toEqual(['ok ✓Teste a → B', 'page ✕Teste c: regra de página (URL) não bateu']);
  window.dispatchEvent(
    new CustomEvent('abt:event', {
      detail: { type: 'conversion', experimentId: 'a', goalKey: 'compra', goalId: 'g' },
    }),
  );
  expect(rows()).toContain('goal ◎Meta "compra" disparou em Teste a');
  expect(JSON.parse(sessionStorage.getItem('_abt_qa_log')!)[0].items).toHaveLength(3);
  rt.stop();
});
