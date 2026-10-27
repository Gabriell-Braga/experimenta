// Entrada do preview.js: link de pré-visualização (fase 17.3). O snippet carrega este arquivo só quando a sessão
// tem `?abt_preview=<token>`; aqui o rascunho da variação vem da API e é aplicado sozinho (sem os experimentos
// publicados, sem coleta). Fica fora do runtime principal para não pesar nos outros visitantes.
import type { Experiment } from '@abtest/shared';
import { hide } from './antiflicker';
import { readConfig } from './config';
import { installGoals } from './goals';
import { qaPanel } from './qapanel';
import { start, type Runtime } from './runtime';

declare global {
  interface Window {
    /** Token do link (o snippet guarda na sessão `_abt_preview`). */
    __ABT_PREVIEW__?: string;
  }
}

/** Resposta de `GET /preview/:conta/:token`: o experimento já compilado com só a variação do link. */
export interface PreviewPayload {
  experiment: Experiment;
  expiresAt: string;
}

/** Aplica o rascunho do link; devolve o runtime (null se o link não vale). */
export async function runPreview(win: Window, token: string): Promise<Runtime | null> {
  const config = readConfig(win);
  const doc = win.document;
  if (!config?.apiUrl) return null;
  // Tira o token da URL (já está na sessão): regras de URL "é exatamente" casam e o token não vaza em
  // referrer, analytics do site ou link copiado da barra de endereço.
  const url = new URL(win.location.href);
  if (url.searchParams.has('abt_preview')) {
    url.searchParams.delete('abt_preview');
    win.history.replaceState(win.history.state, '', url.href);
  }
  // A página fica escondida enquanto busca o rascunho (no máximo 3 s), para não piscar o original.
  const af = hide(doc, [], 'page', 3000);
  let data: PreviewPayload | null = null;
  try {
    const res = await win.fetch(
      `${config.apiUrl}/preview/${encodeURIComponent(config.accountId)}/${encodeURIComponent(token)}`,
      { cache: 'no-store' },
    );
    if (res.ok) data = (await res.json()) as PreviewPayload;
  } catch {
    // Sem resposta (saiu da página no meio da busca, rede ou API fora do ar): o link pode valer; a sessão
    // continua no modo pré-visualização e a próxima página tenta de novo (D-087).
    af.release();
    return null;
  }
  if (!data) {
    af.release();
    // Expirado, revogado ou de outra conta: sai do modo pré-visualização nas próximas páginas.
    try {
      win.sessionStorage.removeItem('_abt_preview');
    } catch {
      /* sem sessionStorage */
    }
    qaPanel(win, null, 'Link de pré-visualização expirado ou revogado');
    return null;
  }
  // Eventos só para o painel de QA (metas que dispararam): nada vai para a API nem entra nos relatórios.
  const rt = start(
    win,
    { ...config, experiments: [data.experiment], audiences: [] },
    {
      sink: (e) => win.dispatchEvent(new CustomEvent('abt:event', { detail: e })),
    },
  );
  af.release();
  if (rt) installGoals(win, rt);
  const label = new Date(data.expiresAt).toLocaleString();
  qaPanel(win, rt, `Pré-visualização (rascunho) · até ${label}`);
  return rt;
}

const root = document.documentElement;
const token = window.__ABT_PREVIEW__;
// O snippet pode pedir o arquivo de novo (o CMP confirma o consentimento mais de uma vez): roda uma vez só.
if (token && root.dataset.abtPreview === undefined) {
  root.dataset.abtPreview = '';
  void runPreview(window, token);
}
