# Fornecedores e Suboperadores

Versão 0.1 — 2026-10-23. Controles ISO 27001: 5.19–5.23. ISO 27701: 8.5.7–8.5.8. SOC 2: CC9.2.

## 1. Lista de suboperadores (publicar no site e anexar ao DPA)
| Suboperador | Finalidade | Dados | Local | Garantias |
|---|---|---|---|---|
| Cloudflare, Inc. | Hospedagem (Workers), banco (D1), cache (KV), CDN do snippet | Todos os dados do produto | Rede global; D1 na região escolhida | SOC 2 Tipo II, ISO 27001/27701/27018, PCI DSS, DPA com SCC |
| GitHub, Inc. (Microsoft) | Código-fonte e CI | Nenhum dado de cliente | EUA | SOC 2, ISO 27001 |
| Anthropic, PBC | IA (ideias, resumos, explicação de relatório) — só se a chave estiver configurada | Trechos de relatórios e resumos com PII mascarada (D-084) | EUA | SOC 2 Tipo II, ISO 27001, DPA; não treina com dados da API |

Integrações que o cliente liga (Segment, Mixpanel, Amplitude, HubSpot, Salesforce, Shopify, S3, BigQuery, webhooks) são destinos escolhidos pelo cliente (controlador), não suboperadores do Experimenta.

## 2. Avaliação de fornecedor novo
Antes de enviar dados de clientes: conferir relatório SOC 2 ou certificado ISO vigente, DPA assinado, localização dos dados e mecanismo de transferência internacional (SCC/cláusulas-padrão da ANPD). Registrar a avaliação aqui.

## 3. Mudanças
Novo suboperador: avisar os clientes com 30 dias de antecedência (DPA, cláusula 6), com direito de objeção.

## 4. Revisão
Anual: conferir validade dos certificados dos fornecedores e atualizar a tabela.
