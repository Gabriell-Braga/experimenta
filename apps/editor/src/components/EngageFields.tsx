import type { Audience, Trigger, UrlRule } from '@abtest/shared';
import { X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { entities, type Entity } from '../api';
import { inputCls, selectCls } from '../ui';

/** Campos comuns de pop-ups e pesquisas: gatilho, frequência e segmentação (páginas, dispositivos, audiências). */
export interface EngageCommon {
  status: 'draft' | 'running' | 'paused';
  trigger: Trigger;
  frequency: 'once' | 'session' | 'always';
  targeting: { urls: UrlRule[]; devices: ('desktop' | 'tablet' | 'mobile')[]; audiences: string[] };
}

const TRIGGERS: [Trigger['type'], string][] = [
  ['load', 'Ao carregar a página'],
  ['delay', 'Depois de X segundos'],
  ['scroll', 'Ao rolar X% da página'],
  ['exit', 'Intenção de saída'],
  ['inactive', 'Inatividade de X segundos'],
  ['click', 'Ao clicar num elemento'],
];
const newTrigger = (t: Trigger['type']): Trigger =>
  t === 'delay'
    ? { type: t, seconds: 5 }
    : t === 'scroll'
      ? { type: t, percent: 50 }
      : t === 'inactive'
        ? { type: t, seconds: 20 }
        : t === 'click'
          ? { type: t, selector: '' }
          : { type: t };

const small = `${inputCls} py-1 text-[13px]`;

export function EngageFields<T extends EngageCommon>({
  value,
  onChange,
}: {
  value: T;
  onChange(v: NoInfer<T>): void;
}) {
  const [auds, setAuds] = useState<Entity<Audience>[]>([]);
  useEffect(() => {
    entities.list<Audience>('audience').then(setAuds, () => {});
  }, []);
  const set = (p: Partial<EngageCommon>) => onChange({ ...value, ...p });
  const tg = value.targeting;
  const t = value.trigger;
  return (
    <div className="space-y-4 text-sm">
      <label className="block">
        <span className="label-mono mb-1 block">Quando aparece</span>
        <span className="flex flex-wrap items-center gap-2">
          <select
            value={t.type}
            onChange={(e) => set({ trigger: newTrigger(e.target.value as Trigger['type']) })}
            className={selectCls}
            data-testid="engage-trigger"
          >
            {TRIGGERS.map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
          {(t.type === 'delay' || t.type === 'inactive') && (
            <input
              type="number"
              min={0}
              value={t.seconds}
              onChange={(e) => set({ trigger: { ...t, seconds: Number(e.target.value) } })}
              className={`${small} w-20`}
              aria-label="Segundos"
            />
          )}
          {t.type === 'scroll' && (
            <input
              type="number"
              min={1}
              max={100}
              value={t.percent}
              onChange={(e) => set({ trigger: { ...t, percent: Number(e.target.value) } })}
              className={`${small} w-20`}
              aria-label="Percentual"
            />
          )}
          {t.type === 'click' && (
            <input
              value={t.selector}
              onChange={(e) => set({ trigger: { ...t, selector: e.target.value } })}
              placeholder="#botao, .menu a"
              className={`${small} font-mono`}
              aria-label="Seletor"
            />
          )}
        </span>
      </label>
      <label className="block">
        <span className="label-mono mb-1 block">Frequência por visitante</span>
        <select
          value={value.frequency}
          onChange={(e) => set({ frequency: e.target.value as EngageCommon['frequency'] })}
          className={selectCls}
        >
          <option value="once">Uma vez só</option>
          <option value="session">Uma vez por visita</option>
          <option value="always">Sempre que o gatilho ocorrer</option>
        </select>
      </label>
      <fieldset>
        <legend className="label-mono mb-1">Páginas (vazio = todas)</legend>
        {tg.urls.map((r, i) => (
          <span key={i} className="mb-1 flex items-center gap-1">
            <select
              value={r.exclude ? 'not' : r.match}
              onChange={(e) =>
                set({
                  targeting: {
                    ...tg,
                    urls: tg.urls.map((u, j) =>
                      j === i
                        ? {
                            ...u,
                            exclude: e.target.value === 'not',
                            match:
                              e.target.value === 'not' ? 'contains' : (e.target.value as UrlRule['match']),
                          }
                        : u,
                    ),
                  },
                })
              }
              className={`${selectCls} py-1`}
            >
              <option value="contains">contém</option>
              <option value="exact">é</option>
              <option value="regex">regex</option>
              <option value="not">não contém</option>
            </select>
            <input
              value={r.value}
              onChange={(e) =>
                set({
                  targeting: {
                    ...tg,
                    urls: tg.urls.map((u, j) => (j === i ? { ...u, value: e.target.value } : u)),
                  },
                })
              }
              className={`${small} font-mono`}
              placeholder="/checkout"
              data-testid="engage-url"
            />
            <button
              onClick={() => set({ targeting: { ...tg, urls: tg.urls.filter((_, j) => j !== i) } })}
              aria-label="Remover"
              className="text-gray-400 hover:text-signal"
            >
              <X size={14} />
            </button>
          </span>
        ))}
        <button
          type="button"
          onClick={() =>
            set({
              targeting: { ...tg, urls: [...tg.urls, { match: 'contains', value: '', exclude: false }] },
            })
          }
          className="text-xs text-brand-700 hover:underline"
          data-testid="engage-add-url"
        >
          + página
        </button>
      </fieldset>
      <fieldset>
        <legend className="label-mono mb-1">Dispositivos (nenhum = todos)</legend>
        <span className="flex gap-3">
          {(['desktop', 'tablet', 'mobile'] as const).map((d) => (
            <label key={d} className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={tg.devices.includes(d)}
                onChange={(e) =>
                  set({
                    targeting: {
                      ...tg,
                      devices: e.target.checked ? [...tg.devices, d] : tg.devices.filter((x) => x !== d),
                    },
                  })
                }
              />
              {{ desktop: 'Desktop', tablet: 'Tablet', mobile: 'Celular' }[d]}
            </label>
          ))}
        </span>
      </fieldset>
      {auds.length > 0 && (
        <fieldset>
          <legend className="label-mono mb-1">Audiências (todas precisam bater)</legend>
          {auds.map((a) => (
            <label key={a.id} className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={tg.audiences.includes(a.id)}
                onChange={(e) =>
                  set({
                    targeting: {
                      ...tg,
                      audiences: e.target.checked
                        ? [...tg.audiences, a.id]
                        : tg.audiences.filter((x) => x !== a.id),
                    },
                  })
                }
              />
              {a.name}
            </label>
          ))}
        </fieldset>
      )}
    </div>
  );
}

export const TRIGGER_LABEL = Object.fromEntries(TRIGGERS) as Record<Trigger['type'], string>;
