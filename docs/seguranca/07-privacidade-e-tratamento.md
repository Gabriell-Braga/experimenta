# Privacidade e Registro das Operações de Tratamento (ROPA)

Versão 0.1 — 2026-10-23. LGPD art. 37; GDPR art. 30; ISO 27701: 7.2.8, 8.2.

## 1. Papéis
- **Experimenta como controlador**: dados das pessoas que usam o editor (clientes e membros das contas).
- **Experimenta como operador**: dados dos visitantes dos sites e apps dos clientes. O cliente define finalidade e base legal; nós tratamos segundo o DPA.

## 2. Registro de tratamento
| # | Atividade | Titulares | Dados | Base legal | Retenção | Papel |
|---|---|---|---|---|---|---|
| 1 | Conta e login no editor | Usuários dos clientes | Nome, e-mail, hash de senha, segredo TOTP, IP e user-agent das sessões | Execução de contrato (LGPD art. 7º V) | Enquanto a conta existir; sessões 12 h | Controlador |
| 2 | Histórico de atividades (auditoria) | Usuários dos clientes | Quem fez o quê e quando | Legítimo interesse / obrigação de segurança | 2 anos | Controlador |
| 3 | Testes A/B e personalização | Visitantes | Id aleatório do visitante (cookie), variação, URL, dispositivo | Definida pelo cliente (normalmente consentimento) | 90 dias (eventos) | Operador |
| 4 | Métricas e conversões | Visitantes | Eventos, metas, receita do pedido (valor, sem dados de pagamento) | Definida pelo cliente | 90 dias | Operador |
| 5 | Mapas de calor e gravações de sessão | Visitantes | Cliques, rolagem, DOM com campos mascarados | Consentimento (recomendado) | 90 dias | Operador |
| 6 | CDP / perfis (`identify`) | Visitantes identificados | Id do cliente, atributos enviados pelo cliente | Definida pelo cliente | Enquanto o cliente mantiver | Operador |
| 7 | Pesquisas e formulários | Visitantes | Respostas | Consentimento | 90 dias | Operador |
| 8 | IA (opcional) | Usuários e visitantes | Agregados de relatório, resumos com PII mascarada | Execução de contrato | Não armazenado pelo fornecedor além do processamento | Operador |

## 3. Minimização e privacidade por padrão
- "Esperar consentimento" ligado por padrão em contas novas; integração com OneTrust, Cookiebot e Google Consent Mode v2.
- Recusa do visitante apaga cookies `_abt*` e para a coleta.
- Gravações mascaram todos os inputs; classes `abt-block`/`abt-mask`.
- URL alvo de experimento validada: só domínios do workspace e sem parâmetros com dados pessoais.
- Sem IP do visitante armazenado nos eventos.
- Termos de uso proíbem enviar dados sensíveis (saúde, biometria, cartão) por `identify`/eventos.

## 4. Direitos do titular
- Usuário do editor: corrige e exclui pela própria conta ou pelo e-mail do encarregado; prazo de 15 dias (LGPD art. 19).
- Visitante: pede ao cliente (controlador). O cliente usa Configurar → Privacidade para exportar ou apagar tudo do id do visitante/usuário; repassamos pedidos que chegarem a nós ao cliente em até 2 dias úteis.

## 5. Transferência internacional
Cloudflare e Anthropic processam fora do Brasil. Mecanismo: cláusulas-padrão contratuais da ANPD (Resolução CD/ANPD nº 19/2024) e SCC da UE no DPA desses fornecedores.

## 6. Avaliação de impacto (RIPD/DPIA)
Fazer antes de lançar funcionalidade que trate dados de visitantes de forma nova (ex.: gravação em app nativo, identificação entre dispositivos). Modelo: finalidade, necessidade, riscos aos titulares, medidas.
