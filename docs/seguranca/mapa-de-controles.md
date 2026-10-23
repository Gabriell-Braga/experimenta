# Declaração de Aplicabilidade (ISO/IEC 27001:2022 Anexo A) × SOC 2

Versão 0.1 — 2026-10-23. Estado: **Imp** implementado, **Doc** só documentado (falta operar/gerar evidência), **Pend** pendente, **N/A** não aplicável (com justificativa). Evidência aponta para arquivo do repositório ou registro.

## Controles organizacionais (5.x)
| Controle | Aplica | Estado | Evidência / como | SOC 2 |
|---|---|---|---|---|
| 5.1 Políticas | Sim | Doc | 01-politica-de-seguranca.md (aprovar e assinar) | CC5.3 |
| 5.2 Papéis e responsabilidades | Sim | Doc | 01, seção 3 | CC1.3 |
| 5.3 Segregação de funções | Sim | Doc | 02, seção 5 (risco R11 aceito) | CC5.1 |
| 5.4 Responsabilidades da direção | Sim | Doc | 01; análise crítica anual | CC1.1 |
| 5.5–5.6 Contato com autoridades e grupos | Sim | Doc | 04, seção 3 (ANPD) | CC2.3 |
| 5.7 Inteligência de ameaças | Sim | Imp | Dependabot/CodeQL, avisos do GitHub | CC3.2 |
| 5.8 Segurança em projetos | Sim | Imp | docs/PLANO.md + DECISOES.md por tarefa | CC8.1 |
| 5.9–5.11 Inventário, uso e devolução de ativos | Sim | Doc | 01 seção 2 (escopo), 09 seção 5 | CC6.1 |
| 5.12–5.13 Classificação e rotulagem | Sim | Doc | 07 (dados por atividade) | C1.1 |
| 5.14 Transferência de informação | Sim | Imp | TLS, DPA, webhooks assinados (HMAC) | CC6.7 |
| 5.15–5.18 Controle de acesso, identidade, autenticação, direitos | Sim | Imp | 02; papéis, TOTP, sessões, revisão mensal (Doc) | CC6.1–6.3 |
| 5.19–5.22 Fornecedores | Sim | Doc | 06 | CC9.2 |
| 5.23 Serviços em nuvem | Sim | Doc | 06 (Cloudflare), 05 seção 5 | CC9.2 |
| 5.24–5.28 Incidentes | Sim | Doc | 04 | CC7.3–7.5 |
| 5.29–5.30 Continuidade | Sim | Doc | 05 | A1.2–A1.3 |
| 5.31–5.32 Requisitos legais, propriedade intelectual | Sim | Doc | 07, DPA, licenças das dependências | CC2.3 |
| 5.33 Proteção de registros | Sim | Imp | Histórico de atividades, git | CC7.2 |
| 5.34 Privacidade e PII | Sim | Imp | Consentimento por padrão, DSAR, mascaramento, 07 | P1–P8 |
| 5.35 Análise independente | Sim | Pend | Auditoria interna + teste de invasão | CC4.1 |
| 5.36 Conformidade com políticas | Sim | Doc | Revisões mensais registradas | CC4.1 |
| 5.37 Procedimentos documentados | Sim | Imp | CLAUDE.md, DEPLOY.md | CC5.3 |

## Pessoas (6.x)
| Controle | Aplica | Estado | Evidência | SOC 2 |
|---|---|---|---|---|
| 6.1–6.2 Seleção e contrato | Sim | Doc | 09 seção 1 | CC1.4 |
| 6.3 Treinamento | Sim | Pend | 09 seção 2; registrar o primeiro | CC2.2 |
| 6.4 Processo disciplinar | Sim | Doc | 01 seção 7 | CC1.5 |
| 6.5 Saída | Sim | Doc | 02 seção 3 | CC6.2 |
| 6.6 Confidencialidade | Sim | Pend | Modelo de termo a criar com jurídico | CC1.4 |
| 6.7 Trabalho remoto | Sim | Doc | 09 seção 6 | CC6.7 |
| 6.8 Relato de eventos | Sim | Imp | SECURITY.md, security.txt | CC2.3 |

## Físicos (7.x)
| Controle | Aplica | Estado | Justificativa |
|---|---|---|---|
| 7.1–7.6, 7.8, 7.11–7.13 Perímetro, entrada, escritórios, equipamentos de datacenter | Não | N/A | Sem escritório nem servidores próprios; herdados da Cloudflare (SOC 2/ISO) |
| 7.7 Mesa e tela limpas | Sim | Doc | 09 seção 3 |
| 7.9 Ativos fora das instalações | Sim | Doc | 09 seções 3 e 6 |
| 7.10 Mídias de armazenamento | Sim | Doc | Disco cifrado; 03 seção 4 |
| 7.14 Descarte de equipamentos | Sim | Doc | Apagar com formatação segura antes do descarte |

## Tecnológicos (8.x)
| Controle | Aplica | Estado | Evidência | SOC 2 |
|---|---|---|---|---|
| 8.1 Dispositivos de usuário | Sim | Doc | 09 seção 3 | CC6.8 |
| 8.2 Acesso privilegiado | Sim | Doc | 02 seção 2 | CC6.3 |
| 8.3 Restrição de acesso | Sim | Imp | `account_id` em toda consulta, papéis | CC6.1 |
| 8.4 Acesso ao código-fonte | Sim | Imp | GitHub com 2FA e proteção de branch (ligar) | CC6.1 |
| 8.5 Autenticação segura | Sim | Imp | PBKDF2, TOTP, bloqueio de tentativas, cookie httpOnly | CC6.1 |
| 8.6 Capacidade | Sim | Imp | Agregados diários (20.1); Workers Paid recomendado | A1.1 |
| 8.7 Malware | Sim | Doc | Antivírus nas estações; sem upload executável no produto | CC6.8 |
| 8.8 Vulnerabilidades técnicas | Sim | Imp | security.yml, Dependabot, 03 seção 3 | CC7.1 |
| 8.9 Configuração | Sim | Imp | wrangler.jsonc versionado, `_headers` | CC7.1 |
| 8.10 Exclusão de informação | Sim | Imp | Retenção 90 dias, DSAR apagar | P4.3 |
| 8.11 Mascaramento | Sim | Imp | Gravações mascaradas, PII mascarada antes da IA (D-084) | C1.1 |
| 8.12 Prevenção de vazamento | Sim | Imp | Validação de URL alvo, gitleaks | C1.1 |
| 8.13 Backup | Sim | Doc | 05 (automatizar export semanal) | A1.2 |
| 8.14 Redundância | Sim | Imp | Rede da Cloudflare, stale-if-error no snippet | A1.2 |
| 8.15 Logs | Sim | Imp | Histórico de atividades, eventos de segurança | CC7.2 |
| 8.16 Monitoramento | Sim | Pend | Monitor de disponibilidade e alertas | CC7.2 |
| 8.17 Sincronização de relógio | Sim | Imp | Herdado da Cloudflare; `received_at` do servidor | CC7.2 |
| 8.18 Utilitários privilegiados | Sim | Doc | `wrangler` só com a direção | CC6.3 |
| 8.19 Instalação de software | Sim | Doc | 09 seção 4 | CC8.1 |
| 8.20–8.22 Redes, serviços de rede, segregação | Sim | Imp | TLS, CORS restrito a EDITOR_ORIGINS, contas isoladas | CC6.6 |
| 8.23 Filtragem web | Não | N/A | Sem rede corporativa | — |
| 8.24 Criptografia | Sim | Imp | TLS/HSTS, JWT HS256, HMAC de webhooks, D1 cifrado | CC6.1 |
| 8.25–8.29 Ciclo de desenvolvimento, requisitos, arquitetura, codificação e testes de segurança | Sim | Imp | 03; Vitest, Playwright, CodeQL | CC8.1 |
| 8.30 Desenvolvimento terceirizado | Não | N/A | Sem terceiros hoje | — |
| 8.31 Separação de ambientes | Sim | Imp | 03 seção 4 | CC8.1 |
| 8.32 Gestão de mudanças | Sim | Imp | 03 seção 1 | CC8.1 |
| 8.33 Dados de teste | Sim | Imp | Seeds sintéticos (`seed.ts`, `seed-data.ts`) | CC8.1 |
| 8.34 Proteção durante auditoria | Sim | Doc | Auditor recebe acesso viewer temporário | CC4.1 |

## Itens que bloqueiam a auditoria (resumo)
1. Aprovar/assinar políticas e operar 3 meses gerando registros (revisões, backup, treinamento).
2. Ligar proteção de branch no GitHub e 2FA obrigatório em GitHub/Cloudflare.
3. Automatizar o export semanal do D1 e fazer o primeiro teste de restauração.
4. Monitor de disponibilidade e alertas.
5. Teste de invasão externo e auditoria interna.
6. Termo de confidencialidade e revisão jurídica do DPA e termos de uso.
