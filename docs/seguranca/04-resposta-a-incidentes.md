# Resposta a Incidentes

Versão 0.1 — 2026-10-23. Controles ISO 27001: 5.24–5.28, 6.8. SOC 2: CC7.3–CC7.5. LGPD art. 48 e Resolução CD/ANPD nº 15/2024; GDPR art. 33–34.

## 1. O que é incidente
Qualquer evento que comprometa (ou possa comprometer) confidencialidade, integridade ou disponibilidade: vazamento, acesso indevido entre contas, credencial exposta, indisponibilidade acima de 1 h, perda de dados, vulnerabilidade explorada.

## 2. Severidade
| Nível | Exemplo | Resposta |
|---|---|---|
| S1 | Dados pessoais expostos, acesso entre contas, segredo de produção vazado | Imediata, 24/7 |
| S2 | Indisponibilidade da API/snippet > 1 h, vulnerabilidade alta sem exploração | Mesmo dia |
| S3 | Falha parcial, sem dados pessoais | Próximo dia útil |

## 3. Passos
1. **Detectar e registrar**: abrir `docs/seguranca/registros/incidente-AAAA-MM-DD-<tema>.md` com hora de detecção (relógio real) e quem detectou.
2. **Conter**: revogar sessões/tokens (`user_sessions`, `wrangler secret put` com novo valor), desligar a rota ou publicar config vazia; preservar evidências (logs, export do D1) antes de apagar.
3. **Avaliar**: quais contas, titulares e dados; se há risco ou dano relevante aos titulares.
4. **Comunicar**:
   - Clientes afetados (controladores): sem demora indevida, em até 48 h da confirmação, com o que se sabe, para que cumpram seus prazos.
   - ANPD (quando o Experimenta é controlador, ex.: dados de usuários do editor): em até 3 dias úteis do conhecimento, pelo formulário da ANPD; titulares no mesmo prazo quando houver risco relevante.
   - Autoridade da UE (dados de titulares na UE, quando controlador): em até 72 h.
5. **Erradicar e recuperar**: corrigir a causa raiz, restaurar dados (05), monitorar reincidência.
6. **Lições aprendidas**: em até 10 dias úteis, registro com causa raiz, linha do tempo, ações e prazos; ajustar riscos e controles.

## 4. Contatos
- Interno: Gabriel Braga (direção / gestor do SGSI).
- Relatos externos: e-mail de segurança de SECURITY.md (provisório: security@gabrielbraga.app).
- Cloudflare: suporte pelo painel; GitHub: security advisories do repositório.

## 5. Exercício
Simulação anual (mesa) de um S1, registrada.
