# Pendências (retomar depois do Workers Paid e de uma IA paga)

Lista do que ficou em aberto em 2026-10-20. Os detalhes de cada item estão em docs/PROGRESSO.md ("Bloqueios") e
nas decisões citadas. Ordem: o que destrava primeiro.

## 1. Plano grátis do Worker (resolve com Workers Paid, US$ 5/mês)
- **CPU de 10 ms por requisição**: o Painel geral com 30/90 dias e relatórios grandes estouram e o editor mostra
  "Limite da versão de testes" (D-088). Workers Paid dá 30 s de CPU. Alternativa sem pagar: agregados diários
  pré-calculados no D1 (trabalho grande).
- **Cota diária do D1 (100 mil linhas escritas/dia)**: cada evento custa ~7 linhas; o `pnpm seed:data` com 1.500
  visitantes já consome quase tudo num dia, e a migração dos dados do demo (item 3) regrava ~33 mil linhas.
- **Geração de ideias e relatórios em passos** (D-086) existem por causa do limite de CPU; com o plano pago dá para
  simplificar, mas não é obrigatório.
- **Webhooks**: reenvio de minutos depende de tráfego da conta; o job roda de hora em hora (cron do plano).

## 2. IA paga (chave da Anthropic ou outro provedor compatível)
- Sem `ANTHROPIC_API_KEY` (ou `AI_BASE_URL`/`AI_MODEL`) no Worker, tudo que é IA cai nas regras: variação por
  texto (18.1), ideias (18.6), resumos de gravação/mapa de calor/pesquisa (18.4) e "Explicar resultado" (18.5).
  Configurar com `wrangler secret put ANTHROPIC_API_KEY` e testar cada tela de novo.
- Máscara de PII por regex antes de mandar dados para a IA (D-084): revisar antes de usar com cliente real.
- Ideias: ler-modificar-gravar sem trava na entidade (D-083).

## 3. Demo: site simples removido de produção (feito no código, falta aplicar)
- O build do demo só leva a loja (`/loja/`, agora com `checkout.html` e `obrigado.html` próprios), o novo site
  SaaS (`/saas/`) e o `/bloqueado/`. A raiz redireciona para `/loja/`; `/produto.html` e `/obrigado.html` antigos
  redirecionam para o checkout e o obrigado da loja. As páginas simples ficam só no dev, como fixtures do E2E.
- **Migração dos dados simulados para a loja** (mesmos números, só URLs/seletores/nomes trocados):
  `scripts/migrar-demo-loja.ts` gera `apps/api/.tmp-migrar.sql` e `.tmp-demo.json`. Testado numa cópia local do
  D1 (contagens por tipo/teste/variação iguais, idempotente). Aplicar **depois da 00:00 UTC** (cota do item 1):
  1. `cd apps/api && pnpm exec wrangler d1 export abtest-db --remote --output=../../.data/backup-antes-loja.sql`
  2. `pnpm exec wrangler d1 execute abtest-db --remote --file=.tmp-migrar.sql`
  3. `pnpm exec wrangler kv key put demo.json --binding CDN --remote --path .tmp-demo.json`
  4. `pnpm deploy:cf` (recompila `demo.js` e publica o demo novo).
- As 6 gravações de sessão reais continuam mostrando o site antigo (o DOM gravado não dá para converter).
- Seletor de sites no topo (como as contas/workspaces do VWO): hoje a conta tem projetos na API, mas o editor só usa
  o primeiro. Decidir se cada site vira uma conta (já funciona, com troca de conta) ou se entra um seletor de projeto.

## 4. Validação com contas e aparelhos reais
- Integrações da 19.1 (HubSpot, Salesforce, Shopify, WordPress), destinos da exportação da 19.4 (S3/R2/GCS,
  BigQuery), SDK React Native e Java no Android: só testados com servidores falsos e stubs.
- SDKs PHP/Go/Java rodam só no CI; nenhum SDK publicado (PyPI, Packagist, Maven Central, npm). Sem Swift para iOS.

## 5. Outros
- Snippet a 9 B do limite de 10 KB gzip (D-069): a próxima mudança no runtime precisa do alvo es2020 ou de enxugar.
- SSO só configurado, sem OIDC/SAML (D-073). Sem serviço de e-mail (convites copiados à mão).
- E2E não roda com `pnpm dev` ligado (portas).
