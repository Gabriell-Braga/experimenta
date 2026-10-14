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
