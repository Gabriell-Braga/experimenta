# Desenvolvimento Seguro, Mudanças e Vulnerabilidades

Versão 0.1 — 2026-10-23. Controles ISO 27001: 8.8, 8.25–8.33. SOC 2: CC7.1, CC8.1.

## 1. Ciclo de mudança
1. Tarefa registrada em docs/PLANO.md (ou issue).
2. Código em branch, com testes (Vitest; Playwright para fluxos de tela).
3. PR para `main`; CI obrigatório: `pnpm test`, `pnpm lint`, `pnpm typecheck`, `security.yml` (CodeQL, gitleaks, `pnpm audit`).
4. Decisões de arquitetura e segurança em docs/DECISOES.md.
5. Deploy só da `main` (`pnpm deploy:cf`), com migrações versionadas e backup do D1 antes de migração destrutiva. Registro em docs/PROGRESSO.md.
6. Mudança emergencial: pode ir antes da revisão, mas o PR e o registro são feitos em até 1 dia útil.

## 2. Regras de código
- TypeScript estrito; validação de toda entrada externa com zod nas fronteiras (API, postMessage, configs).
- Toda consulta filtra por `account_id` e a conta vem do token, nunca do corpo.
- Sem segredos no código; sem dependências novas no snippet.
- Saída para planilha (CSV) protegida contra injeção de fórmula; HTML do cliente nunca é armazenado (só lista de operações).
- Modo edição só com token de 15 min, origem conferida e handshake (CLAUDE.md, "Modo edição").

## 3. Gestão de vulnerabilidades
| Severidade (CVSS) | Prazo de correção |
|---|---|
| Crítica explorável | 7 dias |
| Alta | 30 dias |
| Média | 90 dias |
| Baixa | Próxima janela, ou risco aceito registrado |

Fontes: Dependabot, CodeQL, `pnpm audit`, gitleaks, teste de invasão anual, relatos por SECURITY.md. Cada achado vira tarefa com prazo; exceções vão para o registro de riscos.

## 4. Separação de ambientes
Desenvolvimento local (PGlite/Postgres), E2E com banco em memória, produção na Cloudflare. Dados de produção não são copiados para desenvolvimento; quando inevitável (ex.: migração testada em cópia do D1), a cópia fica criptografada no disco e é apagada após o uso.
