// @vitest-environment jsdom
import { ExperimentSchema } from '@abtest/shared';
import { beforeEach, expect, test, vi } from 'vitest';
import { resetProcessed } from './engine/apply';
import { runPreview } from './preview';
import { sessionParam } from './qa';

const experiment = ExperimentSchema.parse({
  id: 'preview_e1',
  key: 'hero',
  name: 'Hero',
  status: 'running',
  variations: [
    {
      id: 'v1',
      key: 'b',
      name: 'B',
      weight: 1,
      operations: [
        {
          id: 'o1',
          type: 'setText',
          order: 0,
          target: { selector: '#t', alternates: [] },
          value: 'Rascunho',
        },
      ],
    },
  ],
});

beforeEach(() => {
  document.head.innerHTML = '';
  document.body.innerHTML = '<h1 id="t">Original</h1>';
  sessionStorage.clear();
  resetProcessed();
  window.__ABT_CONFIG__ = {
    accountId: 'acc',
    version: 1,
    publishedAt: '',
    apiUrl: 'http://api.test',
    experiments: [],
  };
});

test('link válido: busca o rascunho da conta e aplica, com selo; sem eventos', async () => {
  const fetch = vi.fn(async () => Response.json({ experiment, expiresAt: '2030-01-01T00:00:00Z' }));
  window.fetch = fetch as typeof window.fetch;
  const rt = await runPreview(window, 'pv_1.seg');
  expect(rt?.active.size).toBe(1);
  expect(fetch).toHaveBeenCalledWith('http://api.test/preview/acc/pv_1.seg', { cache: 'no-store' });
  await vi.waitFor(() => expect(document.getElementById('t')!.textContent).toBe('Rascunho'));
  const badge = document.querySelector('[data-abt-qa]')!.shadowRoot!.textContent!;
  expect(badge).toContain('Pré-visualização');
  expect(badge).toContain('Hero → B');
  expect(document.querySelector('[data-abt-antiflicker]')).toBeNull();
  rt!.stop();
});

test('link inválido: não aplica, sai do modo pré-visualização e avisa', async () => {
  sessionStorage.setItem('_abt_preview', 'pv_1.seg');
  window.fetch = vi.fn(async () => Response.json({ error: 'x' }, { status: 404 })) as typeof window.fetch;
  expect(await runPreview(window, 'pv_1.seg')).toBeNull();
  expect(document.getElementById('t')!.textContent).toBe('Original');
  expect(sessionStorage.getItem('_abt_preview')).toBeNull();
  expect(document.querySelector('[data-abt-qa]')!.shadowRoot!.textContent).toContain('expirado ou revogado');
});

test('sem resposta da API (navegou no meio da busca, rede): não sai do modo pré-visualização', async () => {
  sessionStorage.setItem('_abt_preview', 'pv_1.seg');
  window.fetch = vi.fn(async () => {
    throw new DOMException('aborted', 'AbortError');
  }) as typeof window.fetch;
  expect(await runPreview(window, 'pv_1.seg')).toBeNull();
  expect(sessionStorage.getItem('_abt_preview')).toBe('pv_1.seg');
  expect(document.querySelector('[data-abt-antiflicker]')).toBeNull();
  expect(document.querySelector('[data-abt-qa]')).toBeNull();
});

test('parâmetro guardado na sessão sobrevive à navegação; "off" limpa', () => {
  history.replaceState(null, '', '/?abt_preview=tok');
  expect(sessionParam(window, 'abt_preview')).toBe('tok');
  history.replaceState(null, '', '/produto');
  expect(sessionParam(window, 'abt_preview')).toBe('tok');
  history.replaceState(null, '', '/produto?abt_preview=off');
  expect(sessionParam(window, 'abt_preview')).toBeNull();
  history.replaceState(null, '', '/');
  expect(sessionParam(window, 'abt_preview')).toBeNull();
});
