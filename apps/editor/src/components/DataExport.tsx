import { ExportConfigSchema, type ExportConfig, type ExportDestination } from '@abtest/shared';
import { Database, Download } from 'lucide-react';
import { useEffect, useState, type InputHTMLAttributes, type ReactNode } from 'react';
import { dataExport, downloadFile, type ExportView, type Me } from '../api';
import { Switch } from '../pages/Flags';
import { Button, Card, inputCls, Segmented, selectCls, Skeleton, timeAgo, useLoad, useToast } from '../ui';

// Exportação agendada de dados (19.4): eventos brutos e/ou relatórios, diária ou semanal, para CSV, S3 ou
// BigQuery. Credenciais só escrita (a API nunca devolve); configurar = owner, "Exportar agora" = editor.

const WEEKDAYS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
const DEST: Record<ExportDestination, string> = {
  csv: 'CSV (baixar aqui)',
  s3: 'S3 / R2 / GCS',
  bigquery: 'BigQuery',
};
const when = (iso: string) =>
  new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function Status({ v }: { v: ExportView }) {
  const { running, last, nextAt, exportedUntil } = v.status;
  return (
    <div className="space-y-0.5 text-xs" role="status" data-testid="export-status">
      {running && (
        <p className="text-gray-700">
          Exportando… {running.events} eventos até agora
          {running.phase === 'reports' ? ', gerando relatórios' : ''}.
        </p>
      )}
      {last ? (
        <p className={last.ok ? 'text-gray-600' : 'text-red-700'}>
          {last.ok ? 'Última exportação' : 'Última exportação com erro'} {timeAgo(last.finishedAt)}
          {last.manual ? ' (manual)' : ''}: {last.events} eventos
          {last.reports ? `, ${last.reports} linhas de relatório` : ''}
          {last.error && <span className="block font-mono text-[11px] break-words">{last.error}</span>}
        </p>
      ) : (
        !running && <p className="text-gray-500">Ainda não exportado.</p>
      )}
      {exportedUntil && <p className="text-gray-500">Eventos exportados até {when(exportedUntil)}.</p>}
      {v.config.enabled && nextAt && <p className="text-gray-500">Próxima: {when(nextAt)}.</p>}
    </div>
  );
}

export function DataExport({ user }: { user: Me }) {
  const toast = useToast();
  const { data, setData } = useLoad(() => dataExport.get(), []);
  const [c, setC] = useState<ExportConfig>(ExportConfigSchema.parse({}));
  const [secret, setSecret] = useState('');
  const [sa, setSa] = useState('');
  useEffect(() => {
    if (!data) return;
    setC(data.config);
    setSecret('');
    setSa('');
  }, [data]);
  const isOwner = user.role === 'owner';

  const save = async () => {
    try {
      setData(
        await dataExport.save({
          ...c,
          s3: { ...c.s3, ...(secret ? { secretAccessKey: secret } : {}) },
          bigquery: { ...c.bigquery, ...(sa ? { serviceAccount: sa } : {}) },
        }),
      );
      toast('success', 'Exportação salva.');
    } catch (err) {
      toast('error', (err as Error).message);
    }
  };
  const runNow = async () => {
    try {
      // Um passo por requisição (CPU do Worker); continua enquanto a execução não termina.
      let prev = -1;
      for (let i = 0; i < 200; i++) {
        const v = await dataExport.run();
        setData(v);
        if (!v.status.running) {
          if (v.status.last && !v.status.last.ok) toast('error', `Exportação: ${v.status.last.error}`);
          break;
        }
        // Outro passo segurando a vez (job ou outra aba): espera um pouco antes de tentar de novo.
        if (v.status.running.events === prev) await sleep(1500);
        prev = v.status.running.events;
      }
    } catch (err) {
      toast('error', (err as Error).message);
    }
  };

  const field = (
    label: ReactNode,
    value: string,
    onChange: (v: string) => void,
    extra: InputHTMLAttributes<HTMLInputElement> = {},
  ) => (
    <label className="block text-xs">
      <span className="text-gray-600">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={!isOwner}
        className={`${inputCls} mt-1 text-xs`}
        {...extra}
      />
    </label>
  );
  const check = (label: string, on: boolean, set: (v: boolean) => void, disabled = false) => (
    <label className="flex items-center gap-1.5 text-xs">
      <input
        type="checkbox"
        checked={on}
        disabled={!isOwner || disabled}
        onChange={(e) => set(e.target.checked)}
        className="accent-[#12825f]"
      />
      {label}
    </label>
  );
  const s3 = (p: Partial<ExportConfig['s3']>) => setC({ ...c, s3: { ...c.s3, ...p } });
  const bq = (p: Partial<ExportConfig['bigquery']>) => setC({ ...c, bigquery: { ...c.bigquery, ...p } });

  return (
    <Card title="Exportação de dados">
      {!data ? (
        <div className="space-y-2" aria-hidden="true">
          <Skeleton className="h-5 w-1/3" />
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
        </div>
      ) : (
        <div className="space-y-3" data-testid="data-export">
          <div className="flex items-center gap-3">
            <Switch
              on={c.enabled}
              onChange={(v) => isOwner && setC({ ...c, enabled: v })}
              label="Ligar exportação"
            />
            <span className="text-sm text-gray-600">
              {data.config.enabled ? 'Ligada' : 'Desligada'}
              {c.enabled !== data.config.enabled && ' (salve para valer)'}
            </span>
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {check('Eventos brutos (só os novos)', c.events, (v) => setC({ ...c, events: v }))}
            {check(
              'Incluir cliques e movimentos do mapa de calor',
              c.heatmap,
              (v) => setC({ ...c, heatmap: v }),
              !c.events,
            )}
            {check('Relatórios dos testes em execução', c.reports, (v) => setC({ ...c, reports: v }))}
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <Segmented
              label="Frequência"
              value={c.frequency}
              onChange={(frequency) => isOwner && setC({ ...c, frequency })}
              options={[
                ['daily', 'Diária'],
                ['weekly', 'Semanal'],
              ]}
            />
            {c.frequency === 'weekly' && (
              <select
                aria-label="Dia da semana"
                value={c.weekday}
                disabled={!isOwner}
                onChange={(e) => setC({ ...c, weekday: Number(e.target.value) })}
                className={`${selectCls} text-xs`}
              >
                {WEEKDAYS.map((d, i) => (
                  <option key={d} value={i}>
                    {d}
                  </option>
                ))}
              </select>
            )}
            <select
              aria-label="Hora (UTC)"
              value={c.hour}
              disabled={!isOwner}
              onChange={(e) => setC({ ...c, hour: Number(e.target.value) })}
              className={`${selectCls} text-xs`}
            >
              {Array.from({ length: 24 }, (_, h) => (
                <option key={h} value={h}>
                  {String(h).padStart(2, '0')}:00 UTC
                </option>
              ))}
            </select>
          </div>
          <Segmented
            label="Destino"
            value={c.destination}
            onChange={(destination) => isOwner && setC({ ...c, destination })}
            options={(Object.keys(DEST) as ExportDestination[]).map((d) => [d, DEST[d]] as const)}
          />
          {c.destination === 'csv' && (
            <p className="text-xs text-gray-500">
              Cada execução vira arquivos para baixar abaixo (os eventos são lidos de novo do banco na hora de
              baixar, então somem quando a retenção apaga os eventos).
            </p>
          )}
          {c.destination === 's3' && (
            <div className="space-y-2">
              {field('Endpoint (vazio = AWS)', c.s3.endpoint, (v) => s3({ endpoint: v }), {
                placeholder: 'https://<conta>.r2.cloudflarestorage.com',
                'aria-label': 'Endpoint S3',
              })}
              <div className="grid gap-2 sm:grid-cols-3">
                {field('Região', c.s3.region, (v) => s3({ region: v }), {
                  placeholder: 'us-east-1 (R2: auto)',
                })}
                {field('Bucket', c.s3.bucket, (v) => s3({ bucket: v }), { 'aria-label': 'Bucket' })}
                {field('Pasta', c.s3.prefix, (v) => s3({ prefix: v }))}
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {field('Access key id', c.s3.accessKeyId, (v) => s3({ accessKeyId: v }), {
                  autoComplete: 'off',
                  'aria-label': 'Access key id',
                })}
                {field('Secret access key', secret, setSecret, {
                  type: 'password',
                  autoComplete: 'off',
                  placeholder: data.hasS3Secret ? '•••••• guardado (deixe vazio para manter)' : '',
                  'aria-label': 'Secret access key',
                })}
              </div>
              <p className="text-xs text-gray-500">
                Arquivos CSV em <code className="font-mono">{c.s3.prefix}events/dt=AAAA-MM-DD/</code> e{' '}
                <code className="font-mono">{c.s3.prefix}reports/dt=AAAA-MM-DD/</code>, assinados com AWS
                SigV4. A chave precisa só de <code className="font-mono">s3:PutObject</code> no bucket.
              </p>
            </div>
          )}
          {c.destination === 'bigquery' && (
            <div className="space-y-2">
              <div className="grid gap-2 sm:grid-cols-2">
                {field('Projeto', c.bigquery.projectId, (v) => bq({ projectId: v }), {
                  'aria-label': 'Projeto',
                })}
                {field('Dataset', c.bigquery.dataset, (v) => bq({ dataset: v }), { 'aria-label': 'Dataset' })}
                {field('Tabela de eventos', c.bigquery.eventsTable, (v) => bq({ eventsTable: v }))}
                {field('Tabela de relatórios', c.bigquery.reportsTable, (v) => bq({ reportsTable: v }))}
              </div>
              <label className="block text-xs">
                <span className="text-gray-600">Chave da conta de serviço (JSON)</span>
                <textarea
                  value={sa}
                  onChange={(e) => setSa(e.target.value)}
                  disabled={!isOwner}
                  rows={3}
                  autoComplete="off"
                  spellCheck={false}
                  aria-label="Chave da conta de serviço"
                  placeholder={
                    data.serviceAccountEmail
                      ? `guardada: ${data.serviceAccountEmail} (deixe vazio para manter)`
                      : '{ "type": "service_account", "client_email": …, "private_key": … }'
                  }
                  className={`${inputCls} mt-1 font-mono text-[11px]`}
                />
              </label>
              <p className="text-xs text-gray-500">
                Streaming (<code className="font-mono">insertAll</code>) nas tabelas já criadas. Eventos:{' '}
                <code className="font-mono">
                  event_id, ts TIMESTAMP, type, visitor_id, session_id, experiment_id, variation_id, goal_id,
                  value FLOAT, url, payload
                </code>{' '}
                (texto onde não indicado). A conta de serviço precisa do papel BigQuery Data Editor no
                dataset.
              </p>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            {isOwner && (
              <Button variant="primary" size="sm" onClick={() => save()} data-testid="export-save">
                Salvar
              </Button>
            )}
            {user.role !== 'viewer' && data.configured && (
              <Button size="sm" onClick={() => runNow()} data-testid="export-run">
                <Database size={13} aria-hidden="true" /> Exportar agora
              </Button>
            )}
          </div>
          <Status v={data} />
          {data.files.length > 0 && (
            <ul className="divide-y divide-gray-900/[0.06] text-xs" data-testid="export-files">
              {data.files.slice(0, 10).map((f) => (
                <li key={f.id} className="flex items-center gap-2 py-1.5">
                  <span className="min-w-0 flex-1 truncate font-mono">{f.name}</span>
                  <span className="text-gray-500">
                    {f.rows} {f.kind === 'events' ? 'eventos' : 'linhas'} · {timeAgo(f.createdAt)}
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={`Baixar ${f.name}`}
                    onClick={() =>
                      downloadFile(`/exports/files/${encodeURIComponent(f.id)}`, f.name).catch((err: Error) =>
                        toast('error', err.message),
                      )
                    }
                  >
                    <Download size={13} />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      <p className="mt-3 text-xs text-gray-500">
        Incremental: cada execução leva só o que chegou desde a anterior (a primeira, o último dia ou semana),
        até 15 min atrás. Eventos de QA não saem. Erro no destino tenta de novo na hora seguinte, do mesmo
        ponto. Chaves e segredos só são gravados: nunca voltam para a tela.
      </p>
    </Card>
  );
}
