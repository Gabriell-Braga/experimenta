import { z, type OpenAPIHono } from '@hono/zod-openapi';
import type { AuthVars } from './auth';

// Peças comuns das rotas (app.ts e src/routes/*).
export type Api = OpenAPIHono<{ Variables: AuthVars }>;

export const ErrorSchema = z.object({ error: z.string() }).openapi('Error');

export const json = <T extends z.ZodTypeAny>(schema: T, description: string) => ({
  content: { 'application/json': { schema } },
  description,
});
export const errors = {
  401: json(ErrorSchema, 'não autenticado'),
  403: json(ErrorSchema, 'sem permissão'),
  404: json(ErrorSchema, 'não encontrado'),
};
export const security = [{ bearer: [] }];

/** Resposta de relatório (forma documentada na descrição; agregados variam por módulo). */
export const Report = z.any();

/** Período dos relatórios: últimos `days` dias (padrão 30) ou intervalo explícito. */
export const PeriodQuery = z.object({
  days: z.coerce.number().int().min(1).max(365).default(30),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});
export function period(q: z.infer<typeof PeriodQuery>, now = Date.now()) {
  const to = q.to ? new Date(q.to) : new Date(now);
  const from = q.from ? new Date(q.from) : new Date(to.getTime() - q.days * 86_400_000);
  return { from, to };
}
