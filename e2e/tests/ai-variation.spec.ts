import { expect, test } from '@playwright/test';
import { openEditor } from '../editor';

interface Body {
  prompt: string;
  page: { elements: { ref: string; tag: string; text: string; attrs: Record<string, string> }[] };
}

test('variação por texto: sem IA avisa; com IA (falsa) pré-visualiza, descarta, aplica e desfaz', async ({
  page,
}) => {
  const site = await openEditor(page);
  await page.getByTestId('side-ai').click();
  await page.getByTestId('ai-prompt').fill('Deixe o botão verde e troque o título por "Corra mais leve"');

  // API do E2E não tem chave de IA: mensagem clara, nada muda.
  await page.getByTestId('ai-generate').click();
  await expect(page.getByTestId('ai-error')).toContainText('IA não configurada');

  // Provedor falso: responde sobre o resumo que o agent mandou (refs reais da página).
  let sent: Body | undefined;
  await page.route('**/ai/variation', async (route) => {
    sent = route.request().postDataJSON() as Body;
    const ref = (pred: (e: Body['page']['elements'][number]) => boolean) =>
      sent!.page.elements.find(pred)!.ref;
    await route.fulfill({
      json: {
        changes: [
          { type: 'setText', ref: ref((e) => e.attrs.id === 'hero-title'), value: 'Corra mais leve' },
          {
            type: 'setStyle',
            ref: ref((e) => e.tag === 'a' && e.text === 'Comprar agora'),
            value: { 'background-color': 'rgb(22, 163, 74)' },
          },
          { type: 'hide', ref: 'e9999' }, // ref que não existe: ignorado no editor
        ],
        skipped: 0,
        message: 'Título trocado e botão verde.',
        source: 'modelo',
        model: 'falso',
      },
    });
  });
  await page.getByTestId('ai-generate').click();
  await expect(page.getByTestId('ai-change')).toHaveText([
    'Texto → “Corra mais leve”',
    'Estilo: background-color: rgb(22, 163, 74)',
  ]);
  await expect(page.getByTestId('ai-preview')).toContainText('1 sugestão ignorada');
  expect(sent!.prompt).toContain('botão verde');
  // O resumo não leva seletores para a IA.
  expect(JSON.stringify(sent!.page)).not.toContain('selector');

  // Pré-visualização no site, fora da variação.
  const title = site.locator('#hero-title');
  const cta = site.locator('[data-testid=cta-comprar]');
  await expect(title).toHaveText('Corra mais leve');
  await expect(cta).toHaveCSS('background-color', 'rgb(22, 163, 74)');
  await expect(page.getByTestId('side-changes')).toHaveText('Alterações (0)');

  // Descartar volta o site ao original.
  await page.getByTestId('ai-discard').click();
  await expect(title).toHaveText('O melhor tênis para correr');

  // Gerar de novo e aplicar: entram na variação como alterações normais.
  await page.getByTestId('ai-generate').click();
  await page.getByTestId('ai-apply').click();
  await expect(page.getByTestId('side-changes')).toHaveText('Alterações (2)');
  await expect(page.getByTestId('change-desc')).toHaveText([
    'Texto → “Corra mais leve”',
    'Estilo: background-color: rgb(22, 163, 74)',
  ]);
  await expect(title).toHaveText('Corra mais leve');

  // Um Ctrl+Z desfaz as duas.
  await page.keyboard.press('Control+z');
  await expect(page.getByTestId('side-changes')).toHaveText('Alterações (0)');
  await expect(title).toHaveText('O melhor tênis para correr');
  await expect(cta).not.toHaveCSS('background-color', 'rgb(22, 163, 74)');
});
