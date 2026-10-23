# Política de segurança

## Como relatar uma vulnerabilidade

Envie um e-mail para **security@gabrielbraga.app** (⚠ endereço provisório: CONFIRMAR antes de divulgar; o mesmo
está em `apps/editor/public/.well-known/security.txt` e na página pública `/seguranca`).

Não abra issue pública. Inclua, se puder:

- o que encontrou e onde (URL, rota da API, arquivo);
- passos para reproduzir ou prova de conceito;
- impacto que imagina (ex.: acesso a dados de outra conta);
- como prefere ser creditado.

Pode escrever em português ou inglês.

## O que esperar

| Etapa | Prazo |
|---|---|
| Confirmação de recebimento | até 3 dias úteis |
| Avaliação inicial e severidade | até 7 dias úteis |
| Correção de severidade crítica/alta | até 30 dias |
| Correção de severidade média/baixa | até 90 dias |

Avisamos quando a correção for publicada e combinamos com você a divulgação. Incidentes com dados pessoais seguem
`docs/seguranca/04-resposta-a-incidentes.md` (clientes avisados em até 48 h da confirmação).

## Porto seguro

Quem pesquisar de boa-fé, dentro destas regras, não sofrerá medida legal nossa:

- use só contas suas ou de teste; não acesse, altere nem apague dados de outras pessoas;
- nada de negação de serviço, engenharia social, spam ou testes físicos;
- pare e nos avise assim que conseguir acesso a dados que não são seus;
- dê um prazo razoável para a correção antes de divulgar.

## Versões suportadas

O Experimenta é um serviço (SaaS) com uma única versão em produção: corrigimos sempre a versão atual
(`main`, publicada em https://experimenta.gabrielbraga.app). Os SDKs (`packages/sdk`, `packages/react-native`,
`sdks/*`) recebem correção na última versão publicada.

| Componente | Suportado |
|---|---|
| Serviço em produção (editor, API, snippet) | ✅ versão atual |
| SDKs, última versão | ✅ |
| SDKs, versões anteriores | ❌ atualize |

## Escopo

Dentro: editor (`experimenta.gabrielbraga.app`), API e CDN (`experimenta-api.gabrielbraga.app`), snippet, extensão
do Chrome e SDKs deste repositório. Fora: o site demo (`experimenta-demo.gabrielbraga.app`, cuja rota `/bloqueado/*`
recusa iframe de propósito), serviços de terceiros (Cloudflare, GitHub) e achados só de scanner sem impacto
demonstrado (ex.: cabeçalho ausente em página estática sem dados).
