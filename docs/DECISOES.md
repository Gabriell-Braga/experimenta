# Decisões

Formato: contexto, opções, escolha, motivo.

## D-001 — Postgres sem Docker no ambiente de desenvolvimento
- Contexto: o plano pede docker-compose para o Postgres, mas a máquina de desenvolvimento atual não tem Docker instalado.
- Opções: (a) bloquear até instalarem Docker; (b) exigir Postgres nativo; (c) manter docker-compose.yml para quem tem Docker e usar PGlite (Postgres compilado para WASM, mesmo dialeto SQL) como fallback embutido quando `DATABASE_URL` não estiver definida.
- Escolha: (c).
- Motivo: Drizzle suporta os dois drivers com o mesmo schema; testes e `pnpm dev` funcionam sem infraestrutura externa; produção continua em Postgres real.

## D-002 — pnpm instalado via npm global
- Contexto: `corepack enable` falhou com EPERM em `C:\Program Files\nodejs`.
- Escolha: `npm i -g pnpm@9`. Versão fixada em `packageManager` no package.json raiz.

## D-003 — Pesquisa: premissas vs VWO/Optimizely (2026-10-14)
Fontes: help.vwo.com (artigos 360037883434, 360020440754, 900001789546), speedcurve.com/blog/web-performance-anti-flicker-snippets, docs da Adobe Target (Flicker Management), docs de extensões de Builder.io, Adobe Visual Editing Helper, Webtrends Optimize, Mida.
- **Confirmado — anti-flicker do VWO esconde a página inteira:** o SmartCode async esconde o `body` (campo `hide_element`), com `settings_tolerance` 2000 ms e `library_tolerance` 2500 ms. No timeout mostra o original e não rastreia. Nosso anti-flicker por elemento + timeout 1500 ms é diferencial real.
- **Diverge parcialmente — "por elemento" não é inédito:** Adobe Target (Flicker Management V2) pré-esconde só seletores extraídos das atividades. Continua sendo diferencial frente a VWO/Optimizely, não frente a todo o mercado.
- **Confirmado — extensão para iframe bloqueado:** padrão de mercado (Adobe Visual Editing Helper, Builder.io, Webtrends, Mida) remove X-Frame-Options e CSP frame-ancestors. Adobe e Builder.io também ajustam `SameSite` dos cookies para o login do site funcionar dentro do iframe. **Adição ao plano:** a extensão (5.1) também reescreverá `SameSite=None; Secure` em Set-Cookie apenas nas sessões de edição, senão sites com login quebram no iframe. Builder.io limita a reescrita ao contexto do próprio app, mesma ideia do nosso "só sessões iniciadas pelo app".
- **Confirmado — snippet síncrono no `<head>`:** recomendação de VWO e Optimizely para reduzir flicker. Nosso snippet deve ser instalado como primeiro script do head; o `<style>` anti-flicker é injetado de forma síncrona.
- **Não verificado:** documentação oficial do Optimizely sobre timeout padrão (fontes de terceiros divergem: 1–3 s). Não afeta o plano.

## D-004 — Contrato em packages/shared
- Operações: união discriminada por `type`; `move` e `insertHTML` usam `position` before/after/prepend/append (prepend/append = "dentro"). `move.value.anchor` é um Target completo (também cura).
- Experimento referenciado por `key` legível (usado em `ab_force=chave:variacao`) e `id` interno; a primeira variação é o controle; pesos inteiros relativos.
- Snippet só faz `import type` de shared (zod fica fora do bundle de 10 KB). A validação forte acontece na API e no editor; o snippet confia no JSON publicado.
- Eventos de tracking têm `eventId` para deduplicação no analytics.
