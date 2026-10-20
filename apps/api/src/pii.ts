/** Dados pessoais fora dos textos que vão para a IA (D-084). */

/** Troca e-mails e números longos (telefone, CPF, cartão, CEP: 8+ dígitos) por marcadores. */
export const maskPii = (s: string) =>
  s
    .replace(/[\w.%+-]+@[\w-]+(?:\.[\w-]+)+/g, '[e-mail]')
    .replace(/\+?\(?\d[\d\s()./-]{6,}\d/g, (m) => (m.replace(/\D/g, '').length >= 8 ? '[número]' : m));

/** Texto de fora (site ou visitante) pronto para o prompt: uma linha, sem dado pessoal, cortado. */
export const clean = (s: string, max = 200) =>
  maskPii(
    [...s]
      .map((ch) => (ch < ' ' || ch === '\u007f' ? ' ' : ch))
      .join('')
      .replace(/\s+/g, ' ')
      .trim(),
  ).slice(0, max);
