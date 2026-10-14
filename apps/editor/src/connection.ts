import {
  agentEvents,
  agentMethods,
  appMethods,
  createPeer,
  type AgentEvents,
  type AgentMethods,
  type Peer,
} from '@abtest/shared';

export type AgentPeer = Peer<AgentMethods, Record<never, never>, AgentEvents>;

export interface ConnectOptions {
  self?: Window;
  /** Janela do site (contentWindow do iframe; muda a cada navegação). */
  frame: () => Window | null | undefined;
  /** Origin exato do site aberto no iframe. */
  siteOrigin: string;
  token: string;
  onPrompt: (kind: 'html' | 'image', title: string, initial: string) => Promise<string | null>;
}

/**
 * Lado do app no handshake: responde `hello` (vindo do iframe e do origin do site) com `hello-ack` + token
 * e expõe o peer RPC tipado. A cada navegação do iframe o snippet refaz o hello e o agent emite `ready`.
 */
export function connectAgent(o: ConnectOptions): { peer: AgentPeer; dispose(): void } {
  const self = o.self ?? window;
  const onHello = (e: MessageEvent) => {
    const frame = o.frame();
    if (!frame || e.source !== frame || e.origin !== o.siteOrigin) return;
    if ((e.data as { abt?: number; kind?: string })?.abt === 1 && e.data.kind === 'hello')
      frame.postMessage({ abt: 1, kind: 'hello-ack', token: o.token }, o.siteOrigin);
  };
  self.addEventListener('message', onHello);
  const peer = createPeer({
    self,
    remote: o.frame,
    origin: o.siteOrigin,
    localMethods: appMethods,
    remoteMethods: agentMethods,
    localEvents: {},
    remoteEvents: agentEvents,
    handlers: { prompt: ({ kind, title, initial }) => o.onPrompt(kind, title, initial) },
    timeoutMs: 8000,
  });
  return {
    peer,
    dispose() {
      self.removeEventListener('message', onHello);
      peer.dispose();
    },
  };
}
