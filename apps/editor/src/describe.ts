import type { Operation } from '@abtest/shared';

const cut = (s: string, n = 40) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const POS = { before: 'antes de', after: 'depois de', prepend: 'no início de', append: 'no fim de' } as const;

/** Descrição legível de uma operação para a lista de alterações. */
export function describeOperation(op: Operation): string {
  switch (op.type) {
    case 'setText':
      return `Texto → “${cut(op.value)}”`;
    case 'setHTML':
      return `HTML alterado (${op.value.length} caracteres)`;
    case 'setStyle':
      return `Estilo: ${Object.entries(op.value)
        .map(([k, v]) => `${k}: ${v || '(padrão)'}`)
        .join('; ')}`;
    case 'setAttribute':
      return op.value.value === null
        ? `Remove atributo ${op.value.name}`
        : `${op.value.name} = “${cut(op.value.value)}”`;
    case 'addClass':
      return `Adiciona classe .${op.value}`;
    case 'removeClass':
      return `Remove classe .${op.value}`;
    case 'hide':
      return 'Esconder';
    case 'remove':
      return 'Remover';
    case 'move':
      return `Mover ${POS[op.value.position]} ${op.value.anchor.selector}`;
    case 'insertHTML':
      return `Inserir HTML ${POS[op.value.position]} (${cut(op.value.html, 30)})`;
    case 'replaceImage':
      return `Imagem → ${cut(op.value.src)}`;
  }
}
