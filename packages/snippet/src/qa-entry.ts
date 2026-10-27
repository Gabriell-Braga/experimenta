// Entrada do qa.js: painel do modo QA (`?ab_force`), carregado sob demanda pelo snippet com o runtime pronto.
import { qaPanel } from './qapanel';
import type { Runtime } from './runtime';

declare global {
  interface Window {
    __ABT_QA__?: Runtime;
  }
}

const rt = window.__ABT_QA__;
if (rt && !document.querySelector('[data-abt-qa]')) qaPanel(window, rt, 'Modo QA A/B');
