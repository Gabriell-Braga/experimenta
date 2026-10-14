import type { z } from 'zod';
import { EnvelopeSchema, type Envelope, type Events, type Methods } from './rpc';

type Handlers<M extends Methods> = {
  [K in keyof M]: (
    params: z.output<M[K]['params']>,
  ) => z.input<M[K]['result']> | Promise<z.input<M[K]['result']>>;
};

export interface PeerOptions<LM extends Methods, RM extends Methods, LE extends Events, RE extends Events> {
  /** Janela onde ouvimos mensagens. */
  self: Window;
  /** Janela do outro lado (função: o contentWindow do iframe muda a cada navegação). */
  remote: () => Window | null | undefined;
  /** Origin EXATO do outro lado: usado como targetOrigin e conferido em cada mensagem recebida. */
  origin: string;
  localMethods: LM;
  remoteMethods: RM;
  localEvents: LE;
  remoteEvents: RE;
  handlers: Handlers<LM>;
  timeoutMs?: number;
}

export interface Peer<RM extends Methods, LE extends Events, RE extends Events> {
  call<K extends keyof RM & string>(
    method: K,
    params: z.input<RM[K]['params']>,
  ): Promise<z.output<RM[K]['result']>>;
  emit<K extends keyof LE & string>(event: K, payload: z.input<LE[K]>): void;
  on<K extends keyof RE & string>(event: K, fn: (payload: z.output<RE[K]>) => void): () => void;
  dispose(): void;
}

let seq = 0;

/** Ponta tipada e validada do protocolo. Mensagens de outra origem/janela ou fora do schema são ignoradas. */
export function createPeer<LM extends Methods, RM extends Methods, LE extends Events, RE extends Events>(
  o: PeerOptions<LM, RM, LE, RE>,
): Peer<RM, LE, RE> {
  if (!o.origin || o.origin === '*') throw new Error('rpc: origin exato é obrigatório');
  const timeoutMs = o.timeoutMs ?? 5000;
  const pending = new Map<
    string,
    { resolve: (v: unknown) => void; reject: (e: Error) => void; method: string }
  >();
  const listeners = new Map<string, Set<(p: unknown) => void>>();

  const post = (msg: Envelope) => o.remote()?.postMessage(msg, o.origin);

  const onMessage = async (ev: MessageEvent) => {
    if (ev.origin !== o.origin || ev.source !== o.remote()) return;
    const parsed = EnvelopeSchema.safeParse(ev.data);
    if (!parsed.success) return;
    const msg = parsed.data;
    if (msg.kind === 'req') {
      const def = o.localMethods[msg.method];
      const handler = (o.handlers as Record<string, (p: unknown) => unknown>)[msg.method];
      if (!def || !handler)
        return post({
          abt: 1,
          kind: 'res',
          id: msg.id,
          ok: false,
          error: `método desconhecido: ${msg.method}`,
        });
      const params = def.params.safeParse(msg.params ?? {});
      if (!params.success)
        return post({
          abt: 1,
          kind: 'res',
          id: msg.id,
          ok: false,
          error: `parâmetros inválidos: ${params.error.message}`,
        });
      try {
        post({ abt: 1, kind: 'res', id: msg.id, ok: true, result: await handler(params.data) });
      } catch (e) {
        post({
          abt: 1,
          kind: 'res',
          id: msg.id,
          ok: false,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    } else if (msg.kind === 'res') {
      const p = pending.get(msg.id);
      if (!p) return;
      pending.delete(msg.id);
      if (!msg.ok) return p.reject(new Error(msg.error ?? 'erro remoto'));
      const result = o.remoteMethods[p.method]!.result.safeParse(msg.result);
      if (result.success) p.resolve(result.data);
      else p.reject(new Error(`resposta inválida de ${p.method}: ${result.error.message}`));
    } else {
      const schema = o.remoteEvents[msg.event];
      const payload = schema?.safeParse(msg.payload);
      if (!payload?.success) return;
      listeners.get(msg.event)?.forEach((fn) => fn(payload.data));
    }
  };
  o.self.addEventListener('message', onMessage);

  return {
    call(method, params) {
      const id = `${Date.now().toString(36)}-${++seq}`;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`rpc: timeout em ${method}`));
        }, timeoutMs);
        pending.set(id, {
          method,
          resolve: (v) => (clearTimeout(timer), resolve(v as never)),
          reject: (e) => (clearTimeout(timer), reject(e)),
        });
        post({ abt: 1, kind: 'req', id, method, params });
      });
    },
    emit(event, payload) {
      const parsed = o.localEvents[event]!.parse(payload);
      post({ abt: 1, kind: 'evt', event, payload: parsed });
    },
    on(event, fn) {
      let set = listeners.get(event);
      if (!set) listeners.set(event, (set = new Set()));
      set.add(fn as (p: unknown) => void);
      return () => set!.delete(fn as (p: unknown) => void);
    },
    dispose() {
      o.self.removeEventListener('message', onMessage);
      for (const p of pending.values()) p.reject(new Error('rpc: encerrado'));
      pending.clear();
    },
  };
}
