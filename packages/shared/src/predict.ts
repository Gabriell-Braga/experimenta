// Propensão a converter: mesmas features no navegador (snippet) e no treino (API). Sem zod: entra no snippet.

/** O que o snippet guarda do visitante (subconjunto do perfil local). */
export interface PredictInput {
  pv: number;
  s: number;
  ev: Record<string, number>;
  /** Primeira atividade (ms). */
  f: number;
  p?: string[];
  t?: Record<string, string>;
  u?: string;
}

/** Nomes das features, na ordem do vetor (para a tela explicar o modelo). */
export const FEATURES = [
  'Páginas vistas',
  'Sessões',
  'Dias desde a 1ª visita',
  'Páginas distintas',
  'Eventos',
  'Metas anteriores',
  'Celular',
  'Tablet',
  'Veio de outro site',
  'Veio de campanha (UTM)',
  'Identificado',
] as const;

/** Modelo publicado: logística sobre as features cruas. */
export interface PropensityModel {
  goal: string;
  w: number[];
  b: number;
}

const DAY = 86_400_000;
const l = Math.log1p;

export function featurize(p: PredictInput, device: string, goal: string, now: number): number[] {
  let events = 0;
  for (const k in p.ev) if (k !== goal) events += p.ev[k]!;
  return [
    l(p.pv),
    l(p.s),
    l(Math.max(0, now - p.f) / DAY),
    l(p.p?.length ?? 0),
    l(events),
    l(p.ev[goal] ?? 0),
    +(device === 'mobile'),
    +(device === 'tablet'),
    +!!p.t?.ref,
    +!!p.t?.utm_source,
    +!!p.u,
  ];
}

export const sigmoid = (z: number) => 1 / (1 + Math.exp(-z));

/** Score 0..1. */
export function propensity(m: PropensityModel, p: PredictInput, device: string, now: number): number {
  const x = featurize(p, device, m.goal, now);
  let z = m.b;
  for (let i = 0; i < x.length; i++) z += (m.w[i] ?? 0) * x[i]!;
  return sigmoid(z);
}
