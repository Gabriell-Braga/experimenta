import type { ElementInfo, Operation, OperationDraft } from '@abtest/shared';
import { useState, type ReactNode } from 'react';
import { findEquivalent } from '../store';

interface Props {
  info: ElementInfo;
  operations: Operation[];
  onUpsert(draft: OperationDraft, coalesceKey?: string): void;
  onSelectSelector(selector: string): void;
}

/** rgb(a) computado → #rrggbb para <input type=color>. */
export function toHex(color: string): string {
  if (/^#[0-9a-f]{6}$/i.test(color)) return color.toLowerCase();
  const m = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!m) return '#000000';
  return `#${[m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, '0')).join('')}`;
}

const FRAGILITY = {
  low: ['estável', 'bg-green-100 text-green-800'],
  medium: ['médio', 'bg-yellow-100 text-yellow-800'],
  high: ['frágil', 'bg-red-100 text-red-800'],
} as const;

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <details open className="border-b border-gray-100">
      <summary className="cursor-pointer px-3 py-2 text-xs font-semibold tracking-wide text-gray-500 uppercase">
        {title}
      </summary>
      <div className="flex flex-col gap-2 px-3 pb-3">{children}</div>
    </details>
  );
}

/** Campo de texto que confirma no Enter ou ao sair (não gera uma operação por tecla). */
function Field({
  label,
  value,
  onCommit,
  testId,
}: {
  label: string;
  value: string;
  onCommit(v: string): void;
  testId?: string;
}) {
  return (
    <label className="flex items-center justify-between gap-2 text-sm">
      <span className="text-gray-600">{label}</span>
      <input
        key={value}
        defaultValue={value}
        data-testid={testId}
        className="w-32 rounded border border-gray-300 px-2 py-0.5 text-right text-sm"
        onBlur={(e) => e.target.value !== value && onCommit(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      />
    </label>
  );
}

export function PropertiesPanel({ info, operations, onUpsert, onSelectSelector }: Props) {
  const target = info.target;
  const styleOp = findEquivalent(operations, { type: 'setStyle', target, value: {} });
  const pending = styleOp?.type === 'setStyle' ? styleOp.value : {};
  /** Valor exibido: o da variação (se já alterado) ou o computado no site. */
  const style = (prop: string, computed = prop) => pending[prop] ?? info.styles[computed] ?? '';
  const setStyle = (prop: string, value: string, coalesce = false) =>
    onUpsert(
      { type: 'setStyle', target, value: { [prop]: value } },
      coalesce ? `style:${target.selector}:${prop}` : undefined,
    );

  const textOp = findEquivalent(operations, { type: 'setText', target, value: '' });
  const [newAttr, setNewAttr] = useState({ name: '', value: '' });
  const [frag, fragClass] = FRAGILITY[info.fragility];

  const color = (label: string, prop: string, testId: string) => (
    <label className="flex items-center justify-between gap-2 text-sm">
      <span className="text-gray-600">{label}</span>
      <span className="flex items-center gap-1">
        <input
          type="color"
          value={toHex(style(prop))}
          onChange={(e) => setStyle(prop, e.target.value, true)}
          className="h-6 w-8 cursor-pointer rounded border"
          aria-label={label}
        />
        <input
          key={style(prop)}
          defaultValue={style(prop)}
          data-testid={testId}
          className="w-24 rounded border border-gray-300 px-1 py-0.5 text-xs"
          onBlur={(e) => e.target.value !== style(prop) && setStyle(prop, e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        />
      </span>
    </label>
  );

  return (
    <div data-testid="properties">
      <div className="border-b border-gray-100 p-3">
        <div className="flex items-center justify-between gap-2">
          <code className="break-all text-xs" data-testid="selected-selector">
            {target.selector}
          </code>
          <span
            className={`shrink-0 rounded px-1.5 py-0.5 text-xs ${fragClass}`}
            data-testid="fragility"
            title="Robustez do seletor"
          >
            {frag}
          </span>
        </div>
        {info.fragility === 'high' && (
          <p className="mt-2 rounded bg-yellow-50 p-2 text-xs text-yellow-900" data-testid="fragile-hint">
            Seletor frágil: este elemento não tem id, data-* nem classe estável. Prefira editar um ancestral
            estável ou peça ao time do site um <code>data-testid</code>.
          </p>
        )}
        <nav className="mt-2 flex flex-wrap gap-1 text-xs" aria-label="Ancestrais">
          {[...info.breadcrumb].reverse().map((b) => (
            <button
              key={b.selector}
              onClick={() => onSelectSelector(b.selector)}
              className="rounded bg-gray-100 px-1.5 hover:bg-gray-200"
            >
              {b.label}
            </button>
          ))}
        </nav>
      </div>

      {info.textOnly && !info.isImage && (
        <Section title="Texto">
          <textarea
            key={textOp?.type === 'setText' ? textOp.value : info.text}
            defaultValue={textOp?.type === 'setText' ? textOp.value : info.text}
            data-testid="prop-text"
            rows={3}
            className="rounded border border-gray-300 p-2 text-sm"
            onBlur={(e) => {
              const cur = textOp?.type === 'setText' ? textOp.value : info.text;
              if (e.target.value !== cur) onUpsert({ type: 'setText', target, value: e.target.value });
            }}
          />
        </Section>
      )}

      <Section title="Tipografia">
        <Field label="Fonte" value={style('font-family')} onCommit={(v) => setStyle('font-family', v)} />
        <Field
          label="Tamanho"
          value={style('font-size')}
          onCommit={(v) => setStyle('font-size', v)}
          testId="prop-font-size"
        />
        <label className="flex items-center justify-between gap-2 text-sm">
          <span className="text-gray-600">Peso</span>
          <select
            value={style('font-weight')}
            onChange={(e) => setStyle('font-weight', e.target.value)}
            className="w-32 rounded border border-gray-300 px-1 py-0.5 text-sm"
          >
            {['300', '400', '500', '600', '700', '800', '900'].map((w) => (
              <option key={w}>{w}</option>
            ))}
          </select>
        </label>
        <label className="flex items-center justify-between gap-2 text-sm">
          <span className="text-gray-600">Alinhamento</span>
          <select
            value={style('text-align')}
            onChange={(e) => setStyle('text-align', e.target.value)}
            className="w-32 rounded border border-gray-300 px-1 py-0.5 text-sm"
          >
            {['start', 'left', 'center', 'right', 'justify'].map((a) => (
              <option key={a}>{a}</option>
            ))}
          </select>
        </label>
        {color('Cor do texto', 'color', 'prop-color')}
      </Section>

      <Section title="Cores">{color('Fundo', 'background-color', 'prop-background')}</Section>

      <Section title="Espaçamento">
        {(['margin', 'padding'] as const).map((box) => (
          <div key={box} className="grid grid-cols-4 gap-1 text-xs">
            <span className="col-span-4 text-gray-600">{box === 'margin' ? 'Margem' : 'Preenchimento'}</span>
            {(['top', 'right', 'bottom', 'left'] as const).map((side) => (
              <input
                key={`${side}:${style(`${box}-${side}`)}`}
                defaultValue={style(`${box}-${side}`)}
                aria-label={`${box}-${side}`}
                title={`${box}-${side}`}
                className="rounded border border-gray-300 px-1 py-0.5 text-center"
                onBlur={(e) =>
                  e.target.value !== style(`${box}-${side}`) && setStyle(`${box}-${side}`, e.target.value)
                }
                onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
              />
            ))}
          </div>
        ))}
      </Section>

      <Section title="Borda">
        <Field
          label="Largura"
          value={style('border-width', 'border-top-width')}
          onCommit={(v) => setStyle('border-width', v)}
        />
        <label className="flex items-center justify-between gap-2 text-sm">
          <span className="text-gray-600">Estilo</span>
          <select
            value={style('border-style', 'border-top-style')}
            onChange={(e) => setStyle('border-style', e.target.value)}
            className="w-32 rounded border border-gray-300 px-1 py-0.5 text-sm"
          >
            {['none', 'solid', 'dashed', 'dotted', 'double'].map((b) => (
              <option key={b}>{b}</option>
            ))}
          </select>
        </label>
        {color('Cor da borda', 'border-color', 'prop-border-color')}
        <Field
          label="Raio"
          value={style('border-radius')}
          onCommit={(v) => setStyle('border-radius', v)}
          testId="prop-radius"
        />
      </Section>

      <Section title="Atributos">
        {Object.entries(info.attributes).map(([name, value]) => {
          const op = findEquivalent(operations, {
            type: 'setAttribute',
            target,
            value: { name, value: null },
          });
          const cur = op?.type === 'setAttribute' ? (op.value.value ?? '') : value;
          return (
            <Field
              key={name}
              label={name}
              value={cur}
              testId={`attr-${name}`}
              onCommit={(v) => onUpsert({ type: 'setAttribute', target, value: { name, value: v } })}
            />
          );
        })}
        <form
          className="flex gap-1"
          onSubmit={(e) => {
            e.preventDefault();
            if (!/^[a-zA-Z_:][\w:.-]*$/.test(newAttr.name)) return;
            onUpsert({ type: 'setAttribute', target, value: { ...newAttr } });
            setNewAttr({ name: '', value: '' });
          }}
        >
          <input
            placeholder="atributo"
            value={newAttr.name}
            onChange={(e) => setNewAttr({ ...newAttr, name: e.target.value })}
            className="w-24 rounded border border-gray-300 px-1 text-xs"
          />
          <input
            placeholder="valor"
            value={newAttr.value}
            onChange={(e) => setNewAttr({ ...newAttr, value: e.target.value })}
            className="min-w-0 flex-1 rounded border border-gray-300 px-1 text-xs"
          />
          <button className="rounded bg-gray-100 px-2 text-xs">+</button>
        </form>
      </Section>
    </div>
  );
}
