# Conformidade: diagnóstico e plano para os selos que a VWO exibe

Data: 2026-10-23. Dono: Gabriel Braga (responsável pelo SGSI até haver um time).

## 1. O que a VWO tem (e o que cada selo exige)

Levantado em wingify.com/compliance e wingify.com/platform/security-compliance (VWO é marca da Wingify):

| Selo | Tipo | Quem emite | O que exige de nós |
|---|---|---|---|
| ISO/IEC 27001:2022 (SGSI) | Certificação | Organismo acreditado (ex.: BSI, Bureau Veritas, TÜV, DNV, ABNT) | SGSI documentado e operando ≥ 3 meses, análise de riscos, Declaração de Aplicabilidade (93 controles do Anexo A), auditoria interna, análise crítica pela direção, auditoria externa em 2 estágios, manutenção anual e recertificação em 3 anos |
| ISO/IEC 27701:2019 (SGPI) | Certificação (extensão da 27001) | Mesmo organismo, na mesma auditoria | Papéis de controlador/operador definidos, registro de tratamento, DPA, atendimento a titulares, avaliação de impacto |
| ISO/IEC 27017:2015 e 27018:2019 | Certificação/atestado de controles de nuvem e de dados pessoais em nuvem | Mesmo organismo | Controles extras: responsabilidade compartilhada com a Cloudflare, devolução/exclusão de dados do cliente, transparência sobre suboperadores e localização |
| SOC 2 Tipo II | Atestado (relatório) | CPA/auditor credenciado pelo AICPA | Controles dos Trust Services Criteria (Segurança obrigatório; Disponibilidade e Confidencialidade recomendados) operando e com evidência durante 3 a 12 meses |
| PCI DSS v4.0.2 | Atestado (AOC) | QSA ou autoavaliação (SAQ) | Só se tocarmos dados de cartão. Hoje não tocamos: a cobrança, quando existir, deve ir para Stripe/Pagar.me (SAQ A) |
| GDPR, CCPA, LGPD | Conformidade legal (não existe certificado) | Autodeclaração + contratos | Bases legais, DPA, cláusulas-padrão (SCC) para transferência, direitos do titular, aviso de cookies, encarregado (DPO) |
| HIPAA | Alinhamento (a VWO não armazena PHI) | Autodeclaração | Proibir PHI no produto e mascarar gravações; BAA só se um dia aceitarmos PHI |
| ISO 14001 e ISO 45001 | Ambiental e saúde ocupacional | Organismo acreditado | Fora do escopo de confiança de dados; ignorar até haver escritório e funcionários |
| CSA STAR | Autoavaliação (CAIQ) | Cloud Security Alliance | Questionário público gratuito; sai quase pronto do SGSI |

**Importante:** nenhum desses certificados pode ser "executado" só com código ou documentos. ISO e SOC 2 exigem auditor externo, período de operação com evidências e pagamento. O que dá para fazer agora, e foi feito na Fase 20, é deixar o produto e a documentação no ponto de passar na auditoria. Até lá, o site deve dizer "programa em preparação", nunca "certificado".

## 2. Diagnóstico (estado em 2026-10-23)

Legenda: OK = atende; PARCIAL = existe mas falta algo para a auditoria; FALTA = não existe.

### Produto (controles técnicos)
| Área | Estado | Evidência / lacuna |
|---|---|---|
| Isolamento entre clientes | OK | Toda consulta filtra por `account_id`; conta vem do token (CLAUDE.md, `repo.ts`/`repo-d1.ts`) |
| Autenticação | PARCIAL → OK na 20.4/20.6 | Senha com PBKDF2 (100 mil iterações, limite do Worker), TOTP, sessões revogáveis (D-073). QA apontou token no localStorage (20.4 move para cookie httpOnly), sem recuperação de senha (20.4) e sem bloqueio por tentativas no login por senha (20.6) |
| SSO (SAML/OIDC) | FALTA | Só a base (D-073). Clientes enterprise pedem; não é exigência de ISO/SOC 2 |
| Autorização | OK | Papéis viewer/editor/owner, JS customizado só com owner ou `can_publish_js`, aprovação de publicação (16.4) |
| Trilha de auditoria | PARCIAL → OK na 20.6 | Histórico de atividades (16.3). Faltavam login e falha de login; 20.6 completa |
| Criptografia em trânsito | OK | TLS da Cloudflare em todos os hosts; 20.6 adiciona HSTS |
| Criptografia em repouso | OK (da plataforma) | D1/KV cifrados pela Cloudflare. Segredo de TOTP e credenciais de integração ficam em claro dentro do banco (D-073): aceitável para a auditoria se registrado como risco aceito; cofre de chaves fica no plano |
| Cabeçalhos de segurança / CSP | FALTA → OK na 20.6 | |
| Consentimento (LGPD/GDPR/ePrivacy) | PARCIAL → OK na 20.4 | Portão de consentimento e CMPs existem (D-069), mas vinha desligado por padrão (achado alto do QA) |
| Minimização de dados | PARCIAL → melhor na 20.4 | Gravação mascara inputs; QA achou e-mail/telefone em URL alvo de experimento e domínios de terceiros (20.4 valida) |
| Retenção | OK | Eventos e gravações expiram em `EVENTS_RETENTION_DAYS` (90, D-039). Atividades sem expurgo (D-071): definir prazo na política |
| Direitos do titular | FALTA → OK na 20.6 | Exportar/apagar dados de um visitante |
| Backup e restauração | PARCIAL | D1 tem Time Travel (30 dias no plano pago, 7 no grátis); exportações manuais com `wrangler d1 export`. Falta rotina agendada e teste de restauração registrado |
| Disponibilidade | PARCIAL | Worker grátis estoura CPU no Painel (achado alto do QA, 20.1 agrega por dia). Sem monitor de disponibilidade nem página de status |
| Gestão de vulnerabilidades | FALTA → OK na 20.6 | CI sem varredura; 20.6 adiciona CodeQL, gitleaks, `pnpm audit`, Dependabot |
| Divulgação responsável | FALTA → OK na 20.6 | SECURITY.md e security.txt |
| Teste de invasão | FALTA | Exigido na prática por ISO/SOC 2 e por clientes: contratar 1×/ano |
| Página pública de segurança | FALTA → OK na 20.6 | `/seguranca` no editor, sem prometer certificado |

### Organização (o que o auditor pede além do código)
| Área | Estado |
|---|---|
| Política de segurança, escopo do SGSI, papéis | FALTA → rascunho em docs/seguranca (20.7) |
| Análise de riscos e Declaração de Aplicabilidade | FALTA → rascunho em docs/seguranca (20.7) |
| Registro de tratamento (ROPA), DPA, suboperadores | FALTA → rascunho em docs/seguranca (20.7) |
| Resposta a incidentes (ANPD em 3 dias úteis, GDPR 72 h) | FALTA → rascunho (20.7) |
| Pessoas: termo de confidencialidade, treinamento, entrada/saída | FALTA → política (20.7); executar ao contratar |
| Encarregado (DPO) nomeado e publicado | FALTA → decisão humana |
| Segregação de funções | RISCO: uma pessoa só desenvolve, aprova e publica. Mitigação aceita pelos auditores em empresa pequena: PR com revisão (mesmo que por IA + checagem humana registrada), CI obrigatório, logs imutáveis, revisão mensal de acessos |
| Seguro cibernético, contratos com cliente (termos, SLA) | FALTA → decisão humana/jurídico |

## 3. Plano

### Fase A — Produto e documentos (feito na Fase 20 deste repositório)
1. Corrigir os 23 itens do QA externo (20.1–20.5). Os 4 altos incluem dois de conformidade: coleta antes do consentimento e (médio) dados pessoais em URL.
2. Controles técnicos (20.6): cabeçalhos, bloqueio de força bruta, auditoria completa, exportar/apagar titular, CI de segurança, SECURITY.md, security.txt, página pública.
3. SGSI documental (20.7): `docs/seguranca/` com política, riscos, SoA, controle de acesso, desenvolvimento seguro, incidentes, continuidade, fornecedores, privacidade/ROPA, DPA modelo e mapa de controles ISO 27001 × SOC 2.

### Fase B — Operar e gerar evidências (meses 1–3, humano)
1. Aprovar e assinar as políticas (versão 1.0 com data). Nomear o encarregado (DPO) e publicar o contato.
2. Ligar o repositório no GitHub com proteção de branch: PR obrigatório, CI verde obrigatório (inclui `security.yml`).
3. Cloudflare: plano Workers Paid (resolve disponibilidade e dá 30 dias de Time Travel no D1), 2FA obrigatório na conta, tokens de API com escopo mínimo, logs de auditoria da conta exportados mensalmente.
4. Backup semanal (`wrangler d1 export`) para um bucket R2 separado, com teste de restauração trimestral registrado.
5. Monitor de disponibilidade externo e página de status.
6. Rotina mensal registrada: revisão de acessos (GitHub, Cloudflare, contas admin), alertas do Dependabot/CodeQL, eventos de segurança do histórico.
7. Teste de invasão externo (escopo: API, editor, snippet, extensão) e correção dos achados.
8. Ferramenta de automação de conformidade (Vanta, Drata, Secureframe ou a brasileira Ecomply/Privally para LGPD): reduz muito o custo de evidência para SOC 2 + ISO. Opcional, mas é como empresas pequenas fazem.

### Fase C — Auditorias (meses 3–9)
1. Auditoria interna da ISO 27001 (pode ser consultor) e análise crítica pela direção.
2. ISO 27001 + 27701 (+ 27017/27018 como extensão) com organismo acreditado: estágio 1 (documentos) e estágio 2 (operação). Prazo típico de 4 a 6 meses do início ao certificado.
3. SOC 2 Tipo I (data única) logo após a Fase B, e Tipo II com janela de observação de 3 a 6 meses na sequência.
4. Publicar CAIQ do CSA STAR nível 1 (gratuito).
5. PCI DSS: só quando houver cobrança; usar gateway hospedado e preencher o SAQ A.

### Custos de referência (ordem de grandeza, a confirmar com fornecedores)
- ISO 27001 + 27701 para empresa de 1–10 pessoas: R$ 40–90 mil no primeiro ciclo (consultoria + certificadora), depois manutenção anual menor.
- SOC 2 Tipo II: US$ 15–40 mil de auditoria + ferramenta de automação US$ 7–15 mil/ano.
- Teste de invasão: R$ 15–40 mil por rodada.

## 4. O que só um humano pode decidir
- Contratar certificadora, auditor SOC 2 e teste de invasão; orçamento.
- Nomear o encarregado (DPO) e o e-mail de segurança (o `security@gabrielbraga.app` usado nos arquivos é provisório).
- Assinar as políticas e o DPA com os clientes; revisão jurídica do DPA e dos termos de uso.
- Assinar o Workers Paid (também resolve o achado alto do Painel em definitivo).

## 5. Rastreabilidade
- Itens do QA → tarefas 20.1–20.5 em docs/PLANO.md; resultado por item no documento de QA corrigido (`QA do Experimenta - status.docx`).
- Controles → `docs/seguranca/mapa-de-controles.md`.
