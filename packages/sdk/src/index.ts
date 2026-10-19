// SDK server-side do Experimenta: feature flags e campanhas server-side avaliadas localmente (sem ida à API
// por decisão), com o mesmo bucketing determinístico do snippet. Eventos vão para o mesmo /collect.
import { flagRuleMatches, type SdkConfig } from '@abtest/shared/sdk-config';
import { bucketOf, chooseVariation, BUCKETS } from '@abtest/snippet/bucket';

export type Attributes = Record<string, string | number | boolean | undefined>;

export interface ClientOptions {
  accountId: string;
  /** Base da CDN (padrão: https://<api>/cdn). O SDK baixa `<conta>.sdk.json`. */
  cdnUrl: string;
  /** Recarrega a config a cada N ms (0 = nunca). Padrão: 60 s. */
  refreshMs?: number;
  fetch?: typeof fetch;
  /** Config já carregada (testes, ambientes sem rede). */
  config?: SdkConfig;
  /** Junta eventos e envia a cada N ms (padrão 2 s). */
  flushMs?: number;
}

export interface Decision {
  key: string;
  variation: string;
  variables: Record<string, unknown>;
}

const rid = () =>
  globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;

export async function createClient(o: ClientOptions) {
  const f = o.fetch ?? globalThis.fetch.bind(globalThis);
  let config: SdkConfig | null = o.config ?? null;
  const load = async () => {
    try {
      const r = await f(`${o.cdnUrl.replace(/\/$/, '')}/${o.accountId}.sdk.json`);
      if (r.ok) config = (await r.json()) as SdkConfig;
    } catch {
      /* mantém a última config válida */
    }
  };
  if (!config) await load();
  const refresh = o.refreshMs ?? 60_000;
  const timer = refresh > 0 ? setInterval(() => void load(), refresh) : undefined;
  (timer as { unref?(): void } | undefined)?.unref?.();

  let queue: Record<string, unknown>[] = [];
  const flush = async () => {
    if (!queue.length || !config?.trackingUrl) return;
    const events = queue;
    queue = [];
    try {
      await f(config.trackingUrl, {
        method: 'POST',
        body: JSON.stringify({ events }),
        headers: { 'content-type': 'text/plain' },
      });
    } catch {
      queue.unshift(...events); // tenta de novo no próximo envio
    }
  };
  const flushTimer = setInterval(() => void flush(), o.flushMs ?? 2000);
  (flushTimer as { unref?(): void }).unref?.();
  const base = (userId: string) => ({
    eventId: rid(),
    ts: Date.now(),
    accountId: o.accountId,
    visitorId: userId,
    url: 'sdk://server',
  });
  /** Exposições já registradas neste processo (uma por usuário e campanha). */
  const exposed = new Set<string>();

  return {
    /** Flag ativa para este usuário? (ligada + regras de atributo + dentro do rollout). */
    isEnabled(key: string, userId: string, attrs: Attributes = {}): boolean {
      const flag = config?.flags.find((x) => x.key === key);
      if (!flag?.enabled) return false;
      if (!flag.rules.every((r) => flagRuleMatches(r, attrs))) return false;
      return bucketOf(userId, `flag:${key}`) < Math.round(flag.rollout * (BUCKETS / 100));
    },
    /** Variáveis da flag (vazio quando inativa). */
    getVariables(key: string, userId: string, attrs: Attributes = {}): Record<string, unknown> {
      return this.isEnabled(key, userId, attrs)
        ? (config?.flags.find((x) => x.key === key)?.variables ?? {})
        : {};
    },
    /** Variação da campanha server-side (registra a exposição na 1ª vez). null = fora do tráfego/inexistente. */
    getVariation(experimentKey: string, userId: string): Decision | null {
      const exp = config?.experiments.find((e) => e.key === experimentKey);
      if (!exp) return null;
      const v = chooseVariation(userId, exp);
      if (!v) return null;
      if (!exposed.has(`${exp.id}|${userId}`)) {
        exposed.add(`${exp.id}|${userId}`);
        queue.push({
          ...base(userId),
          type: 'exposure',
          experimentId: exp.id,
          experimentKey: exp.key,
          variationId: v.id,
          variationKey: v.key,
        });
      }
      return { key: v.key, variation: v.key, variables: v.variables ?? {} };
    },
    /**
     * Evento do usuário. Também vira conversão nas campanhas server-side em que ele está e que têm meta
     * customizada com este nome (para o relatório).
     */
    track(
      event: string,
      userId: string,
      o: { value?: number; props?: Record<string, string | number | boolean> } = {},
    ) {
      queue.push({
        ...base(userId),
        type: 'event',
        name: event,
        ...(o.value !== undefined ? { value: o.value } : {}),
        ...(o.props ? { props: o.props } : {}),
      });
      for (const exp of config?.experiments ?? []) {
        const v = chooseVariation(userId, exp);
        if (!v) continue;
        for (const g of exp.goals)
          if (g.type === 'custom' && g.event === event)
            queue.push({
              ...base(userId),
              type: 'conversion',
              experimentId: exp.id,
              experimentKey: exp.key,
              variationId: v.id,
              variationKey: v.key,
              goalId: g.id,
              goalKey: g.key,
              ...(o.value !== undefined ? { value: o.value } : {}),
            });
      }
    },
    flush,
    /** Para timers (encerrar o processo). */
    async close() {
      clearInterval(timer);
      clearInterval(flushTimer);
      await flush();
    },
    get version() {
      return config?.version ?? 0;
    },
  };
}
export type Client = Awaited<ReturnType<typeof createClient>>;
