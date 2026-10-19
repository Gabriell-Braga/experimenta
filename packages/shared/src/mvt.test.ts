import { expect, test } from 'vitest';
import { MvtSectionSchema } from './experiment';
import { mvtVariations } from './mvt';

const sections = MvtSectionSchema.array().parse([
  {
    id: 'titulo',
    name: 'Título',
    options: [
      { id: 't0', name: 'Original' },
      {
        id: 't1',
        name: 'Curto',
        operations: [{ id: 'a', order: 0, type: 'setText', target: { selector: 'h1' }, value: 'Corra' }],
      },
    ],
  },
  {
    id: 'botao',
    name: 'Botão',
    options: [
      { id: 'b0', name: 'Original' },
      { id: 'b1', name: 'Verde', customCSS: '.btn{background:green}' },
      { id: 'b2', name: 'Grande', customCSS: '.btn{font-size:20px}' },
    ],
  },
]);

test('fatorial completo: 2 × 3 = 6 combinações, controle primeiro, operações e CSS juntados', () => {
  const vs = mvtVariations(sections, []);
  expect(vs).toHaveLength(6);
  expect(vs[0]).toMatchObject({
    key: 'controle',
    combination: { titulo: 't0', botao: 'b0' },
    operations: [],
    customCSS: '',
  });
  const curtoVerde = vs.find((v) => v.combination!.titulo === 't1' && v.combination!.botao === 'b1')!;
  expect(curtoVerde.name).toBe('Curto × Verde');
  expect(curtoVerde.operations.map((o) => o.id)).toEqual(['a']);
  expect(curtoVerde.customCSS).toBe('.btn{background:green}');
  expect(new Set(vs.map((v) => v.key)).size).toBe(6);
});

test('combinações existentes mantêm id, chave e peso ao regenerar', () => {
  const first = mvtVariations(sections, []).map((v, i) => (i === 3 ? { ...v, id: 'fixo', weight: 5 } : v));
  const again = mvtVariations(sections, first);
  expect(again[3]).toMatchObject({ id: 'fixo', weight: 5 });
  // Nova opção numa seção: as antigas continuam, novas entram.
  const more = MvtSectionSchema.array().parse([
    sections[0],
    { ...sections[1], options: [...sections[1]!.options, { id: 'b3', name: 'Azul' }] },
  ]);
  const grown = mvtVariations(more, again);
  expect(grown).toHaveLength(8);
  expect(grown.find((v) => v.id === 'fixo')).toBeDefined();
});
