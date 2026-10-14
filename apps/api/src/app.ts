import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { serveCdn } from './cdn';
import { ping, type Db } from './db';
import { createSessionStore, type SessionStore } from './sessions';

export interface AppDeps {
  db: Db;
  cdnDir: string;
  /** Origins exatos do app do editor autorizados a abrir sessões de edição. */
  editorOrigins: string[];
  sessions?: SessionStore;
}

export function createApp(deps: AppDeps) {
  const app = new Hono();
  const sessions = deps.sessions ?? createSessionStore();

  app.get('/health', async (c) => c.json({ ok: await ping(deps.db) }));
  app.get('/cdn/:file', serveCdn(deps.cdnDir));

  // Criação: só a partir do app do editor (CORS restrito). Autenticação entra na tarefa 4.2.
  app.use('/edit-sessions', cors({ origin: deps.editorOrigins, allowMethods: ['POST'] }));
  app.post('/edit-sessions', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { accountId?: unknown };
    const origin = c.req.header('origin') ?? '';
    if (!deps.editorOrigins.includes(origin)) return c.json({ error: 'origin não autorizado' }, 403);
    if (typeof body.accountId !== 'string' || !body.accountId)
      return c.json({ error: 'accountId obrigatório' }, 400);
    const s = sessions.create(body.accountId, origin);
    return c.json(s, 201);
  });

  // Validação: chamada pelo snippet a partir do site do cliente (qualquer origin).
  app.use('/edit-sessions/:token', cors({ origin: '*', allowMethods: ['GET'] }));
  app.get('/edit-sessions/:token', (c) => {
    const s = sessions.get(c.req.param('token'));
    if (!s) return c.json({ error: 'sessão inválida ou expirada' }, 404);
    return c.json({ accountId: s.accountId, appOrigin: s.appOrigin, expiresAt: s.expiresAt });
  });

  return app;
}
