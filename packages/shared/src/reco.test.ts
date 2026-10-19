import { expect, test } from 'vitest';
import { recommend, type RecoModel } from './reco';

const m: RecoModel = {
  builtAt: '',
  catalog: {
    a: { name: 'Runner', price: 600, category: 'corrida' },
    b: { name: 'Trail', price: 690, category: 'corrida' },
    c: { name: 'Elite', price: 1000, category: 'corrida' },
    d: { name: 'Meia', price: 90, category: 'acessorios' },
    e: { name: 'Garrafa', price: 130, category: 'acessorios' },
  },
  coview: { a: ['b', 'd'] },
  copurchase: { a: ['d'] },
  trending: ['e', 'a', 'b'],
  bestsellers: ['d', 'a'],
  byCategory: { corrida: ['a', 'c', 'b'], acessorios: ['d', 'e'] },
};

test('estratégias: co-visualização, comprados juntos, upsell, próxima melhor oferta; completa com os mais vistos', () => {
  expect(recommend(m, 'coview', { product: 'a', limit: 3 })).toEqual(['b', 'd', 'e']);
  expect(recommend(m, 'copurchase', { product: 'a', limit: 1 })).toEqual(['d']);
  expect(recommend(m, 'upsell', { product: 'a', limit: 2 })).toEqual(['c', 'b']); // mesma categoria, mais caros
  expect(recommend(m, 'nbo', { viewed: ['d', 'a', 'b'], limit: 2 })).toEqual(['c', 'e']); // corrida (2 vistos) ainda não visto
  expect(recommend(m, 'bestsellers', { product: 'd', limit: 2 })).toEqual(['a', 'e']); // nunca o próprio
  expect(recommend(m, 'coview', { product: 'zzz', limit: 2 })).toEqual(['e', 'a']); // sem dado: mais vistos
});
