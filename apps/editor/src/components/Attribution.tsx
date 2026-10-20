import { useState } from 'react';
import type { Attribution, AttributionDim, Channel } from '../api';
import { SERIES } from '../charts';
import { fmt, Segmented } from '../ui';
import { VariationTag } from '../pages/Report';

export const CHANNEL_LABEL: Record<Channel, string> = {
  direct: 'Direto',
  organic: 'Busca orgânica',
  paid: 'Mídia paga',
  social: 'Redes sociais',
  email: 'E-mail',
  referral: 'Referência',
  campaign: 'Outras campanhas (UTM)',
};
const MODELS = [
  ['last', 'Último toque'],
  ['first', 'Primeiro toque'],
] as const;
const DIMS = [
  ['channel', 'Canal'],
  ['source', 'Origem'],
  ['campaign', 'Campanha'],
] as const;
const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);

/**
 * Tabela de receita por canal (painel e relatório do experimento): modelo de atribuição, dimensão e, por
 * linha, conversões, receita e fatia da receita (ou das conversões, sem receita). Com `variations`, uma
 * coluna de conversões · receita por variação.
 */
export function AttributionTable({ data }: { data: Attribution }) {
  const [model, setModel] = useState<'first' | 'last'>('last');
  const [dim, setDim] = useState<AttributionDim>('channel');
  const rows = data[model][dim];
  const byRevenue = data.revenue > 0;
  const total = byRevenue ? data.revenue : data.conversions;
  const vars = data.variations && data.variations.length > 1 ? data.variations : null;
  return (
    <div data-testid="attribution">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Segmented label="Modelo de atribuição" value={model} onChange={setModel} options={MODELS} />
        <Segmented label="Agrupar por" value={dim} onChange={setDim} options={DIMS} />
      </div>
      {!rows.length ? (
        <p className="py-6 text-center text-sm text-gray-400">Nenhuma conversão no período.</p>
      ) : (
        <div className="max-h-96 overflow-auto">
          <table className="w-full text-left text-sm" data-testid="attribution-table">
            <thead className="sticky top-0 bg-white">
              <tr className="label-mono border-b border-gray-900/10">
                <th className="py-2 pr-3 font-medium">{DIMS.find((d) => d[0] === dim)![1]}</th>
                {vars ? (
                  vars.map((v, i) => (
                    <th key={v.id} className="px-3 py-2 text-right font-medium">
                      <VariationTag index={i} name={v.name} />
                    </th>
                  ))
                ) : (
                  <>
                    <th className="px-3 py-2 text-right font-medium">Conversões</th>
                    <th className="px-3 py-2 text-right font-medium">Receita</th>
                  </>
                )}
                <th className="w-1/4 py-2 pl-3 font-medium">
                  {byRevenue ? '% da receita' : '% das conversões'}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-900/[0.06]">
              {rows.map((r) => {
                const share = total ? (byRevenue ? sum(r.revenue) : sum(r.conversions)) / total : 0;
                return (
                  <tr key={r.key} data-testid="attribution-row">
                    <td className="max-w-56 py-2 pr-3">
                      <span className="block truncate font-medium text-ink" title={r.key}>
                        {dim === 'channel' ? CHANNEL_LABEL[r.channel] : r.key}
                      </span>
                      {dim !== 'channel' && (
                        <span className="text-xs text-gray-500">{CHANNEL_LABEL[r.channel]}</span>
                      )}
                    </td>
                    {(vars ?? [null]).map((_, i) => (
                      <td
                        key={i}
                        className="tabular px-3 py-2 text-right font-mono text-xs whitespace-nowrap"
                      >
                        {vars ? (
                          <>
                            {fmt.int(r.conversions[i] ?? 0)}
                            {byRevenue && (
                              <span className="block text-[11px] text-gray-500">
                                {fmt.money(r.revenue[i] ?? 0)}
                              </span>
                            )}
                          </>
                        ) : (
                          fmt.int(r.conversions[0] ?? 0)
                        )}
                      </td>
                    ))}
                    {!vars && (
                      <td className="tabular px-3 py-2 text-right font-mono text-xs whitespace-nowrap">
                        {fmt.money(r.revenue[0] ?? 0)}
                      </td>
                    )}
                    <td className="py-2 pl-3">
                      <span className="flex items-center gap-2">
                        <span className="block h-1.5 flex-1 rounded-sm bg-gray-100">
                          <span
                            className="block h-full rounded-sm"
                            style={{ width: `${share * 100}%`, background: SERIES[0] }}
                          />
                        </span>
                        <span className="tabular w-11 text-right font-mono text-xs text-gray-600">
                          {fmt.pct(share, 0)}
                        </span>
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-3 text-xs text-gray-500">
        {model === 'last'
          ? 'Último toque: o crédito vai para a última visita com origem antes da conversão; uma visita direta não tira o crédito de uma campanha anterior.'
          : 'Primeiro toque: o crédito vai para a visita que trouxe o visitante pela primeira vez.'}{' '}
        Visitas até {data.windowDays} dias antes da conversão; origem pela UTM, id de clique de anúncio ou
        site de referência.
      </p>
    </div>
  );
}
