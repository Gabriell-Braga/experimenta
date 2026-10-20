import { Check, Copy } from 'lucide-react';
import { useState } from 'react';
import { Segmented, useCopy } from '../ui';

export const SDK_LANGS = [
  ['node', 'Node/TS'],
  ['python', 'Python'],
  ['php', 'PHP'],
  ['go', 'Go'],
  ['java', 'Java'],
  ['kotlin', 'Kotlin'],
  ['react-native', 'React Native'],
] as const;
export type SdkLang = (typeof SDK_LANGS)[number][0];

export interface SnippetInput {
  accountId: string;
  cdnUrl: string;
  /** Exemplo de flag (com atributo `plano`); omitido = sem trecho de flag. */
  flag?: string;
  experiment: string;
  /** Chave de variação mostrada no comentário. */
  variation?: string;
  event: string;
  value: number;
}

const REPO = 'github.com/Gabriell-Braga/experimenta';

/** Como instalar cada SDK (todos decidem igual: mesmo hash de bucket, conferido por sdks/test-vectors.json). */
export const SDK_INSTALL: Record<SdkLang, string> = {
  node: 'pacote @abtest/sdk (packages/sdk; dist/index.js sem dependências)',
  python: `pip install "git+https://${REPO}.git#subdirectory=sdks/python"`,
  php: 'composer: experimenta/sdk (sdks/php; PHP 8.1+, 64 bits)',
  go: `go get ${REPO}/sdks/go`,
  java: 'Maven: com.experimenta:experimenta-sdk (sdks/java; Java 11+)',
  kotlin: 'o mesmo SDK Java (com.experimenta:experimenta-sdk)',
  'react-native':
    'pacote @abtest/react-native (packages/react-native) + npm i @react-native-async-storage/async-storage',
};

/** Exemplo de uso por linguagem. */
export function sdkSnippet(lang: SdkLang, o: SnippetInput): string {
  const vComment = o.variation ? ` (ex.: '${o.variation}')` : '';
  /** Java/Kotlin: o parâmetro é Double, então 120 precisa sair como 120.0. */
  const dbl = Number.isInteger(o.value) ? o.value.toFixed(1) : String(o.value);
  switch (lang) {
    case 'node':
      return [
        `import { createClient } from '@abtest/sdk';`,
        ``,
        `const abt = await createClient({ accountId: '${o.accountId}', cdnUrl: '${o.cdnUrl}' });`,
        ``,
        ...(o.flag
          ? [
              `const attrs = { plano: usuario.plano };`,
              `if (abt.isEnabled('${o.flag}', usuario.id, attrs)) {`,
              `  const { passos } = abt.getVariables('${o.flag}', usuario.id, attrs);`,
              `}`,
            ]
          : []),
        `const v = abt.getVariation('${o.experiment}', usuario.id); // v?.key${vComment}, v?.variables`,
        `abt.track('${o.event}', usuario.id, { value: ${o.value} });`,
      ].join('\n');
    case 'python':
      return [
        `from experimenta import Client`,
        ``,
        `abt = Client("${o.accountId}", "${o.cdnUrl}")`,
        ``,
        ...(o.flag
          ? [
              `attrs = {"plano": usuario.plano}`,
              `if abt.is_enabled("${o.flag}", usuario.id, attrs):`,
              `    passos = abt.get_variables("${o.flag}", usuario.id, attrs).get("passos")`,
            ]
          : []),
        `v = abt.get_variation("${o.experiment}", usuario.id)  # v.key${vComment}, v.variables ou None`,
        `abt.track("${o.event}", usuario.id, value=${o.value})`,
        `abt.close()  # ao encerrar o processo`,
      ].join('\n');
    case 'php':
      return [
        `$abt = new Experimenta\\Client('${o.accountId}', '${o.cdnUrl}');`,
        ``,
        ...(o.flag
          ? [
              `$attrs = ['plano' => $usuario->plano];`,
              `if ($abt->isEnabled('${o.flag}', $usuario->id, $attrs)) {`,
              `    $passos = $abt->getVariables('${o.flag}', $usuario->id, $attrs)['passos'] ?? null;`,
              `}`,
            ]
          : []),
        `$v = $abt->getVariation('${o.experiment}', $usuario->id); // $v['key']${vComment} ou null`,
        `$abt->track('${o.event}', $usuario->id, ${o.value}); // enviado no fim da requisição`,
      ].join('\n');
    case 'go':
      return [
        `import experimenta "${REPO}/sdks/go"`,
        ``,
        `abt := experimenta.New(experimenta.Options{AccountID: "${o.accountId}", CDNURL: "${o.cdnUrl}"})`,
        `defer abt.Close()`,
        ``,
        ...(o.flag
          ? [
              `attrs := experimenta.Attributes{"plano": usuario.Plano}`,
              `if abt.IsEnabled("${o.flag}", usuario.ID, attrs) {`,
              `\tconfigurarCheckout(abt.GetVariables("${o.flag}", usuario.ID, attrs)["passos"])`,
              `}`,
            ]
          : []),
        `v := abt.GetVariation("${o.experiment}", usuario.ID) // v.Key${vComment}, v.Variables; nil = fora`,
        `abt.Track("${o.event}", usuario.ID, experimenta.WithValue(${o.value}))`,
      ].join('\n');
    case 'java':
      return [
        `import com.experimenta.sdk.Client;`,
        `import com.experimenta.sdk.Decision;`,
        ``,
        `Client abt = Client.create(new Client.Options("${o.accountId}", "${o.cdnUrl}"));`,
        ``,
        ...(o.flag
          ? [
              `Map<String, Object> attrs = Map.of("plano", usuario.getPlano());`,
              `if (abt.isEnabled("${o.flag}", usuario.getId(), attrs)) {`,
              `  Object passos = abt.getVariables("${o.flag}", usuario.getId(), attrs).get("passos");`,
              `}`,
            ]
          : []),
        `Decision v = abt.getVariation("${o.experiment}", usuario.getId()); // v.key${vComment}; null = fora`,
        `abt.track("${o.event}", usuario.getId(), ${dbl}, null);`,
        `abt.close(); // ao encerrar a aplicação`,
      ].join('\n');
    case 'kotlin':
      return [
        `import com.experimenta.sdk.Client`,
        ``,
        `val abt = Client.create(Client.Options("${o.accountId}", "${o.cdnUrl}"))`,
        ``,
        ...(o.flag
          ? [
              `val attrs = mapOf("plano" to usuario.plano)`,
              `if (abt.isEnabled("${o.flag}", usuario.id, attrs)) {`,
              `    val passos = abt.getVariables("${o.flag}", usuario.id, attrs)["passos"]`,
              `}`,
            ]
          : []),
        `val v = abt.getVariation("${o.experiment}", usuario.id) // v?.key${vComment}, v?.variables`,
        `abt.track("${o.event}", usuario.id, ${dbl}, null)`,
      ].join('\n');
    case 'react-native':
      return [
        `import AsyncStorage from '@react-native-async-storage/async-storage';`,
        `import { ExperimentaProvider, createClient, useFlag, useTrack, useVariation } from '@abtest/react-native';`,
        ``,
        `// Uma vez, fora dos componentes. Guarda visitante, variações e eventos offline no AsyncStorage.`,
        `const abt = createClient({ accountId: '${o.accountId}', cdnUrl: '${o.cdnUrl}', storage: AsyncStorage, appVersion: '1.4.0' });`,
        ``,
        `const nav = createNavigationContainerRef();`,
        `export const App = () => (`,
        `  <ExperimentaProvider client={abt}>`,
        `    {/* tela vista = pageview app://app/<Tela> (funis, jornadas) */}`,
        `    <NavigationContainer ref={nav} onStateChange={() => abt.screen(nav.getCurrentRoute()?.name ?? '')}>`,
        `      <Rotas />`,
        `    </NavigationContainer>`,
        `  </ExperimentaProvider>`,
        `);`,
        ``,
        `function Checkout({ usuario }) {`,
        ...(o.flag
          ? [
              `  const { enabled, variables } = useFlag('${o.flag}', { plano: usuario.plano }); // + platform, appVersion`,
            ]
          : []),
        `  const v = useVariation('${o.experiment}'); // v?.key${vComment}, v?.variables; null = fora ou carregando`,
        `  const track = useTrack();`,
        `  return <Button title="Comprar" onPress={() => track('${o.event}', { value: ${o.value} })} />;`,
        `}`,
      ].join('\n');
  }
}

/** Abas por linguagem com o exemplo de uso do SDK (servidor ou React Native) e a instalação. */
export function SdkSnippets({ input, size = 'sm' }: { input: SnippetInput; size?: 'sm' | 'md' }) {
  const [lang, setLang] = useState<SdkLang>(() => {
    try {
      const saved = localStorage.getItem('abt.sdkLang');
      return SDK_LANGS.some(([id]) => id === saved) ? (saved as SdkLang) : 'node';
    } catch {
      return 'node';
    }
  });
  const [copied, setCopied] = useState(false);
  const copy = useCopy();
  const code = sdkSnippet(lang, input);
  const choose = (l: SdkLang) => {
    setLang(l);
    setCopied(false);
    try {
      localStorage.setItem('abt.sdkLang', l);
    } catch {
      /* sem storage: só não lembra a escolha */
    }
  };
  return (
    <div data-testid="sdk-snippets">
      <Segmented value={lang} options={SDK_LANGS} onChange={choose} label="Linguagem do SDK" />
      <div className="relative mt-2">
        <pre
          className={`overflow-x-auto rounded-md bg-ink p-3 pr-10 font-mono leading-relaxed text-[#e8e4da] ${size === 'md' ? 'text-[12px]' : 'text-[11.5px]'}`}
          data-testid="sdk-code"
        >
          {code}
        </pre>
        <button
          type="button"
          onClick={async () => setCopied(await copy(code, 'Código copiado.'))}
          className="absolute top-2 right-2 rounded p-1 text-[#e8e4da]/70 hover:bg-white/10 hover:text-white"
          aria-label="Copiar código"
        >
          {copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
        </button>
      </div>
      <p className="mt-2 text-xs text-gray-500">
        <span className="font-medium text-gray-700">Instalação:</span>{' '}
        <code className="font-mono break-all">{SDK_INSTALL[lang]}</code>
      </p>
    </div>
  );
}
