import { CalendarClock } from 'lucide-react';
import { useState } from 'react';
import { schedules, type Schedule } from '../api';
import { Button, inputCls, Modal, selectCls, useLoad, useToast } from '../ui';

// Agendamento de iniciar/pausar (17.4): guardado em UTC, mostrado e digitado no fuso do navegador. Quem executa é
// o job de hora em hora da API, então a ação acontece até 1 h depois do horário escolhido.

const VERB: Record<Schedule['action'], string> = { start: 'Inicia', pause: 'Pausa' };
const when = (iso: string) =>
  new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
/** "Inicia 21/10/2026, 14:00" (fuso do navegador). */
export const scheduleLabel = (s: Schedule) => `${VERB[s.action]} ${when(s.at)}`;

/** `YYYY-MM-DDTHH:mm` local (valor do datetime-local) ↔ ISO UTC. */
const toLocalInput = (d: Date) => {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};
const nextHour = () => {
  const d = new Date(Date.now() + 3_600_000);
  d.setMinutes(0, 0, 0);
  return d;
};
const ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;

export function ScheduleModal({
  experimentId,
  name,
  canEdit,
  onClose,
  onChanged,
}: {
  experimentId: string;
  name: string;
  canEdit: boolean;
  onClose(): void;
  onChanged?(): void;
}) {
  const toast = useToast();
  const list = useLoad(() => schedules.list(experimentId), [experimentId]);
  const [editing, setEditing] = useState<string | null>(null);
  const [action, setAction] = useState<Schedule['action']>('start');
  const [at, setAt] = useState(() => toLocalInput(nextHour()));
  const changed = () => {
    list.reload();
    onChanged?.();
  };
  const submit = async () => {
    const d = new Date(at);
    if (isNaN(d.getTime())) return toast('error', 'Escolha a data e a hora.');
    try {
      if (editing) await schedules.update(experimentId, editing, action, d.toISOString());
      else await schedules.create(experimentId, action, d.toISOString());
      toast('success', editing ? 'Agendamento alterado.' : 'Agendado.');
      setEditing(null);
      changed();
    } catch (e) {
      toast('error', `Não foi possível agendar: ${(e as Error).message}`);
    }
  };
  const cancel = async (sid: string) => {
    try {
      await schedules.remove(experimentId, sid);
      if (editing === sid) setEditing(null);
      toast('success', 'Agendamento cancelado.');
      changed();
    } catch (e) {
      toast('error', `Não foi possível cancelar: ${(e as Error).message}`);
    }
  };

  return (
    <Modal open onClose={onClose} title={`Agendar: ${name}`} testId="schedule-modal">
      <p className="mb-3 text-sm text-gray-600">
        Inicia ou pausa sozinho e publica. A verificação roda de hora em hora, então a ação acontece{' '}
        <b>até 1 h depois</b> do horário escolhido. Horário no seu fuso ({ZONE}). Se a conta exige aprovação,
        a publicação só vale direto quando quem agendou pode aprovar; senão vira um pedido de aprovação.
      </p>
      {canEdit && (
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 text-xs text-gray-500">
            Ação
            <select
              className={selectCls}
              value={action}
              onChange={(e) => setAction(e.target.value as Schedule['action'])}
              data-testid="schedule-action"
            >
              <option value="start">Iniciar</option>
              <option value="pause">Pausar</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-gray-500">
            Data e hora
            <input
              type="datetime-local"
              step={3600}
              min={toLocalInput(new Date())}
              value={at}
              onChange={(e) => setAt(e.target.value)}
              className={inputCls}
              data-testid="schedule-at"
            />
          </label>
          <Button variant="primary" onClick={submit} data-testid="schedule-save">
            {editing ? 'Salvar alteração' : 'Agendar'}
          </Button>
          {editing && (
            <Button variant="ghost" onClick={() => setEditing(null)}>
              Desistir
            </Button>
          )}
        </div>
      )}
      <h3 className="mt-4 mb-1 text-xs font-medium tracking-wide text-gray-500 uppercase">Agendados</h3>
      {list.loading ? (
        <p className="text-sm text-gray-500">Carregando…</p>
      ) : !list.data?.length ? (
        <p className="text-sm text-gray-500">Nada agendado.</p>
      ) : (
        <ul className="divide-y divide-gray-100 text-sm" data-testid="schedule-list">
          {list.data.map((s) => (
            <li
              key={s.id}
              className="flex items-center justify-between gap-2 py-1.5"
              data-testid="schedule-item"
            >
              <span>
                <span className="font-medium">{scheduleLabel(s)}</span>
                <span className="text-gray-500"> · por {s.createdBy}</span>
              </span>
              {canEdit && (
                <span className="flex gap-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setEditing(s.id);
                      setAction(s.action);
                      setAt(toLocalInput(new Date(s.at)));
                    }}
                    data-testid="schedule-edit"
                  >
                    Editar
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => cancel(s.id)}
                    data-testid="schedule-cancel"
                  >
                    Cancelar
                  </Button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}

/** Botão com o próximo agendamento (ou "Agendar") que abre o modal. Usado no editor e na página server-side. */
export function ScheduleButton({
  experimentId,
  name,
  canEdit = true,
  variant = 'secondary',
}: {
  experimentId: string;
  name: string;
  canEdit?: boolean;
  variant?: 'secondary' | 'inverseOutline';
}) {
  const [open, setOpen] = useState(false);
  const list = useLoad(() => schedules.list(experimentId), [experimentId]);
  const next = list.data?.[0];
  return (
    <>
      <Button
        variant={variant}
        onClick={() => setOpen(true)}
        title="Agendar iniciar ou pausar em data/hora"
        data-testid="open-schedule"
      >
        <CalendarClock size={15} aria-hidden="true" />{' '}
        <span className={next ? '' : 'hidden xl:inline'} data-testid="schedule-next">
          {next ? scheduleLabel(next) : 'Agendar'}
        </span>
      </Button>
      {open && (
        <ScheduleModal
          experimentId={experimentId}
          name={name}
          canEdit={canEdit}
          onClose={() => setOpen(false)}
          onChanged={list.reload}
        />
      )}
    </>
  );
}
