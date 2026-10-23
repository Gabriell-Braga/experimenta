# Gestão de Riscos

Versão 0.1 — 2026-10-23. ISO 27001: 6.1.2, 6.1.3, 8.2, 8.3. SOC 2: CC3.1–CC3.4.

## 1. Método
Risco = probabilidade (1–5) × impacto (1–5). Até 6: aceitar. 8–12: tratar no ano. 15 ou mais: tratar já. Revisão semestral e após mudança relevante ou incidente. Risco aceito precisa de aprovação da direção registrada aqui.

## 2. Registro
| # | Risco | P | I | Nível | Tratamento | Estado |
|---|---|---|---|---|---|---|
| R1 | Vazamento de dados entre contas por consulta sem `account_id` | 2 | 5 | 10 | Convenção + testes de repo nas duas implementações; revisão em PR | Tratado |
| R2 | Roubo de sessão por XSS no editor | 2 | 5 | 10 | Cookie httpOnly (20.4), CSP (20.6) | Tratado na Fase 20 |
| R3 | Força bruta de senha | 3 | 4 | 12 | Bloqueio por tentativas (20.6), TOTP | Tratado na Fase 20 |
| R4 | Coleta antes do consentimento em sites de clientes | 4 | 4 | 16 | Esperar consentimento por padrão (20.4) | Tratado na Fase 20 |
| R5 | Dados pessoais em URLs e gravações | 3 | 4 | 12 | Validação de URL (20.4), mascaramento | Tratado na Fase 20 |
| R6 | Indisponibilidade da API por limite do plano grátis | 4 | 3 | 12 | Agregados diários (20.1); Workers Paid | Parcial: assinar Workers Paid |
| R7 | Snippet lento trava sites dos clientes | 2 | 5 | 10 | Cache com stale-if-error, opção assíncrona (20.4) | Tratado na Fase 20 |
| R8 | Dependência vulnerável | 3 | 4 | 12 | Dependabot, `pnpm audit`, CodeQL (20.6) | Tratado na Fase 20 |
| R9 | Segredo vazado no repositório | 2 | 5 | 10 | gitleaks no CI, secrets do Worker | Tratado na Fase 20 |
| R10 | Perda de dados do D1 | 2 | 4 | 8 | Time Travel + export semanal + teste trimestral | Parcial: automatizar export |
| R11 | Uma pessoa acumula todas as funções | 5 | 3 | 15 | PR + CI obrigatório, logs, revisão mensal | Aceito com mitigação (direção) |
| R12 | Segredo TOTP e credenciais de integração em claro no banco | 2 | 4 | 8 | Banco cifrado pela plataforma; acesso só da direção | Aceito; cofre de chaves no plano |
| R13 | Dependência de um único provedor (Cloudflare) | 2 | 4 | 8 | Código roda em Node + Postgres; plano de saída (05) | Aceito |
| R14 | JS customizado de cliente malicioso ou errado quebra site | 3 | 3 | 9 | Permissão `can_publish_js`, aprovação, histórico | Tratado |
| R15 | Sem SSO para clientes grandes | 3 | 2 | 6 | OIDC/SAML no plano do produto | Aceito |
