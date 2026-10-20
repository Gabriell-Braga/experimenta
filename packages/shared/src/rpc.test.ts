import { describe, expect, test, vi } from 'vitest';
import { agentEvents, agentMethods, appMethods, type Envelope } from './rpc';
import { createPeer } from './rpc-peer';

/** Janela falsa: postMessage entrega assíncrono ao outro lado com origin/source, como o navegador. */
class FakeWindow extends EventTarget {
  other!: FakeWindow;
  constructor(public origin: string) {
    super();
  }
  postMessage(data: unknown, targetOrigin: string) {
    if (targetOrigin !== '*' && targetOrigin !== this.origin) return; // navegador descarta
    const source = this.other;
    setTimeout(() =>
      this.dispatchEvent(Object.assign(new Event('message'), { data, origin: source.origin, source })),
    );
  }
}

function pair() {
  const app = new FakeWindow('https://app.abtest.dev');
  const site = new FakeWindow('https://loja.com');
  app.other = site;
  site.other = app;
  return { app, site };
}

function connect() {
  const { app, site } = pair();
  const appPeer = createPeer({
    self: app as unknown as Window,
    remote: () => site as unknown as Window,
    origin: site.origin,
    localMethods: appMethods,
    remoteMethods: agentMethods,
    localEvents: {},
    remoteEvents: agentEvents,
    handlers: { prompt: ({ kind }) => (kind === 'image' ? '/nova.png' : null) },
    timeoutMs: 200,
  });
  const agentPeer = createPeer({
    self: site as unknown as Window,
    remote: () => app as unknown as Window,
    origin: app.origin,
    localMethods: agentMethods,
    remoteMethods: appMethods,
    localEvents: agentEvents,
    remoteEvents: {},
    handlers: {
      ping: () => ({ version: '1', url: 'https://loja.com/', title: 'Loja' }),
      setMode: () => ({}),
      applyVariation: ({ operations }) => ({
        applied: operations.map((o) => ({ id: o.id, via: 'primary' as const })),
        failed: [],
      }),
      select: () => {
        throw new Error('nada selecionado');
      },
      highlight: ({ selector }) => ({ found: selector === '#ok' }),
      showHeatmap: ({ clicks }) => ({ resolved: clicks.elements.length, missing: 0 }),
      hideHeatmap: () => ({}),
      pageSummary: () => ({ url: 'https://loja.com/', title: 'Loja', elements: [], targets: {} }),
      heatmapContext: () => ({ labels: {}, ignored: [] }),
    },
  });
  return { app, site, appPeer, agentPeer };
}

describe('RPC app ↔ agent', () => {
  test('chamadas nos dois sentidos com tipos e validação', async () => {
    const { appPeer, agentPeer } = connect();
    expect(await appPeer.call('ping', {})).toEqual({ version: '1', url: 'https://loja.com/', title: 'Loja' });
    expect(await appPeer.call('highlight', { selector: '#ok' })).toEqual({ found: true });
    const r = await appPeer.call('applyVariation', {
      operations: [{ id: 'o1', order: 0, type: 'hide', target: { selector: '#x' } }],
    });
    expect(r.applied).toEqual([{ id: 'o1', via: 'primary' }]);
    expect(await agentPeer.call('prompt', { kind: 'image', title: 'Imagem' })).toBe('/nova.png');
  });

  test('erro do handler e parâmetros inválidos viram rejeição', async () => {
    const { appPeer } = connect();
    await expect(appPeer.call('select', { selector: 'h1' })).rejects.toThrow('nada selecionado');
    await expect(appPeer.call('setMode', { mode: 'voar' } as never)).rejects.toThrow('parâmetros inválidos');
    await expect(appPeer.call('naoExiste' as never, {} as never)).rejects.toThrow('método desconhecido');
  });

  test('eventos tipados e validados', async () => {
    const { appPeer, agentPeer } = connect();
    const fn = vi.fn();
    const off = appPeer.on('operation', fn);
    agentPeer.emit('operation', { draft: { type: 'setText', target: { selector: 'h1' }, value: 'oi' } });
    await vi.waitFor(() => expect(fn).toHaveBeenCalledOnce());
    expect(fn.mock.calls[0]![0].draft).toEqual({
      type: 'setText',
      target: { selector: 'h1', alternates: [] },
      value: 'oi',
    });
    off();
    agentPeer.emit('navigated', { url: 'x' });
    expect(() => agentPeer.emit('operation', { draft: { type: 'explodir' } } as never)).toThrow();
  });

  test('ignora mensagens de outra origem ou de outra janela', async () => {
    const { app, site, appPeer } = connect();
    const fn = vi.fn();
    appPeer.on('ready', fn);
    const evt: Envelope = {
      abt: 1,
      kind: 'evt',
      event: 'ready',
      payload: { version: '1', url: 'u', title: 't' },
    };
    const intruder = new FakeWindow('https://evil.com');
    app.dispatchEvent(
      Object.assign(new Event('message'), { data: evt, origin: 'https://evil.com', source: intruder }),
    );
    app.dispatchEvent(
      Object.assign(new Event('message'), { data: evt, origin: site.origin, source: intruder }),
    );
    app.dispatchEvent(
      Object.assign(new Event('message'), { data: { lixo: true }, origin: site.origin, source: site }),
    );
    app.dispatchEvent(Object.assign(new Event('message'), { data: evt, origin: site.origin, source: site }));
    expect(fn).toHaveBeenCalledOnce();
  });

  test('timeout quando o outro lado não responde; origin "*" proibido', async () => {
    const { app } = pair();
    const lonely = createPeer({
      self: app as unknown as Window,
      remote: () => null,
      origin: 'https://loja.com',
      localMethods: appMethods,
      remoteMethods: agentMethods,
      localEvents: {},
      remoteEvents: agentEvents,
      handlers: { prompt: () => null },
      timeoutMs: 20,
    });
    await expect(lonely.call('ping', {})).rejects.toThrow('timeout');
    expect(() => createPeer({ origin: '*' } as Parameters<typeof createPeer>[0])).toThrow('origin exato');
  });

  test('dispose rejeita chamadas pendentes', async () => {
    const { appPeer, site } = connect();
    site.postMessage = () => {}; // agent "morreu"
    const p = appPeer.call('ping', {});
    appPeer.dispose();
    await expect(p).rejects.toThrow('encerrado');
  });
});
