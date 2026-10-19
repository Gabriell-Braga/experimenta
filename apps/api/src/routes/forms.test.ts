import { beforeAll, expect, test } from 'vitest';
import { ev, setupApp } from '../test-app';

let t: Awaited<ReturnType<typeof setupApp>>;
const field = (
  name: string,
  o: Partial<{ time: number; hesitation: number; focus: number; refills: number; filled: boolean }> = {},
) => ({
  name,
  kind: 'text',
  time: 0,
  focus: 0,
  refills: 0,
  filled: false,
  ...o,
});
const form = (o: object) =>
  ev({
    type: 'form',
    url: 'http://localhost:5180/contato?x=1',
    device: 'desktop',
    variations: {},
    form: '#contato',
    ...o,
  } as never);

beforeAll(async () => {
  t = await setupApp();
  await t.collect([
    // Enviou: nome 2 s (hesitou 500 ms, re-preencheu), email 1 s.
    form({
      interacted: true,
      submitted: true,
      fields: [
        field('nome', { time: 2000, hesitation: 500, focus: 2, refills: 1, filled: true }),
        field('email', { time: 1000, hesitation: 300, focus: 1, filled: true }),
      ],
    }),
    // Abandonou no email; nome 4 s.
    form({
      interacted: true,
      submitted: false,
      lastField: 'email',
      fields: [
        field('nome', { time: 4000, hesitation: 1500, focus: 1, filled: true }),
        field('email', { time: 500, focus: 1 }),
      ],
    }),
    // Chegou e não interagiu (celular).
    form({ interacted: false, submitted: false, device: 'mobile', fields: [field('nome'), field('email')] }),
  ]);
});

type Form = {
  page: string;
  form: string;
  landed: number;
  interacted: number;
  submitted: number;
  fields: {
    name: string;
    avgTime: number;
    avgHesitation: number;
    refillRate: number;
    ignoredRate: number;
    dropoffs: number;
    dropoffRate: number;
  }[];
};

test('funil do formulário e estatística por campo', async () => {
  const [f] = await t.get<Form[]>('/analytics/forms?days=7');
  expect(f).toMatchObject({
    page: 'http://localhost:5180/contato',
    form: '#contato',
    landed: 3,
    interacted: 2,
    submitted: 1,
  });
  expect(f!.fields).toEqual([
    {
      name: 'nome',
      kind: 'text',
      avgTime: 3000,
      avgHesitation: 1000,
      refillRate: 0.5,
      ignoredRate: 0,
      dropoffs: 0,
      dropoffRate: 0,
    },
    {
      name: 'email',
      kind: 'text',
      avgTime: 750,
      avgHesitation: 300,
      refillRate: 0,
      ignoredRate: 0,
      dropoffs: 1,
      dropoffRate: 1,
    },
  ]);
});

test('filtro de dispositivo', async () => {
  const [f] = await t.get<Form[]>('/analytics/forms?device=mobile');
  expect(f).toMatchObject({ landed: 1, interacted: 0, submitted: 0 });
});
