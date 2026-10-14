import { OPERATION_TYPES, OperationSchema } from '@abtest/shared';
import { expect, test } from 'vitest';
import { describeOperation } from './describe';

const samples: Record<string, unknown> = {
  setText: 'Corra mais',
  setHTML: '<b>x</b>',
  setStyle: { color: 'red', 'font-size': '' },
  setAttribute: { name: 'href', value: null },
  addClass: 'destaque',
  removeClass: 'btn',
  hide: undefined,
  remove: undefined,
  move: { position: 'after', anchor: { selector: '.hero-img' } },
  insertHTML: { position: 'before', html: '<p>selo</p>' },
  replaceImage: { src: '/vermelho.svg' },
};

test('descreve todos os tipos de operação', () => {
  const out = OPERATION_TYPES.map((type) =>
    describeOperation(
      OperationSchema.parse({ id: 'o', order: 0, type, target: { selector: 'h1' }, value: samples[type] }),
    ),
  );
  expect(out).toEqual([
    'Texto → “Corra mais”',
    'HTML alterado (8 caracteres)',
    'Estilo: color: red; font-size: (padrão)',
    'Remove atributo href',
    'Adiciona classe .destaque',
    'Remove classe .btn',
    'Esconder',
    'Remover',
    'Mover depois de .hero-img',
    'Inserir HTML antes de (<p>selo</p>)',
    'Imagem → /vermelho.svg',
  ]);
});
