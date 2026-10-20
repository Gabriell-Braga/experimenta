import { expect, test } from '@playwright/test';
import { login, nav, OWNER } from '../editor';

const API = 'http://localhost:4000';

// Agendamento (17.4): digitado no fuso do navegador, guardado em UTC; aparece na lista e no editor.
// A execução (job de hora em hora) é testada na API com relógio controlado (routes/schedules.test.ts).
test.use({ timezoneId: 'America/Sao_Paulo' });

test('agenda pela lista, mostra na lista e no editor, guarda em UTC e cancela', async ({ page, request }) => {
  const token = (
    (await (await request.post(`${API}/auth/login`, { data: OWNER })).json()) as { token: string }
  ).token;
  const headers = { authorization: `Bearer ${token}`, origin: 'http://localhost:5173' };
  const projects = (await (await request.get(`${API}/projects`, { headers })).json()) as { id: string }[];
  const tag = Math.random().toString(36).slice(2, 7);
  const id = `exp_sched_${tag}`;
  expect(
    (
      await request.post(`${API}/experiments`, {
        headers,
        data: {
          projectId: projects[0]!.id,
          editorUrl: 'http://localhost:5180/',
          experiment: {
            id,
            key: `sched-${tag}`,
            name: `Agendado ${tag}`,
            status: 'paused',
            variations: [{ id: `${id}_c`, key: 'controle', name: 'Controle', weight: 100 }],
          },
        },
      })
    ).status(),
  ).toBe(201);

  await login(page);
  await nav(page, 'tests');
  const row = page.getByTestId('experiment-row').filter({ hasText: `Agendado ${tag}` });
  await row.getByTestId('row-actions').click();
  await page.getByRole('menuitem', { name: 'Agendar…' }).click();
  const modal = page.getByTestId('schedule-modal');
  await expect(modal).toContainText('até 1 h depois');
  await expect(modal).toContainText('America/Sao_Paulo');
  // Daqui a 2 dias, 10:00 em São Paulo (UTC−3, sem horário de verão) = 13:00 UTC.
  const day = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
  await modal.getByTestId('schedule-action').selectOption('start');
  await modal.getByTestId('schedule-at').fill(`${day}T10:00`);
  await modal.getByTestId('schedule-save').click();
  const [y, m, d] = day.split('-');
  await expect(modal.getByTestId('schedule-item')).toContainText(`Inicia ${d}/${m}/${y}, 10:00`);
  const saved = (await (await request.get(`${API}/schedules?experimentId=${id}`, { headers })).json()) as {
    at: string;
  }[];
  expect(saved.map((s) => s.at)).toEqual([`${day}T13:00:00.000Z`]);
  await page.keyboard.press('Escape');

  await expect(row.getByTestId('row-schedule')).toContainText(`Inicia ${d}/${m}/${y}, 10:00`);

  // No editor do teste: botão com o próximo agendamento; editar e cancelar.
  await row.getByRole('button', { name: `Agendado ${tag}` }).click();
  await expect(page.getByTestId('schedule-next')).toHaveText(`Inicia ${d}/${m}/${y}, 10:00`);
  await page.getByTestId('open-schedule').click();
  await modal.getByTestId('schedule-edit').click();
  await modal.getByTestId('schedule-action').selectOption('pause');
  await modal.getByTestId('schedule-at').fill(`${day}T18:00`);
  await modal.getByTestId('schedule-save').click();
  await expect(modal.getByTestId('schedule-item')).toContainText(`Pausa ${d}/${m}/${y}, 18:00`);
  await expect(page.getByTestId('schedule-next')).toHaveText(`Pausa ${d}/${m}/${y}, 18:00`);
  await modal.getByTestId('schedule-cancel').click();
  await expect(modal).toContainText('Nada agendado.');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('schedule-next')).toHaveText('Agendar');
});
