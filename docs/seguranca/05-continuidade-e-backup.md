# Continuidade e Backup

Versão 0.1 — 2026-10-23. Controles ISO 27001: 5.29–5.30, 8.13–8.14. SOC 2: A1.1–A1.3.

## 1. Objetivos
| Serviço | RTO (voltar a funcionar) | RPO (perda máxima) |
|---|---|---|
| Snippet / configs na CDN | 1 h (sites dos clientes não quebram: sem config o snippet não altera nada) | Última publicação |
| API de coleta (`/collect`) | 4 h | 24 h |
| Editor e relatórios | 24 h | 24 h |

## 2. Falha segura do snippet
Se a API ou a CDN cair, o site do cliente continua: anti-flicker com tempo limite, cache na borda com `stale-if-error`, e ausência de config = página original. Este é o controle de continuidade mais importante para o cliente.

## 3. Backup
- D1: Time Travel da Cloudflare (7 dias no plano grátis, 30 no pago) para restauração pontual.
- Semanal: `wrangler d1 export abtest-db --remote --output=backup-AAAA-MM-DD.sql`, guardado em bucket R2 privado separado (ou armazenamento externo cifrado), retenção de 90 dias.
- Configs publicadas: regeneráveis a partir do banco (`publish`).
- Código: GitHub + cópia local.

## 4. Teste de restauração
Trimestral: restaurar o último export num D1 de teste, rodar `pnpm --filter @abtest/api test` contra ele e conferir contagens. Registro em `docs/seguranca/registros/AAAA-MM-restauracao.md`.

## 5. Dependência de fornecedor
Cloudflare é ponto único. Mitigação: o código roda também em Node + Postgres (`apps/api/src/server.ts`, `repo.ts`), então um plano de saída é publicar a API num provedor Node com Postgres e restaurar o export. Tempo estimado: 1 dia.
