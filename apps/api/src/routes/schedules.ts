import { createRoute, z } from '@hono/zod-openapi';
import type { AppDeps } from '../app';
import { forbid, hasRole } from '../auth';
import { errors, ErrorSchema, json, security, type Api } from '../http';
import type { Repo, User } from '../repo';
import { dispatchNotice, dispatchPublish } from '../webhooks';
import { canApprove, requestPublish, settleRequests } from './approvals';

// Agendamento (fase 17.4, D-078): iniciar/pausar um experimento ou campanha numa data/hora. Entidade interna
// `schedule` (fora das rotas genéricas, sem tabela nova); quem executa é o job de hora em hora (`runSchedules`,
// chamado em `hourlyJobs`), então a ação acontece até 1 h depois do horário. Datas sempre em UTC (ISO).

export const SCHEDULE_PATHS = ['/schedules', '/schedules/*'];
export const SCHEDULE_KIND = 'schedule';
export const SCHEDULE_ACTIONS = { start: 'running', pause: 'paused' } as const;
export type ScheduleAction = keyof typeof SCHEDULE_ACTIONS;
/** Nome de quem executa (atividades, pedidos de aprovação). */
export const SCHEDULER_NAME = 'Agendamento';
const MAX_PER_EXPERIMENT = 10;
const MAX_AHEAD_MS = 366 * 86_400_000;

export interface ScheduleData {
  experimentId: string;
  action: ScheduleAction;
  /** ISO em UTC. */
  at: string;
  /** Quem agendou: na execução, decide se a publicação vale como aprovada (D-078). */
  by: { id: string; name: string };
}

const ScheduleOut = z
  .object({
    id: z.string(),
    experimentId: z.string(),
    experimentName: z.string(),
    action: z.enum(['start', 'pause']),
    at: z.string(),
    createdBy: z.string(),
    createdAt: z.string(),
  })
  .openapi('Schedule');
const Body = z.object({
  action: z.enum(['start', 'pause']),
  at: z.string().datetime({ offset: true }),
});
const ExpParam = z.object({ id: z.string().openapi({ param: { name: 'id', in: 'path' } }) });
const SidParam = ExpParam.extend({ sid: z.string().openapi({ param: { name: 'sid', in: 'path' } }) });

/** Normaliza para UTC e confere a janela (futuro, até 1 ano). */
function checkAt(at: string, now = Date.now()): string | { error: string } {
  const t = Date.parse(at);
  if (!(t > now)) return { error: 'escolha uma data/hora no futuro' };
  if (t - now > MAX_AHEAD_MS) return { error: 'agende no máximo 1 ano à frente' };
  return new Date(t).toISOString();
}

export function scheduleRoutes(app: Api, repo: Repo) {
  app.openapi(
    createRoute({
      method: 'get',
      path: '/schedules',
      tags: ['experiments'],
      security,
      summary: 'Agendamentos pendentes da conta (ou de um experimento), do mais próximo ao mais distante',
      request: { query: z.object({ experimentId: z.string().optional() }) },
      responses: { 200: json(z.array(ScheduleOut), 'agendamentos'), ...errors },
    }),
    async (c) => {
      const { experimentId } = c.req.valid('query');
      const all = await repo.listEntities<ScheduleData>(c.get('user').accountId, SCHEDULE_KIND);
      return c.json(
        all
          .filter((s) => !experimentId || s.data.experimentId === experimentId)
          .sort((a, b) => (a.data.at < b.data.at ? -1 : 1))
          .map((s) => ({
            id: s.id,
            experimentId: s.data.experimentId,
            experimentName: s.name,
            action: s.data.action,
            at: s.data.at,
            createdBy: s.data.by.name,
            createdAt: s.createdAt,
          })),
        200,
      );
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/experiments/{id}/schedules',
      tags: ['experiments'],
      security,
      summary: 'Agenda iniciar ou pausar (executa na verificação de hora em hora: até 1 h depois)',
      request: { params: ExpParam, body: json(Body, 'ação e data/hora (ISO)') },
      responses: {
        201: json(z.object({ id: z.string(), at: z.string() }), 'agendado'),
        400: json(ErrorSchema, 'inválido'),
        ...errors,
      },
    }),
    async (c) => {
      const user = c.get('user');
      if (!hasRole(user, 'editor')) return forbid(c);
      const { id } = c.req.valid('param');
      const { action, at: raw } = c.req.valid('json');
      const rec = await repo.getExperiment(user.accountId, id);
      if (!rec) return c.json({ error: 'experimento não encontrado' }, 404);
      if (rec.experiment.status === 'archived')
        return c.json({ error: 'desarquive o experimento antes de agendar' }, 400);
      const at = checkAt(raw);
      if (typeof at !== 'string') return c.json(at, 400);
      const mine = (await repo.listEntities<ScheduleData>(user.accountId, SCHEDULE_KIND)).filter(
        (s) => s.data.experimentId === id,
      );
      if (mine.length >= MAX_PER_EXPERIMENT)
        return c.json({ error: `no máximo ${MAX_PER_EXPERIMENT} agendamentos por experimento` }, 400);
      const sid = await repo.saveEntity(user.accountId, {
        kind: SCHEDULE_KIND,
        name: rec.experiment.name,
        data: { experimentId: id, action, at, by: { id: user.id, name: user.name } } satisfies ScheduleData,
        userId: user.id,
      });
      return c.json({ id: sid, at }, 201);
    },
  );

  app.openapi(
    createRoute({
      method: 'put',
      path: '/experiments/{id}/schedules/{sid}',
      tags: ['experiments'],
      security,
      summary: 'Muda a ação ou a data/hora de um agendamento (quem edita passa a ser quem agendou)',
      request: { params: SidParam, body: json(Body, 'ação e data/hora (ISO)') },
      responses: {
        200: json(z.object({ id: z.string(), at: z.string() }), 'salvo'),
        400: json(ErrorSchema, 'inválido'),
        ...errors,
      },
    }),
    async (c) => {
      const user = c.get('user');
      if (!hasRole(user, 'editor')) return forbid(c);
      const { id, sid } = c.req.valid('param');
      const { action, at: raw } = c.req.valid('json');
      const s = await repo.getEntity<ScheduleData>(user.accountId, SCHEDULE_KIND, sid);
      if (!s || s.data.experimentId !== id) return c.json({ error: 'agendamento não encontrado' }, 404);
      const at = checkAt(raw);
      if (typeof at !== 'string') return c.json(at, 400);
      await repo.saveEntity(user.accountId, {
        id: sid,
        kind: SCHEDULE_KIND,
        name: s.name,
        data: { ...s.data, action, at, by: { id: user.id, name: user.name } } satisfies ScheduleData,
      });
      return c.json({ id: sid, at }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'delete',
      path: '/experiments/{id}/schedules/{sid}',
      tags: ['experiments'],
      security,
      summary: 'Cancela um agendamento',
      request: { params: SidParam },
      responses: { 204: { description: 'cancelado' }, ...errors },
    }),
    async (c) => {
      const user = c.get('user');
      if (!hasRole(user, 'editor')) return forbid(c);
      const { id, sid } = c.req.valid('param');
      const s = await repo.getEntity<ScheduleData>(user.accountId, SCHEDULE_KIND, sid);
      if (!s || s.data.experimentId !== id) return c.json({ error: 'agendamento não encontrado' }, 404);
      await repo.deleteEntity(user.accountId, SCHEDULE_KIND, sid);
      return c.body(null, 204);
    },
  );
}

/**
 * Quem publica a execução: usuário de sistema. Pode aprovar (owner + "publica JS") só se TODOS que agendaram as
 * ações desta rodada ainda podem aprovar hoje; senão é um editor sem JS, e em conta com aprovação vira pedido.
 */
export const schedulerUser = (accountId: string, approver: boolean): User => ({
  id: 'system:schedule',
  accountId,
  email: 'agendamento@sistema',
  name: SCHEDULER_NAME,
  role: approver ? 'owner' : 'editor',
  canPublishJs: approver,
  passwordHash: '',
  mfa: null,
  createdAt: new Date(0),
});

const VERB: Record<ScheduleAction, string> = { start: 'iniciar', pause: 'pausar' };

/** Executa os agendamentos vencidos da conta: muda o status, publica uma vez e registra tudo. */
async function runAccount(repo: Repo, publish: AppDeps['publish'], accountId: string, now: number) {
  const due = (await repo.listEntities<ScheduleData>(accountId, SCHEDULE_KIND))
    .filter((s) => Date.parse(s.data.at) <= now)
    .sort((a, b) => (a.data.at < b.data.at ? -1 : 1));
  if (!due.length) return;
  const done: { s: (typeof due)[number]; name: string; changed: boolean }[] = [];
  for (const s of due) {
    const rec = await repo.getExperiment(accountId, s.data.experimentId);
    // Apagado sai já (some antes de executar); arquivado não volta ao ar por agendamento.
    const status = SCHEDULE_ACTIONS[s.data.action];
    const changed = !!rec && rec.experiment.status !== status && rec.experiment.status !== 'archived';
    if (rec && changed)
      await repo.saveExperiment(accountId, {
        projectId: rec.projectId,
        editorUrl: rec.editorUrl,
        experiment: { ...rec.experiment, status },
        userId: s.data.by.id,
      });
    await repo.deleteEntity(accountId, SCHEDULE_KIND, s.id);
    if (rec) done.push({ s, name: rec.experiment.name, changed });
  }

  let outcome = '';
  const notices: Promise<unknown>[] = [];
  if (done.some((d) => d.changed) && publish) {
    const people = await Promise.all(
      [...new Set(done.filter((d) => d.changed).map((d) => d.s.data.by.id))].map((id) =>
        repo.getUser(accountId, id),
      ),
    );
    const user = schedulerUser(
      accountId,
      people.every((u) => !!u && canApprove(u)),
    );
    const r = await publish(accountId, user);
    if (!('error' in r)) {
      outcome = `publicado na versão ${r.version}`;
      await repo.logActivity(accountId, activity('publish', 'publish', null, `versão ${r.version}`, null));
      notices.push(dispatchPublish(repo, accountId, r.version));
      if (user.canPublishJs)
        for (const req of await settleRequests(repo, user, r.version))
          notices.push(dispatchNotice(repo, accountId, 'approval', { status: req.status, request: req }));
    } else if (r.needsApproval) {
      const note = done
        .filter((d) => d.changed)
        .map((d) => `${VERB[d.s.data.action]} "${d.name}" (agendado por ${d.s.data.by.name})`)
        .join('; ');
      const { request, created } = await requestPublish(repo, user, note.slice(0, 1000));
      outcome = 'aguardando aprovação para publicar';
      await repo.logActivity(accountId, activity('request', 'publish', request.id, SCHEDULER_NAME, note));
      if (created) notices.push(dispatchNotice(repo, accountId, 'approval', { status: 'pending', request }));
    } else outcome = `não publicado: ${r.error}`;
  }
  for (const d of done)
    await repo.logActivity(
      accountId,
      activity(
        d.s.data.action,
        'experiment',
        d.s.data.experimentId,
        d.name,
        [`agendado por ${d.s.data.by.name}`, d.changed ? outcome : 'já estava assim']
          .filter(Boolean)
          .join(' · '),
      ),
    );
  await Promise.all(notices.map((p) => p.catch(() => undefined)));
}

const activity = (
  action: string,
  targetType: string,
  targetId: string | null,
  targetName: string,
  detail: string | null,
) => ({
  userId: null,
  userName: SCHEDULER_NAME,
  action,
  targetType,
  targetId,
  targetName,
  detail: detail?.slice(0, 200) || null,
});

/** Job (de hora em hora, junto com os bandits): executa os agendamentos vencidos de todas as contas. */
export async function runSchedules(repo: Repo, publish: AppDeps['publish'], now = Date.now()) {
  for (const accountId of await repo.listAccountsWithEntity(SCHEDULE_KIND))
    await runAccount(repo, publish, accountId, now).catch((e) =>
      console.error('[api] agendamento', accountId, e),
    );
}
