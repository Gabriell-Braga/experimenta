# PARTE 2 — O PLANO (salvar em docs/PLANO.md)

## Arquitetura decidida
- O app do editor abre o site do cliente num IFRAME.
- O site do cliente tem nosso SNIPPET instalado. Quando o snippet detecta que está dentro do editor, ele carrega o EDITOR AGENT. A detecção exige três coisas: parâmetro na URL, handshake via postMessage conferindo o event.origin exato do app, e token de curta duração validado na API.
- O agent roda na página real: destaca elementos no hover, seleciona no clique, edita texto inline, arrasta para mover e aplica operações ao vivo. Toda a UI do agent fica num Shadow DOM, isolada do CSS do site.
- Os painéis ficam no app, fora do iframe, e conversam com o agent por um protocolo RPC tipado sobre postMessage.
- Fallback para sites que bloqueiam iframe (X-Frame-Options / CSP frame-ancestors) ou que ainda não têm o snippet: extensão Chrome MV3. Apenas em sessões de edição iniciadas pelo app, ela remove esses headers via declarativeNetRequest e injeta o agent.
- As alterações são salvas como LISTA DE OPERAÇÕES, nunca como cópia de HTML.
- Publicar compila um JSON de configuração por conta, servido por CDN.
- Diferenciais em relação ao VWO:
  - anti-flicker por elemento, em vez de esconder a página inteira;
  - seletores que se curam via impressão digital do elemento;
  - alerta quando uma alteração não encontra o elemento;
  - o mesmo agent desenha o mapa de calor sobre o site real.

## Stack
- Monorepo com pnpm workspaces + Turborepo, TypeScript estrito.
- packages/shared: tipos e schemas (zod) de operações, experimentos, protocolo RPC e eventos.
- packages/selector: geração e resolução de seletores.
- packages/snippet: runtime do site do cliente. Vanilla TS, sem dependências, esbuild, meta < 10 KB gzip.
- packages/agent: editor agent (vanilla TS ou Preact), bundle separado, carregado só no modo edição.
- apps/editor: React + Vite + Tailwind, com Monaco para CSS/JS.
- apps/api: Hono (Node) + Postgres + Drizzle, OpenAPI gerado. Fina e com contrato claro, para integração futura.
- apps/extension: extensão Chrome MV3.
- apps/demo: site HTML estático + SPA React com rotas, para testes.
- Testes: Vitest (unitários) e Playwright (ponta a ponta). docker-compose para o Postgres. A CDN é simulada por pasta servida estaticamente.

## Modelo de operações
Cada operação tem: id, tipo, alvo, valor e ordem. O alvo contém:
- seletor principal;
- seletores alternativos;
- impressão digital do elemento: tag, texto resumido, atributos-chave, posição aproximada.

Tipos de operação:
- setText, setHTML, setStyle, setAttribute;
- addClass / removeClass, hide, remove;
- move (antes/depois/dentro), insertHTML, replaceImage.

Por variação, também existem customCSS, customJS e redirect (teste de URL dividida).

Regras de aplicação: as operações são idempotentes (elementos processados ficam num WeakSet) e aplicadas em ordem. Se o elemento ainda não existe, aguarde com MutationObserver até um timeout.

## Seletores
- Prioridade: id estável → data-* → classes estáveis → caminho curto ancorado no ancestral estável → nth-of-type como último recurso.
- Detecte e evite ids e classes gerados automaticamente (hashes, CSS-in-JS como "css-1x2y3z", "sc-").
- Na resolução: principal → alternativos → busca pela impressão digital. Achar por fallback gera o evento "seletor curado".
- O editor mostra um indicador de fragilidade do seletor.

## Snippet
1. Configuração por conta via CDN com cache, invalidada ao publicar.
2. ID do visitante em cookie first-party, com fallback em localStorage.
3. Segmentação: URL (exata, contém, regex), dispositivo, query params, novo ou recorrente.
4. Bucketing determinístico: murmurhash3(visitorId + experimentId) % 10000, com percentual de tráfego e pesos. Atribuição persistida; bots ignorados.
5. Anti-flicker por elemento: um <style> imediato com visibility:hidden só nos seletores alterados, liberando cada um após a aplicação. Timeout de segurança de 1500 ms (configurável). Modo "página inteira" opcional.
6. SPA: interceptar pushState/replaceState/popstate, reavaliar segmentação e reaplicar.
7. Adaptador de tracking plugável com os eventos exposure, conversion, selector_failed e selector_healed. Schema documentado em docs/EVENTOS.md para a integração com o analytics.
8. Metas: clique em seletor, visita a URL, envio de formulário, evento customizado via window.abq.push(...).
9. Modo QA: ?ab_force=experimento:variacao força uma variação e mostra um selo indicando qual está ativa.

## Segurança
- Token de edição de curta duração.
- Handshake com origin exato.
- customJS só pode ser publicado por usuários com permissão.
- Configuração publicada só leitura.
- account_id em todas as tabelas e consultas.

## Fases e tarefas

### Fase 0 — Fundação
- [x] 0.1 Monorepo, TS, lint, prettier, Turborepo
- [x] 0.2 docker-compose (Postgres) e `pnpm dev` subindo tudo com um comando
- [x] 0.3 Sites demo (HTML estático + SPA React com rotas, incluindo classes geradas por CSS-in-JS)
- [x] 0.4 packages/shared com schemas zod e testes

### Fase 1 — Motor de operações e seletores
- [x] 1.1 Geração de seletores com prioridades e detecção de classes geradas
- [x] 1.2 Impressão digital e resolução com fallback (seletor curado)
- [x] 1.3 applyOperations com todos os tipos, idempotência e espera via MutationObserver
- [x] 1.4 Testes cobrindo DOM que muda e todos os tipos de operação

### Fase 2 — Snippet de runtime
- [x] 2.1 Configuração, ID de visitante e segmentação
- [x] 2.2 Bucketing com teste de distribuição (10.000 visitantes ~50/50) e consistência
- [x] 2.3 Anti-flicker por elemento, com teste Playwright por capturas dos primeiros frames
- [x] 2.4 Suporte a SPA com teste de navegação
- [x] 2.5 Adaptador de eventos, metas, modo QA e docs/EVENTOS.md
- [x] 2.6 Medir e registrar o tamanho gzip em PROGRESSO.md

### Fase 3 — Editor (núcleo)
- [x] 3.1 Protocolo RPC tipado app ↔ agent, com testes
- [x] 3.2 Handshake seguro e carregamento do agent pelo snippet
- [x] 3.3 Agent: hover com contorno e label, seleção, breadcrumb de ancestrais (Shadow DOM)
- [x] 3.4 Agent: edição de texto inline, arrastar para mover, menu de contexto (editar, esconder, remover, inserir antes/depois, trocar imagem, copiar seletor)
- [x] 3.5 UI: barra superior (abas de variação, troca de dispositivo, desfazer/refazer, preview, salvar) e modo navegar vs editar
- [x] 3.6 UI: painel de propriedades (texto, tipografia, cores, espaçamento, borda, atributos)
- [x] 3.7 UI: lista de alterações (destacar, excluir, reordenar) e CSS/JS custom com Monaco
- [x] 3.8 Teste ponta a ponta: variação com texto, cor, elemento escondido, elemento movido e CSS custom, aplicada ao vivo e persistida após recarregar

### Fase 4 — API, persistência e publicação
- [x] 4.1 Schema do banco: contas, usuários, projetos, experimentos, variações, metas, versões
- [x] 4.2 Endpoints, OpenAPI e autenticação com permissões
- [x] 4.3 Publicação: compilar JSON e gravar na CDN local
- [x] 4.4 Teste Playwright do fluxo completo: criar → editar → configurar tráfego e meta → publicar → visitante cai na variação

### Fase 5 — Extensão Chrome
- [x] 5.1 Remoção de headers só nas sessões de edição + injeção do agent
- [x] 5.2 Página demo que envia X-Frame-Options/CSP e teste da extensão

### Fase 6 — Robustez
- [x] 6.1 Painel de saúde com selector_failed / selector_healed por experimento
- [x] 6.2 Aviso de seletor frágil no editor
- [x] 6.3 Detecção de conflito entre experimentos no mesmo elemento
- [x] 6.4 Histórico de versões com restauração

### Fase 7 — Mapa de calor e mapa de cliques
- [x] 7.1 Captura no snippet: cliques (seletor + posição relativa + viewport) e scroll, com amostragem e envio em lote via sendBeacon
- [x] 7.2 Agregação na API e eventos documentados em docs/EVENTOS.md
- [x] 7.3 Overlay no agent: heatmap em canvas, contagem de cliques por elemento, faixas de scroll, filtros por variação e dispositivo

### Fase 8 — Feedback dos primeiros usuários + dados
- [x] 8.1 Engine: operação não é reaplicada em OUTRO elemento enquanto o original segue na página (corrige HTML inserido duplicado e arrastar que "não fica"); edição de texto não copia nós inseridos
- [x] 8.2 Agent: "Editar HTML" do elemento (menu de contexto) e diálogo de HTML maior
- [x] 8.3 CSS/JS da variação em janela grande (expandir)
- [x] 8.4 Configurações do experimento separadas da edição (janela própria), meta escolhida clicando no site, validação visível ao adicionar meta/regra
- [x] 8.5 Amostragem do mapa de calor por conta (configurável pelo owner) em vez da env global
- [x] 8.6 Retenção dos eventos crus (expurgo diário) + detecção de rota de SPA mais robusta (hashchange)

### Fase 9 — Plataforma CRO: nova cara + fundação de dados (pedido: "Conversion Rate Optimization.pdf")
- [x] 9.1 Identidade visual própria (tokens, tipografia, componentes) e shell com navegação lateral por módulo (Painel, Testes, Insights, Engajamento, Dados, Configurações); roteamento por `?view=`
- [x] 9.2 Coleta de dados: sessão, pageview, eventos customizados com propriedades, identify/atributos, perfil local do visitante; visitor_id/session_id nos eventos; tela "Eventos" (fluxo recente + contagens)
- [x] 9.3 Motor estatístico (shared/stats): bayesiano beta-binomial (prob. de vencer, perda esperada, intervalo), z-test/p-valor, receita por visitante, SRM, amostra necessária/duração estimada
- [x] 9.4 Relatório do experimento: visitantes/conversões/receita por variação e meta, série diária, filtros (data, dispositivo, novo/recorrente), meta primária, comparar metas, CSV/imprimir

### Fase 10 — Behavior e Interaction Analytics
- [x] 10.1 Rage click, dead click e movimento do mouse no snippet; agregação; modos no overlay (calor, cliques, scroll, movimento, frustração) + lista de elementos
- [x] 10.2 Módulo Mapas de calor independente de experimento (lista de páginas mais vistas, visualizador sobre o site real com filtros)
- [x] 10.3 Gravação de sessão: bundle sob demanda `insights.js` (rrweb), amostragem, envio em blocos, armazenamento
- [x] 10.4 Player de sessões: lista com filtros (dispositivo, página, duração, frustração), player com linha do tempo de eventos, pular inatividade, velocidade (inclui mobile)

### Fase 11 — Form e Journey Analytics
- [x] 11.1 Form analytics: captura por campo (tempo, hesitação, re-preenchimento, ignorado, abandono) e relatório (chegaram → interagiram → enviaram)
- [x] 11.2 Funis: passos por URL/evento/meta, ordem por visitante, drop-off por passo, filtros
- [x] 11.3 Jornada: caminhos mais comuns, entradas/saídas, próximos passos a partir de uma página
- [x] 11.4 Coortes: por semana de primeira visita, retenção e conversão

### Fase 12 — Experimentação avançada
- [x] 12.1 Tipos de campanha: A/B, Split URL, Personalização (com holdout), Rollout, Server-side — fluxo de criação por tipo
- [x] 12.2 Teste multivariado (seções × variações, combinações fatoriais, relatório por combinação e por seção)
- [x] 12.3 Multi-armed bandit (Thompson sampling) com republicação automática

### Fase 13 — Segmentação, personalização e engajamento
- [x] 13.1 Audiências salvas com regras ricas (referrer, UTM, atributos, comportamento, cookie, variável JS, horário, idioma) usadas na segmentação
- [x] 13.2 Conteúdo dinâmico (`{{attr.nome|padrão}}`) nas operações de texto/HTML
- [x] 13.3 Pop-ups e banners com gatilhos (carregamento, atraso, scroll, intenção de saída, inatividade, clique) em `engage.js`; relatório
- [x] 13.4 Pesquisas (NPS, CSAT, CES, escolha, texto) com gatilhos e lógica; relatório
- [x] 13.5 Recomendações (cross-sell, upsell, próxima melhor oferta, mais vendidos): catálogo via snippet, API pública, widget

### Fase 14 — CDP, feature flags e integrações
- [x] 14.1 Perfis + resolução de identidade (identify liga visitantes a um usuário), linha do tempo, análise cross-device
- [x] 14.2 Audiências do CDP (regras sobre perfis), exportação e API de decisão (personalização cross-channel)
- [x] 14.3 Feature flags e experimentação server-side com SDK (packages/sdk)
- [x] 14.4 Integrações: webhooks assinados, chaves de API, GA4 e GTM

### Fase 15 — Reporting e IA
- [x] 15.1 Painel geral com KPIs de todos os módulos
- [x] 15.2 Insights automáticos (vencedor, SRM, frustração, campo com abandono, passo de funil, scroll baixo, segmento divergente)
- [x] 15.3 Analytics preditivo (propensão a converter; modelo publicado e avaliado no snippet; audiência por score)
- [x] 15.4 Otimização por IA: ideias de teste com Claude (quando houver chave) + piloto automático

### Fase 16 — Paridade com a VWO: confiança, governança e privacidade
Pedido de 2026-10-20: cobrir o que a VWO tem hoje e o app ainda não tem (comparação em docs/PROGRESSO.md, "Comparação com a VWO"). Fases 16–19 são esse pedido, na ordem de prioridade.
- [x] 16.1 Consentimento LGPD/GDPR no snippet: modo "esperar consentimento" por conta (nada de gravação, mapa de calor, formulários nem cookies até `abq.push(['consent', true])`), integração pronta com banners comuns (OneTrust, Cookiebot, CMP do Google Consent Mode v2), opt-out do visitante, tela de configuração; snippet continua < 10 KB gzip
- [x] 16.2 Multi-conta/workspaces: um usuário em várias contas (troca no menu do usuário), convite de membros por e-mail com papel, criação de conta nova (base do SaaS); toda consulta segue filtrando por account_id
- [x] 16.3 Histórico de atividades (auditoria): quem criou/editou/publicou/pausou/excluiu o quê e quando, por conta, com filtro por pessoa e tipo; tela em Configurar → Atividades e linha do tempo dentro do experimento
- [x] 16.4 Fluxo de aprovação opcional: editor pede publicação, owner (ou quem tem permissão) aprova/recusa com comentário; notificação na tela e por webhook
- [x] 16.5 Segurança de acesso: login em duas etapas (TOTP) opcional por usuário e obrigatório por conta; sessões ativas com "sair de todos"; base para SSO (SAML/OIDC) por conta
- [x] 16.6 Comentários e menções: comentários em experimentos, campanhas e ideias, com @menção de membro da conta

### Fase 17 — Experimentação avançada que falta
- [x] 17.1 Grupos mutuamente exclusivos: experimentos num grupo dividem o tráfego e o visitante entra em no máximo um; tela de grupos e aviso na lista
- [x] 17.2 Teste multipágina (funil): uma variação com alterações em várias páginas/URLs do mesmo fluxo, visitante fica na mesma variação em todas
- [x] 17.3 Link de pré-visualização/QA compartilhável por variação (sem publicar), com expiração; QA mode já existe no snippet (packages/snippet/src/qa.ts), falta gerar o link no editor
- [x] 17.4 Agendamento: iniciar/pausar experimento e campanha em data/hora (job de hora em hora já existe)
- [x] 17.5 Estatística: teste sequencial (pode olhar a qualquer momento sem inflar falso positivo) e redução de variância (CUPED) opcionais no relatório; métricas de guarda (guardrail) que alertam se uma variação piora outra meta
- [x] 17.6 Receita por canal: atribuição de receita/conversões por origem, UTM e campanha (first e last touch) no painel e no relatório do experimento

### Fase 18 — IA no estilo Copilot
- [x] 18.1 Criar variação por texto: "deixe o botão verde e troque o título por X" vira operações no editor visual (sobre o DOM da página no iframe), com pré-visualização antes de aplicar; usa o mesmo provedor das ideias (Claude ou modelo grátis)
- [ ] 18.2 Ideia → teste em um clique: "Criar teste" da ideia abre o editor já com nome, página, hipótese, meta e alterações sugeridas
- [ ] 18.3 Backlog de hipóteses (gestão do programa): ideias da IA e manuais num quadro (ideia → priorizada → em teste → concluída), priorização por impacto/confiança/esforço, ligação com o experimento e o resultado
- [ ] 18.4 Resumo por IA de gravações (o que o visitante tentou fazer e onde travou), de mapa de calor de uma página e de respostas abertas de pesquisa (temas e sentimento)
- [ ] 18.5 Assistente de relatório: explica o resultado do teste em linguagem simples e sugere o próximo passo
- [ ] 18.6 Geração de ideias mais confiável no Worker grátis: dividir em invocações separadas (painel numa, modelo noutra) para não depender do limite de 30 s do waitUntil (ver PROGRESSO 2026-10-20 02:30)

### Fase 19 — Ecossistema e mobile
- [ ] 19.1 Integrações prontas: Shopify (instalar snippet + eventos de compra), WordPress (plugin), Segment, Mixpanel, Amplitude (enviar exposição/conversão), HubSpot/Salesforce (atributos do CDP); cada uma com tela de configuração
- [ ] 19.2 SDKs server-side em mais linguagens (hoje só JS/TS em packages/sdk): Python, PHP, Go, Java/Kotlin, com o mesmo hash de bucket e testes de compatibilidade
- [ ] 19.3 App nativo: SDK React Native (flags, experimentos, eventos) e base para iOS/Android; mapas de calor e gravação de tela em app ficam para depois do SDK
- [ ] 19.4 Retry e fila de webhooks (pendência conhecida) e exportação agendada de dados (CSV/S3/BigQuery)

## Regras gerais
- Código limpo, modular e tipado. Nada de dependências pesadas no snippet.
- Se encontrar um caminho tecnicamente melhor que o descrito, registre a justificativa em docs/DECISOES.md e siga com ele. Se mudar a arquitetura de forma significativa, registre também em "Bloqueios / perguntas" para os humanos revisarem depois.
