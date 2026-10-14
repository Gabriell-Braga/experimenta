import { ExperimentSchema } from '@abtest/shared';
import { expect, test } from 'vitest';
import { canOverlap, findConflicts } from './conflicts';

const exp = (id: string, selectors: string[], extra: object = {}, alternates: string[] = []) =>
  ExperimentSchema.parse({
    id,
    key: id,
    name: `Exp ${id}`,
    status: 'running',
    variations: [
      { id: `${id}0`, key: 'controle', name: 'C', weight: 1 },
      {
        id: `${id}1`,
        key: 'b',
        name: 'B',
        weight: 1,
        operations: selectors.map((s, i) => ({
          id: `o${i}`,
          order: i,
          type: 'hide',
          target: { selector: s, alternates },
        })),
      },
    ],
    ...extra,
  });
const at = (e: ReturnType<typeof exp>, url = 'https://loja.com/') => ({ experiment: e, editorUrl: url });

test('mesmo elemento na mesma página → conflito (normaliza espaços nos combinadores)', () => {
  const a = at(exp('a', ['#hero > h1', '.btn']));
  const b = at(exp('b', ['#hero>h1 ', '.outro']));
  expect(findConflicts(a, [b])).toEqual([
    { experimentId: 'b', name: 'Exp b', status: 'running', selectors: ['#hero > h1'] },
  ]);
});

test('casa por seletor alternativo', () => {
  const a = at(exp('a', ['[data-testid="cta"]'], {}, ['a.btn-primary']));
  const b = at(exp('b', ['a.btn-primary']));
  expect(findConflicts(a, [b])[0]!.selectors).toEqual(['[data-testid="cta"]']);
});

test('páginas, dispositivos disjuntos, arquivado e ele mesmo não conflitam', () => {
  const a = at(
    exp('a', ['h1'], { segmentation: { urls: [{ match: 'contains', value: '/produto' }] } }),
    'https://loja.com/produto/1',
  );
  const outraPagina = at(
    exp('b', ['h1'], { segmentation: { urls: [{ match: 'exact', value: 'https://loja.com/' }] } }),
  );
  const mobile = at(
    exp('c', ['h1'], { segmentation: { devices: ['mobile'] } }),
    'https://loja.com/produto/1',
  );
  const desktopA = at(
    exp('d', ['h1'], { segmentation: { devices: ['desktop'] } }),
    'https://loja.com/produto/1',
  );
  const arquivado = at(exp('e', ['h1'], { status: 'archived' }), 'https://loja.com/produto/1');
  expect(findConflicts(a, [outraPagina, arquivado, a])).toEqual([]);
  expect(canOverlap(mobile, desktopA)).toBe(false);
  // Sem regras de URL = todas as páginas → sobrepõe.
  expect(findConflicts(a, [at(exp('f', ['h1']), 'https://loja.com/')])).toHaveLength(1);
});
