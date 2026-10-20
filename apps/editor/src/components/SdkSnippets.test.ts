import { expect, test } from 'vitest';
import { SDK_INSTALL, SDK_LANGS, sdkSnippet } from './SdkSnippets';

const input = {
  accountId: 'acc-1',
  cdnUrl: 'https://api.test/cdn',
  flag: 'novo-frete',
  experiment: 'checkout',
  variation: 'rapido',
  event: 'compra',
  value: 120,
};

test('exemplo de cada linguagem usa a conta, a CDN, a flag, a campanha e a meta', () => {
  for (const [lang] of SDK_LANGS) {
    const code = sdkSnippet(lang, input);
    for (const part of ['acc-1', 'https://api.test/cdn', 'novo-frete', 'checkout', 'compra'])
      expect(code, `${lang}: ${part}`).toContain(part);
    expect(SDK_INSTALL[lang]).toBeTruthy();
  }
  // Java/Kotlin recebem Double: inteiro sai com casa decimal.
  expect(sdkSnippet('java', input)).toContain('120.0, null');
  expect(sdkSnippet('python', input)).toContain('value=120)');
  expect(sdkSnippet('node', { ...input, flag: undefined })).not.toContain('isEnabled');
  expect(sdkSnippet('react-native', input)).toContain("useFlag('novo-frete', { plano: usuario.plano })");
  expect(sdkSnippet('react-native', input)).toContain("track('compra', { value: 120 })");
  expect(sdkSnippet('react-native', { ...input, flag: undefined })).not.toContain('useFlag(');
});
