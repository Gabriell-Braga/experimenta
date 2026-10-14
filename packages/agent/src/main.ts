// Entrada do bundle do agent. O snippet só carrega este arquivo depois do handshake (window.__ABT_AGENT__).
import type { AgentBoot } from '@abtest/snippet/editor';
import { startAgent } from './agent';

const boot = (window as Window & { __ABT_AGENT__?: AgentBoot }).__ABT_AGENT__;
if (boot) startAgent(window, boot);
