# Controle de Acesso

Versão 0.1 — 2026-10-23. Controles ISO 27001: 5.15–5.18, 8.2–8.5. SOC 2: CC6.1–CC6.3.

## 1. Acesso ao produto (clientes)
- Login por e-mail e senha (mínimo de 10 caracteres, hash PBKDF2-SHA256), duas etapas TOTP opcional por pessoa e obrigatória por conta quando o owner exigir.
- Sessão em cookie httpOnly, Secure, com validade de 12 h e revogável ("Sair de todos os outros").
- Bloqueio temporário após tentativas seguidas de login e de código TOTP.
- Papéis: viewer (lê), editor (salva), owner (publica, gerencia equipe e integrações). JS customizado só com owner ou permissão `can_publish_js`. Aprovação de publicação opcional.
- Chaves de API por conta, revogáveis, com escopo da conta.

## 2. Acesso interno (infraestrutura)
| Sistema | Quem | Requisito |
|---|---|---|
| Cloudflare (conta) | Direção | 2FA obrigatório; tokens de API com escopo mínimo e validade; nenhuma chave global |
| GitHub (repositório) | Desenvolvimento | 2FA obrigatório; proteção de branch `main` (PR + CI verde) |
| Banco D1 em produção | Direção | Só via `wrangler` autenticado; consultas manuais registradas em docs/PROGRESSO.md com o motivo |
| Segredos (`JWT_SECRET`, chaves de IA) | Direção | Só como secret do Worker (`wrangler secret put`); nunca no repositório (gitleaks no CI) |

Acesso a dados de clientes por suporte só com pedido do cliente registrado e pelo próprio produto (convite com papel viewer), nunca por consulta direta ao banco, salvo incidente.

## 3. Ciclo de vida
- Entrada: conta criada só após termo de confidencialidade assinado; papel mínimo.
- Mudança de função: revisar e ajustar no mesmo dia.
- Saída: revogar GitHub, Cloudflare, e-mail e sessões do produto em até 24 h; girar segredos que a pessoa conhecia.

## 4. Revisão de acessos
Mensal, registrada em `docs/seguranca/registros/AAAA-MM-acessos.md`: lista de pessoas com acesso a Cloudflare, GitHub e owners da conta interna; o que foi removido.

## 5. Segregação de funções (empresa de uma pessoa)
Risco aceito com mitigação: toda mudança passa por PR com CI obrigatório e revisão automatizada registrada; deploy só a partir da `main`; histórico de atividades do produto e logs de auditoria da Cloudflare exportados mensalmente para revisão. Ao contratar a segunda pessoa, a revisão de PR passa a ser humana e cruzada.
