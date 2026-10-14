import { agentEvents, agentMethods, appMethods, createPeer } from '@abtest/shared';
import type { AgentBoot } from '@abtest/snippet/editor';

export const AGENT_VERSION = '0.1.0';

export function startAgent(win: Window, boot: AgentBoot) {
  const info = () => ({ version: AGENT_VERSION, url: win.location.href, title: win.document.title });
  const peer = createPeer({
    self: win,
    remote: () => win.parent,
    origin: boot.appOrigin,
    localMethods: agentMethods,
    remoteMethods: appMethods,
    localEvents: agentEvents,
    remoteEvents: {},
    handlers: {
      ping: info,
      setMode: () => ({}),
      applyVariation: () => ({ applied: [], failed: [] }),
      select: () => null,
      highlight: () => ({ found: false }),
    },
  });
  peer.emit('ready', info());
  return peer;
}
