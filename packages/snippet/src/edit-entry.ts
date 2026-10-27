// Entrada do edit.js: handshake do modo edição (fase 3), carregado sob demanda pelo snippet só dentro do iframe do
// editor com `?abt_edit`. Fora do runtime principal: nenhum visitante comum baixa este código.
import type { PublishedConfig } from '@abtest/shared';
import { bootEditor } from './editor';

declare global {
  interface Window {
    __ABT_EDIT__?: { config: PublishedConfig; token: string; agent: string };
  }
}

const b = window.__ABT_EDIT__;
if (b) void bootEditor(window, b.config, b.token, b.agent);
