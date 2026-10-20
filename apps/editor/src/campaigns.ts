import type { CampaignType } from '@abtest/shared';
import { Blocks, Columns2, Rocket, Server, Split, UserRoundCog, type LucideIcon } from 'lucide-react';

/** Tipos de campanha: rótulo, descrição curta e ícone (lista, criação e menu). */
export const CAMPAIGNS: Record<
  CampaignType,
  { label: string; short: string; help: string; icon: LucideIcon }
> = {
  ab: {
    label: 'Teste A/B',
    short: 'A/B',
    help: 'Compare versões da mesma página editadas no editor visual.',
    icon: Columns2,
  },
  split: {
    label: 'URL dividida',
    short: 'Split URL',
    help: 'Divida o tráfego entre páginas diferentes (redesenho completo, outra URL).',
    icon: Split,
  },
  mvt: {
    label: 'Multivariado',
    short: 'MVT',
    help: 'Teste várias seções ao mesmo tempo: cada combinação vira uma variação.',
    icon: Blocks,
  },
  personalization: {
    label: 'Personalização',
    short: 'Personal.',
    help: 'Mostre uma experiência a uma audiência, com grupo de controle para medir o efeito.',
    icon: UserRoundCog,
  },
  rollout: {
    label: 'Rollout',
    short: 'Rollout',
    help: 'Libere uma mudança aos poucos (10%, 50%, 100%) sem precisar de deploy.',
    icon: Rocket,
  },
  server: {
    label: 'Server-side',
    short: 'Server',
    help: 'Variáveis entregues pelo SDK no seu backend ou app. Nada é aplicado na página.',
    icon: Server,
  },
};

export const CAMPAIGN_ORDER: CampaignType[] = ['ab', 'split', 'mvt', 'personalization', 'rollout', 'server'];
