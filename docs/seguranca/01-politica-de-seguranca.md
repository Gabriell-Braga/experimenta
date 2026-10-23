# Política de Segurança da Informação e Privacidade

Versão 0.1 (rascunho para aprovação) — 2026-10-23. Aprovação: direção (Gabriel Braga). Revisão: anual ou após incidente grave.

## 1. Objetivo
Proteger a confidencialidade, a integridade e a disponibilidade dos dados dos clientes do Experimenta e dos visitantes dos sites deles, e cumprir a LGPD, o GDPR e os contratos com clientes.

## 2. Escopo do SGSI e do SGPI
- Produto: API (`apps/api`), editor (`apps/editor`), snippet (`packages/snippet`), editor agent, extensão Chrome, SDKs (`packages/sdk`, `packages/react-native`, `sdks/`) e o site de demonstração.
- Infraestrutura: Cloudflare (Workers, D1, KV, R2), GitHub (código e CI), estações de trabalho de quem desenvolve.
- Dados: contas e usuários dos clientes (controlador: Experimenta), eventos, gravações, perfis e respostas dos visitantes dos sites (Experimenta é operador; o cliente é o controlador).
- Fora do escopo: sistemas dos clientes e os sites onde o snippet é instalado.

## 3. Papéis
| Papel | Responsável | Responsabilidades |
|---|---|---|
| Direção | Gabriel Braga | Aprova políticas, orçamento e riscos aceitos; análise crítica anual |
| Gestor do SGSI | Gabriel Braga (provisório) | Mantém documentos, riscos, Declaração de Aplicabilidade, auditoria interna |
| Encarregado (DPO) | A nomear | Canal com titulares e ANPD; orienta sobre tratamento |
| Desenvolvimento | Quem tiver acesso ao repositório | Segue `03-desenvolvimento-seguro.md` |

Enquanto uma única pessoa acumular os papéis, valem as mitigações de segregação de funções de `02-controle-de-acesso.md`.

## 4. Princípios
1. Privacidade por padrão: consentimento esperado por padrão, gravações com campos mascarados, retenção limitada (90 dias para eventos e gravações).
2. Menor privilégio: papéis viewer/editor/owner; acessos de infraestrutura só para quem precisa.
3. Isolamento entre clientes: toda consulta filtra por `account_id`; testes automatizados garantem.
4. Nada de dados de cartão, saúde (PHI) ou categorias sensíveis da LGPD no produto. Os termos de uso proíbem e as gravações mascaram por padrão.
5. Mudança só por código revisado e testado (CI obrigatório).
6. Registrar para poder provar: histórico de atividades, logs de deploy, atas de revisão.

## 5. Objetivos mensuráveis (revisados na análise crítica)
- 100 % das mudanças em produção por PR com CI verde.
- Vulnerabilidades altas/críticas corrigidas em até 30 dias (críticas exploráveis em 7).
- Revisão de acessos mensal registrada (12 por ano).
- Teste de restauração de backup trimestral registrado.
- Incidentes com dados pessoais comunicados no prazo legal (100 %).

## 6. Documentos do SGSI
| Arquivo | Assunto |
|---|---|
| 02-controle-de-acesso.md | Contas, MFA, revisão de acessos, segregação |
| 03-desenvolvimento-seguro.md | Ciclo de desenvolvimento, mudanças, vulnerabilidades |
| 04-resposta-a-incidentes.md | Incidentes e comunicação a ANPD/clientes |
| 05-continuidade-e-backup.md | Backup, restauração, disponibilidade |
| 06-fornecedores-e-suboperadores.md | Suboperadores e avaliação de fornecedores |
| 07-privacidade-e-tratamento.md | ROPA, bases legais, retenção, direitos do titular |
| 08-riscos.md | Método e registro de riscos |
| 09-pessoas-e-uso-aceitavel.md | Entrada/saída, treinamento, estações de trabalho |
| dpa-modelo.md | Acordo de tratamento de dados com clientes |
| mapa-de-controles.md | Declaração de Aplicabilidade (ISO 27001 Anexo A) × SOC 2 |

## 7. Descumprimento
Violações desta política são tratadas como incidente (ver 04) e podem levar a revogação de acesso e medidas contratuais.
