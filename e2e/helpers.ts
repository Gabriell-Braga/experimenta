import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ExperimentSchema, type PublishedConfig } from '@abtest/shared';
import type { Page } from '@playwright/test';

const SNIPPET = fileURLToPath(new URL('../packages/snippet/dist/abt.js', import.meta.url));

/** Monta uma config publicada a partir de experimentos parciais (com defaults do schema). */
export function makeConfig(experiments: unknown[], extra: Partial<PublishedConfig> = {}): PublishedConfig {
  return {
    accountId: 'demo',
    version: 1,
    publishedAt: new Date().toISOString(),
    experiments: experiments.map((e) => ExperimentSchema.parse(e)),
    ...extra,
  };
}

/** Mesmo formato do arquivo publicado /cdn/<conta>.js (ver D-008). */
export function compileSnippet(config: PublishedConfig): string {
  return `window.__ABT_CONFIG__=${JSON.stringify(config)};\n${readFileSync(SNIPPET, 'utf8')}`;
}

/** Intercepta o snippet do site demo e serve a config dada (sem precisar da API). */
export async function serveSnippet(page: Page, config: PublishedConfig, delayMs = 0): Promise<void> {
  await page.route('http://localhost:4000/cdn/demo.js', async (route) => {
    if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
    await route.fulfill({ contentType: 'application/javascript', body: compileSnippet(config) });
  });
}

/** Experimento de 1 variação (100% na B) com as operações dadas. */
export function experiment(operations: unknown[], extra: object = {}) {
  return {
    id: 'e1',
    key: 'hero',
    name: 'Hero',
    status: 'running',
    variations: [
      { id: 'v0', key: 'controle', name: 'Controle', weight: 0 },
      { id: 'v1', key: 'b', name: 'B', weight: 1, operations },
    ],
    ...extra,
  };
}
