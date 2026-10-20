// Núcleo do SDK React Native, sem importar react-native (testável no Node). Decisão = packages/sdk (flags) e
// packages/snippet/bucket (campanhas, com atribuição persistida como no site). Ver docs/SDK-MOBILE.md.
import { flagEnabled, flagVariables, type Attributes, type Decision } from '@abtest/sdk';
import type { SdkConfig } from '@abtest/shared/sdk-config';
import { assign } from '@abtest/snippet/bucket';

export type { Attributes, Decision };
type Props = Record<string, string | number | boolean>;
type Event = Record<string, unknown>;

/** Armazenamento chave/valor assíncrono: a interface do AsyncStorage (passe o módulo direto) ou equivalente. */
export interface KeyValueStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

/** Fallback sem persistência: id do visitante e fila duram só enquanto o app está aberto. */
export function memoryStorage(): KeyValueStorage {
  const m = new Map<string, string>();
  return {
    getItem: async (k) => m.get(k) ?? null,
    setItem: async (k, v) => void m.set(k, v),
  };
}

/** O que usamos do AppState do React Native. */
export interface AppStateLike {
  addEventListener(type: 'change', listener: (state: string) => void): { remove(): void };
}

export interface DeviceInfo {
  /** 'ios' | 'android' | ... (Platform.OS). */
  platform: string;
  osVersion?: string;
  type: 'mobile' | 'tablet';
  /** Largura da janela em dp. */
  width?: number;
}

export interface MobileClientOptions {
  accountId: string;
  /** Base da CDN; o SDK baixa `<conta>.sdk.json` (o mesmo arquivo dos SDKs server-side). */
  cdnUrl: string;
  /** AsyncStorage (ou outro com a mesma interface). Sem ele, nada sobrevive ao fechar o app. */
  storage?: KeyValueStorage;
  /** Identificador do app nas URLs das telas (`app://<appId>/<Tela>`). Padrão: 'app'. */
  appId?: string;
  /** Versão do app (ex.: de expo-application ou react-native-device-info): vira o atributo `appVersion`. */
  appVersion?: string;
  /** Atributos fixos para as regras das flags (somados aos do dispositivo e do identify). */
  attributes?: Attributes;
  /**
   * Id usado no sorteio. Padrão: um id anônimo gerado na 1ª abertura e guardado no storage. Passe o id do
   * usuário logado para decidir igual ao backend (SDKs server-side) e entre aparelhos.
   */
  visitorId?: string;
  /** Recarrega a config a cada N ms enquanto o app está aberto e ao voltar do background. Padrão: 5 min. */
  refreshMs?: number;
  /** Envia a fila a cada N ms (padrão 10 s), além de ao ir para o background. */
  flushMs?: number;
  /** Eventos por requisição ao /collect (máx. 200; padrão 50). */
  batchSize?: number;
  /** Teto da fila offline; acima dele os mais antigos saem. Padrão 1000. */
  maxQueue?: number;
  /** Config já carregada (testes, sem rede). */
  config?: SdkConfig;
  fetch?: typeof fetch;
  appState?: AppStateLike;
  device?: DeviceInfo;
}

const SESSION_MS = 30 * 60_000;

const rid = () =>
  globalThis.crypto?.randomUUID?.() ??
  `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}${Math.random().toString(36).slice(2, 10)}`;

const parse = <T>(s: string | null | undefined): T | null => {
  try {
    return s ? (JSON.parse(s) as T) : null;
  } catch {
    return null;
  }
};

/** Atributos do dispositivo para as regras de flag e para o perfil (identify). */
export const deviceAttributes = (d: DeviceInfo | undefined, appVersion?: string): Attributes => ({
  ...(d ? { platform: d.platform, deviceType: d.type } : {}),
  ...(d?.osVersion ? { osVersion: d.osVersion } : {}),
  ...(appVersion ? { appVersion } : {}),
});

/**
 * Cliente do app. Síncrono: antes de `ready` resolver (storage lido + config do cache ou da rede), flags
 * dão false e campanhas null; os hooks re-renderizam quando fica pronto. Eventos chamados antes entram na fila
 * assim que o id do visitante é conhecido.
 */
export function createMobileClient(o: MobileClientOptions) {
  const storage = o.storage ?? memoryStorage();
  const f = o.fetch ?? globalThis.fetch.bind(globalThis);
  const key = (k: string) => `abt:${o.accountId}:${k}`;
  const appUrl = (screen = '') => `app://${o.appId ?? 'app'}/${screen}`;
  const refreshMs = o.refreshMs ?? 5 * 60_000;
  const batchSize = Math.min(o.batchSize ?? 50, 200);
  const maxQueue = o.maxQueue ?? 1000;
  const device = o.device;

  let config: SdkConfig | null = o.config ?? null;
  let loadedAt = 0;
  let visitorId = o.visitorId ?? '';
  let assignments: Record<string, string> = {};
  let profile: { userId?: string; attrs: Props } = { attrs: {} };
  let queue: Event[] = [];
  let screenUrl = appUrl();
  let sessionId = rid();
  let lastActive = Date.now();
  let isReady = false;
  let revision = 0;
  let closed = false;
  const exposed = new Set<string>();
  const listeners = new Set<() => void>();
  const notify = () => {
    revision++;
    for (const l of listeners) l();
  };

  // Escrita da fila/atribuições agrupada (uma por tique, não uma por evento).
  let saving: Promise<void> | null = null;
  const persist = () =>
    (saving ??= Promise.resolve().then(async () => {
      saving = null;
      try {
        await Promise.all([
          storage.setItem(key('q'), JSON.stringify(queue)),
          storage.setItem(key('a'), JSON.stringify(assignments)),
          storage.setItem(key('p'), JSON.stringify(profile)),
        ]);
      } catch {
        /* storage cheio/indisponível: segue em memória */
      }
    }));

  const base = (type: string, ts: number) => ({
    eventId: rid(),
    ts,
    accountId: o.accountId,
    visitorId,
    url: screenUrl,
    sessionId,
    type,
  });
  /** Eventos antes do `ready` esperam o id do visitante (mantendo a hora em que aconteceram). */
  const enqueue = (make: (ts: number) => Event[]) => {
    const ts = Date.now();
    lastActive = ts;
    const go = () => {
      queue.push(...make(ts));
      if (queue.length > maxQueue) queue.splice(0, queue.length - maxQueue);
      void persist();
    };
    if (isReady) go();
    else void ready.then(go);
  };

  const load = async () => {
    // Com config em mãos, falha só tenta de novo no próximo refresh; sem nenhuma, tenta a cada envio da fila.
    if (config) loadedAt = Date.now();
    try {
      const r = await f(`${o.cdnUrl.replace(/\/$/, '')}/${o.accountId}.sdk.json`);
      if (!r.ok) return;
      const next = (await r.json()) as SdkConfig;
      loadedAt = Date.now();
      if (next.version !== config?.version || !config) {
        config = next;
        void storage.setItem(key('c'), JSON.stringify(next)).catch(() => {});
        notify();
      }
    } catch {
      /* offline: mantém a config atual (cache) */
    }
  };

  const attrs = (extra?: Attributes): Attributes => ({
    ...deviceAttributes(device, o.appVersion),
    ...o.attributes,
    ...profile.attrs,
    ...extra,
  });

  let sending: Promise<void> | null = null;
  /** Envia a fila em lotes. Rede fora/5xx/429: fica para depois. Outro 4xx: lote inválido, descarta. */
  const flush = (): Promise<void> =>
    (sending ??= (async () => {
      try {
        while (queue.length && config?.trackingUrl) {
          const batch = queue.slice(0, batchSize);
          let status: number;
          try {
            status = (
              await f(config.trackingUrl, {
                method: 'POST',
                body: JSON.stringify({ events: batch }),
                headers: { 'content-type': 'text/plain' },
              })
            ).status;
          } catch {
            return;
          }
          if (status >= 500 || status === 429) return;
          // Novos eventos podem ter entrado durante o envio: tira só os enviados.
          queue = queue.filter((e) => !batch.includes(e));
          void persist();
        }
      } finally {
        sending = null;
      }
    })());

  const ready: Promise<void> = (async () => {
    const [v, a, p, q, c] = await Promise.all(
      ['v', 'a', 'p', 'q', 'c'].map((k) => storage.getItem(key(k)).catch(() => null)),
    );
    if (o.visitorId === undefined) {
      visitorId = v || rid();
      if (!v) await storage.setItem(key('v'), visitorId).catch(() => {});
    }
    assignments = parse(a) ?? {};
    profile = parse(p) ?? { attrs: {} };
    queue = parse<Event[]>(q) ?? [];
    if (!config) {
      config = parse(c);
      // Sem cache: espera a rede (1ª abertura). Com cache: decide já e atualiza em segundo plano.
      if (config) void load();
      else await load();
    }
    isReady = true;
    // Atributos do aparelho no perfil (CDP), uma vez por abertura.
    const dev = deviceAttributes(device, o.appVersion) as Props;
    if (Object.keys(dev).length) queue.push({ ...base('identify', Date.now()), attrs: dev });
    void persist();
    notify();
  })();

  const timer = setInterval(() => {
    if (Date.now() - loadedAt > refreshMs) void load();
    void flush();
  }, o.flushMs ?? 10_000);
  (timer as { unref?(): void }).unref?.();

  const sub = o.appState?.addEventListener('change', (state) => {
    if (state === 'active') {
      if (Date.now() - lastActive > SESSION_MS) sessionId = rid();
      lastActive = Date.now();
      if (Date.now() - loadedAt > refreshMs) void load();
    } else if (state === 'background') {
      lastActive = Date.now();
      void persist();
      void flush();
    }
  });

  const decide = (experimentKey: string, persistIt: boolean) => {
    const exp = config?.experiments.find((e) => e.key === experimentKey);
    if (!exp || !isReady) return null;
    const stored = persistIt ? assignments : { ...assignments };
    const before = stored[exp.id];
    const v = assign(visitorId, exp, stored);
    if (persistIt && stored[exp.id] !== before) void persist();
    return v && { exp, v };
  };

  return {
    ready,
    get isReady() {
      return isReady;
    },
    /** Id do visitante usado no sorteio ('' até `ready`). */
    get visitorId() {
      return visitorId;
    },
    /** Versão da config publicada (0 = nenhuma). */
    get version() {
      return config?.version ?? 0;
    },
    /** Muda quando a config, o perfil ou o estado de pronto mudam (para os hooks). */
    get revision() {
      return revision;
    },
    subscribe(l: () => void) {
      listeners.add(l);
      return () => void listeners.delete(l);
    },

    /** Flag ativa? Atributos: aparelho + `attributes` + identify + os desta chamada. */
    isEnabled(flag: string, extra?: Attributes): boolean {
      return isReady && flagEnabled(config, flag, visitorId, attrs(extra));
    },
    getVariables(flag: string, extra?: Attributes): Record<string, unknown> {
      return isReady ? flagVariables(config, flag, visitorId, attrs(extra)) : {};
    },
    /**
     * Variação da campanha server-side. A 1ª escolha fica guardada (mudar pesos depois não troca a variação de
     * quem já viu, igual ao site). Registra a exposição uma vez por abertura do app.
     */
    getVariation(experimentKey: string): Decision | null {
      const d = decide(experimentKey, true);
      if (!d) return null;
      const { exp, v } = d;
      if (!exposed.has(exp.id)) {
        exposed.add(exp.id);
        enqueue((ts) => [
          {
            ...base('exposure', ts),
            experimentId: exp.id,
            experimentKey: exp.key,
            variationId: v.id,
            variationKey: v.key,
          },
        ]);
      }
      return { key: v.key, variation: v.key, variables: v.variables ?? {} };
    },
    /** Evento; vira conversão nas campanhas em que o visitante está e que têm meta customizada com este nome. */
    track(event: string, opts: { value?: number; props?: Props } = {}) {
      const value = opts.value !== undefined ? { value: opts.value } : {};
      enqueue((ts) => {
        const out: Event[] = [
          { ...base('event', ts), name: event, ...value, ...(opts.props ? { props: opts.props } : {}) },
        ];
        for (const exp of config?.experiments ?? []) {
          if (!exp.goals.some((g) => g.type === 'custom' && g.event === event)) continue;
          const d = decide(exp.key, false);
          if (!d) continue;
          for (const g of exp.goals)
            if (g.type === 'custom' && g.event === event)
              out.push({
                ...base('conversion', ts),
                experimentId: exp.id,
                experimentKey: exp.key,
                variationId: d.v.id,
                variationKey: d.v.key,
                goalId: g.id,
                goalKey: g.key,
                ...value,
              });
        }
        return out;
      });
    },
    /**
     * Tela vista = `pageview` com url `app://<appId>/<nome>` e title = nome: entra em funis (passo por URL),
     * jornadas, páginas e perfis como as páginas do site. Os eventos seguintes levam a url da tela.
     */
    screen(name: string) {
      enqueue((ts) => {
        screenUrl = appUrl(name);
        return [
          {
            ...base('pageview', ts),
            device: device?.type ?? 'mobile',
            title: name.slice(0, 300),
            ...(device?.width ? { vw: Math.round(device.width) } : {}),
          },
        ];
      });
    },
    /**
     * Liga o visitante a um usuário (CDP) e/ou grava atributos. Os atributos também passam a valer nas regras
     * das flags. Não muda o id do sorteio (use `visitorId` na criação para isso).
     */
    identify(userId?: string, attributes?: Props) {
      if (userId) profile.userId = userId;
      if (attributes) profile.attrs = { ...profile.attrs, ...attributes };
      void persist();
      notify();
      enqueue((ts) => [
        {
          ...base('identify', ts),
          ...(userId ? { userId } : {}),
          ...(attributes ? { attrs: attributes } : {}),
        },
      ]);
    },
    flush,
    /** Para timers e o listener do AppState e envia o que falta. */
    async close() {
      if (closed) return;
      closed = true;
      clearInterval(timer);
      sub?.remove();
      await ready;
      await persist();
      await flush();
    },
  };
}
export type MobileClient = ReturnType<typeof createMobileClient>;
