import type { PublishedConfig } from '@abtest/shared';

declare global {
  interface Window {
    /** Injetado pelo arquivo publicado `/cdn/<conta>.js` antes do runtime (ver D-008). */
    __ABT_CONFIG__?: PublishedConfig;
  }
}

/** Lê a configuração embutida. Validação forte acontece na publicação; aqui só checagem mínima. */
export function readConfig(win: Window = window): PublishedConfig | null {
  const c = win.__ABT_CONFIG__;
  return c && typeof c.accountId === 'string' && Array.isArray(c.experiments) ? c : null;
}
