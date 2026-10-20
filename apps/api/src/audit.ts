import type { Context, MiddlewareHandler } from 'hono';
import type { AuthVars } from './auth';
import type { ActivityInput, Repo, User } from './repo';

// Histórico de atividades (auditoria, fase 16.3), registrado num ponto só: um middleware olha cada escrita bem
// sucedida (2xx) das rotas abaixo e grava uma linha. Rotas novas que mudam configuração entram nesta tabela.
// Fora dela de propósito: login, troca de conta, sessão de edição, ideias da IA e treinos (não mudam o que o
// site recebe) e tudo do snippet (coleta, gravação).

type Json = Record<string, unknown>;
/** Estado do alvo antes da escrita (nome para exclusões, status para saber se iniciou/pausou). */
interface Before {
  name: string;
  status?: string;
}
interface Ctx {
  user: User;
  p: Record<string, string>;
  body: Json;
  res: Json;
  before: Before | null;
}
interface Rule {
  method: string;
  path: string;
  target: string | ((x: Ctx) => string);
  action: string | ((x: Ctx) => string);
  before?: (repo: Repo, accountId: string, p: Record<string, string>) => Promise<Before | null>;
  name?: (x: Ctx) => unknown;
  id?: (x: Ctx) => unknown;
  detail?: (x: Ctx) => unknown;
  /** Rota sem login (aceite de convite): a pessoa vem da resposta. */
  actor?: (res: Json) => User | undefined;
}

/** Ação de mudança de status (experimento ou campanha). */
const STATUS_ACTION: Record<string, string> = {
  running: 'start',
  paused: 'pause',
  archived: 'archive',
  draft: 'draft',
};
const statusChange = (before: Before | null, status: unknown, fallback = 'update') =>
  before && typeof status === 'string' && before.status !== status
    ? (STATUS_ACTION[status] ?? fallback)
    : fallback;

const experimentBefore: Rule['before'] = async (repo, acc, p) => {
  const r = await repo.getExperiment(acc, p.id!);
  return r && { name: r.experiment.name, status: r.experiment.status };
};
const entityBefore =
  (kind?: string): Rule['before'] =>
  async (repo, acc, p) => {
    const e = await repo.getEntity<{ status?: string }>(acc, kind ?? p.kind!, p.id!);
    return e && { name: e.name, status: e.data?.status };
  };
const memberBefore: Rule['before'] = async (repo, acc, p) => {
  const u = await repo.getUser(acc, p.id!);
  return u ? { name: u.name } : null;
};
const exp = (x: Ctx) => x.body.experiment as Json | undefined;
const beforeName = (x: Ctx) => x.before?.name;

const RULES: Rule[] = [
  { method: 'POST', path: '/projects', target: 'project', action: 'create', name: (x) => x.body.name },
  {
    method: 'POST',
    path: '/experiments',
    target: 'experiment',
    action: 'create',
    name: (x) => exp(x)?.name,
    id: (x) => exp(x)?.id,
  },
  {
    method: 'PUT',
    path: '/experiments/:id',
    target: 'experiment',
    before: experimentBefore,
    action: (x) => (x.before ? statusChange(x.before, exp(x)?.status) : 'create'),
    name: (x) => exp(x)?.name,
  },
  {
    method: 'PATCH',
    path: '/experiments/:id/status',
    target: 'experiment',
    before: experimentBefore,
    action: (x) => statusChange(x.before, x.body.status),
    name: beforeName,
  },
  {
    method: 'DELETE',
    path: '/experiments/:id',
    target: 'experiment',
    before: experimentBefore,
    action: 'delete',
    name: beforeName,
  },
  {
    method: 'POST',
    path: '/experiments/:id/versions/:v/restore',
    target: 'experiment',
    before: experimentBefore,
    action: 'restore',
    name: beforeName,
    detail: (x) => `versão ${x.p.v}`,
  },
  {
    method: 'POST',
    path: '/experiments/:id/duplicate',
    target: 'experiment',
    before: experimentBefore,
    action: 'duplicate',
    name: beforeName,
  },
  {
    method: 'POST',
    path: '/experiments/:id/rebalance',
    target: 'experiment',
    before: experimentBefore,
    action: 'rebalance',
    name: beforeName,
  },
  {
    method: 'POST',
    path: '/publish',
    target: 'publish',
    action: 'publish',
    name: (x) => `versão ${x.res.version}`,
    id: () => null,
  },
  {
    method: 'PUT',
    path: '/account/settings',
    target: 'settings',
    action: 'update',
    name: () => 'Configurações da conta',
    id: () => null,
  },
  {
    method: 'POST',
    path: '/entities/:kind',
    target: (x) => x.p.kind!,
    action: 'create',
    name: (x) => x.body.name,
    id: (x) => x.res.id,
  },
  {
    method: 'PUT',
    path: '/entities/:kind/:id',
    target: (x) => x.p.kind!,
    before: entityBefore(),
    action: (x) => statusChange(x.before, (x.body.data as Json | undefined)?.status),
    name: (x) => x.body.name,
  },
  {
    method: 'DELETE',
    path: '/entities/:kind/:id',
    target: (x) => x.p.kind!,
    before: entityBefore(),
    action: 'delete',
    name: beforeName,
  },
  {
    method: 'POST',
    path: '/account/api-keys',
    target: 'apikey',
    action: 'create',
    name: (x) => x.body.name,
    id: (x) => x.res.id,
    detail: (x) => x.body.role ?? 'viewer',
  },
  {
    method: 'DELETE',
    path: '/account/api-keys/:id',
    target: 'apikey',
    before: entityBefore('apikey'),
    action: 'delete',
    name: beforeName,
  },
  {
    method: 'POST',
    path: '/invites',
    target: 'invite',
    action: 'create',
    name: (x) => x.body.email,
    id: (x) => x.res.id,
    detail: (x) => x.body.role,
  },
  {
    method: 'DELETE',
    path: '/invites/:id',
    target: 'invite',
    before: entityBefore('invite'),
    action: 'delete',
    name: beforeName,
  },
  {
    method: 'PUT',
    path: '/members/:id',
    target: 'member',
    before: memberBefore,
    action: 'role',
    name: beforeName,
    detail: (x) => `${x.body.role}${x.body.canPublishJs && x.body.role !== 'owner' ? ' + JS' : ''}`,
  },
  {
    method: 'DELETE',
    path: '/members/:id',
    target: 'member',
    before: memberBefore,
    action: (x) => (x.p.id === x.user.id ? 'leave' : 'delete'),
    name: beforeName,
  },
  {
    method: 'POST',
    path: '/auth/invites/:token/accept',
    target: 'member',
    action: 'join',
    actor: (res) => res.user as User | undefined,
    name: (x) => x.user.name,
    id: (x) => x.user.id,
    detail: (x) => x.user.role,
  },
];

/** Casa `/experiments/:id/status` com o caminho da requisição; devolve os parâmetros. */
export function matchPath(pattern: string, path: string): Record<string, string> | null {
  const a = pattern.split('/');
  const b = path.replace(/\/+$/, '').split('/');
  if (a.length !== b.length) return null;
  const p: Record<string, string> = {};
  for (let i = 0; i < a.length; i++) {
    if (a[i]!.startsWith(':')) {
      try {
        p[a[i]!.slice(1)] = decodeURIComponent(b[i]!);
      } catch {
        return null;
      }
    } else if (a[i] !== b[i]) return null;
  }
  return p;
}

const str = (v: unknown, max = 200) =>
  (typeof v === 'string' || typeof v === 'number' ? String(v) : '').slice(0, max);

async function readJson(r: { json(): Promise<unknown> }): Promise<Json> {
  try {
    const v = await r.json();
    return v && typeof v === 'object' ? (v as Json) : {};
  } catch {
    return {};
  }
}

/** No Worker grava depois de responder (waitUntil); no Node espera (testes determinísticos). */
async function later(c: Context, p: Promise<unknown>) {
  const safe = p.catch((e) => console.error('auditoria:', e));
  try {
    c.executionCtx.waitUntil(safe);
  } catch {
    await safe;
  }
}

export function auditLog(repo: Repo): MiddlewareHandler<{ Variables: AuthVars }> {
  return async (c, next) => {
    const method = c.req.method;
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return next();
    let rule: Rule | undefined;
    let p: Record<string, string> | null = null;
    for (const r of RULES)
      if (r.method === method && (p = matchPath(r.path, c.req.path))) {
        rule = r;
        break;
      }
    const pre = c.get('user') as User | undefined;
    if (!rule || !p || (!pre && !rule.actor)) return next();
    const before = pre && rule.before ? await rule.before(repo, pre.accountId, p).catch(() => null) : null;
    await next();
    if (c.res.status >= 300) return;
    const res = await readJson(c.res.clone());
    const user = rule.actor ? rule.actor(res) : pre;
    if (!user?.accountId) return;
    const x: Ctx = { user, p, body: await readJson(c.req), res, before };
    const a: ActivityInput = {
      // Chave de API não é pessoa: fica sem userId, com o nome da chave.
      userId: user.id.startsWith('apikey:') ? null : user.id,
      userName: user.id.startsWith('apikey:') ? `Chave de API: ${user.name}` : user.name,
      action: typeof rule.action === 'function' ? rule.action(x) : rule.action,
      targetType: typeof rule.target === 'function' ? rule.target(x) : rule.target,
      targetId: str(rule.id ? rule.id(x) : p.id) || null,
      targetName: str(rule.name?.(x)) || '—',
      detail: str(rule.detail?.(x)) || null,
    };
    await later(c, repo.logActivity(user.accountId, a));
  };
}
