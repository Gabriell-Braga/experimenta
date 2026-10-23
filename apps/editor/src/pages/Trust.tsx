import { useEffect, type ReactNode } from 'react';
import { Logo } from '../ui';

// Página pública "Segurança e privacidade" (20.6), sem login: /seguranca. Texto alinhado com docs/seguranca/*
// (suboperadores, retenção, incidentes). Nunca dizer que há certificação: o programa está em preparação.

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-10">
      <h2 className="font-display text-2xl font-light text-ink">{title}</h2>
      <div className="mt-3 space-y-3 text-[15px] leading-relaxed text-gray-700">{children}</div>
    </section>
  );
}

const SUBPROCESSORS = [
  [
    'Cloudflare, Inc.',
    'Hospedagem (Workers), banco (D1), cache (KV) e CDN do snippet',
    'Todos os dados do produto',
    'Rede global',
  ],
  [
    'Anthropic, PBC',
    'IA (ideias, resumos, explicação de relatório), só se a conta usar a IA com a chave configurada',
    'Agregados de relatório e resumos com dados pessoais mascarados; não treina com dados da API',
    'EUA',
  ],
  ['GitHub, Inc.', 'Código-fonte e integração contínua', 'Nenhum dado de cliente', 'EUA'],
];

export function TrustPage() {
  useEffect(() => {
    document.title = 'Segurança e privacidade · Experimenta';
  }, []);
  return (
    <div className="min-h-full bg-white">
      <header className="border-b border-gray-200">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-4">
          <a href="/" aria-label="Experimenta, ir para o login">
            <Logo />
          </a>
          <a href="/" className="text-sm text-gray-700 underline">
            Entrar
          </a>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 pt-10 pb-20">
        <p className="label-mono">Central de confiança</p>
        <h1 className="mt-2 font-display text-4xl font-light text-ink">Segurança e privacidade</h1>
        <p className="mt-4 text-[15px] leading-relaxed text-gray-700">
          Como o Experimenta protege os dados das contas e dos visitantes dos sites dos clientes. Atualizado
          em 23/10/2026.
        </p>

        <Section title="Certificações">
          <p>
            <strong>O programa de conformidade está em preparação.</strong> Ainda não temos certificação
            ISO/IEC 27001, ISO/IEC 27701 nem relatório SOC 2 Tipo II: estamos implantando os controles e as
            políticas exigidos por essas normas, e a auditoria externa vem depois. Quando houver certificado
            ou relatório, ele será publicado aqui.
          </p>
          <p>
            LGPD e GDPR não têm certificado: atuamos como operador dos dados dos visitantes (o cliente é o
            controlador), com acordo de tratamento de dados (DPA) disponível sob pedido.
          </p>
        </Section>

        <Section title="Hospedagem e criptografia">
          <p>
            Toda a aplicação (API, editor, banco e CDN do snippet) roda na Cloudflare. Todo o tráfego usa TLS
            (HTTPS), com HSTS e cabeçalhos de segurança. Os dados guardados no D1 (banco) e no KV
            (configurações publicadas) são criptografados em repouso pela Cloudflare.
          </p>
          <p>
            Senhas são guardadas só como hash (PBKDF2); chaves de API, convites e códigos de recuperação
            também só como hash. Credenciais de integrações nunca voltam para a tela depois de salvas.
          </p>
        </Section>

        <Section title="Controle de acesso">
          <ul className="list-disc space-y-1 pl-5">
            <li>Papéis por conta: leitura, edição e dono; publicar JavaScript exige permissão própria.</li>
            <li>Login em duas etapas (TOTP) por pessoa, que o dono pode tornar obrigatório na conta.</li>
            <li>Bloqueio temporário após várias tentativas erradas de senha ou código.</li>
            <li>Sessões de login visíveis e revogáveis ("sair de todos os lugares").</li>
            <li>Isolamento entre contas: toda consulta é filtrada pela conta do usuário logado.</li>
          </ul>
        </Section>

        <Section title="Histórico de atividades (auditoria)">
          <p>
            Cada conta tem um histórico de quem fez o quê e quando: logins e tentativas que falharam, mudanças
            de papel, convites, chaves de API, publicações, exportações e pedidos de titulares. A equipe
            consulta e filtra por pessoa e tipo em Configurar → Atividades.
          </p>
        </Section>

        <Section title="Dados dos visitantes">
          <ul className="list-disc space-y-1 pl-5">
            <li>
              Modo de consentimento: o snippet pode esperar o aceite do banner de cookies (OneTrust,
              Cookiebot, Google Consent Mode v2) antes de gravar cookies ou coletar qualquer coisa; o
              visitante pode recusar e sair a qualquer momento.
            </li>
            <li>
              O IP do visitante não é guardado nos eventos; gravações de sessão mascaram os campos digitados.
            </li>
            <li>
              Retenção: eventos, mapas de calor e gravações são apagados automaticamente após 90 dias
              (padrão).
            </li>
          </ul>
        </Section>

        <Section title="Direitos dos titulares">
          <p>
            O cliente exporta (JSON) ou apaga todos os dados de um visitante ou usuário identificado em
            Configurar → Privacidade, atendendo a LGPD (art. 18) e a GDPR (art. 15 e 17). Pedidos que chegarem
            diretamente a nós são repassados ao cliente responsável em até 2 dias úteis.
          </p>
        </Section>

        <Section title="Suboperadores">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-left text-sm">
              <thead className="text-gray-600">
                <tr>
                  <th className="py-2 pr-3 font-medium">Empresa</th>
                  <th className="py-2 pr-3 font-medium">Finalidade</th>
                  <th className="py-2 pr-3 font-medium">Dados</th>
                  <th className="py-2 font-medium">Local</th>
                </tr>
              </thead>
              <tbody>
                {SUBPROCESSORS.map((r) => (
                  <tr key={r[0]} className="border-t border-gray-200 align-top">
                    {r.map((c, i) => (
                      <td key={i} className={`py-2 ${i < 3 ? 'pr-3' : ''}`}>
                        {c}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            Integrações que o cliente liga (Segment, Mixpanel, Amplitude, HubSpot, Salesforce, Shopify, S3,
            BigQuery, webhooks) são destinos escolhidos por ele, não suboperadores nossos. Mudanças nesta
            lista são avisadas com 30 dias de antecedência.
          </p>
        </Section>

        <Section title="Incidentes">
          <p>
            Em caso de incidente com dados pessoais, os clientes afetados são avisados sem demora indevida, em
            até 48 horas da confirmação, com o que se sabe até então.
          </p>
        </Section>

        <Section title="Relatar uma vulnerabilidade">
          <p>
            Escreva para{' '}
            <a className="underline" href="mailto:security@gabrielbraga.app">
              security@gabrielbraga.app
            </a>{' '}
            (veja também{' '}
            <a className="underline" href="/.well-known/security.txt">
              security.txt
            </a>
            ). Respondemos em até 3 dias úteis e não tomamos medida contra quem relatar de boa-fé.
          </p>
        </Section>
      </main>
    </div>
  );
}
