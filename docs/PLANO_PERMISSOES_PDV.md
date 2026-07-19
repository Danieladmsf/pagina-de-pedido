# Plano — Permissões do PDV configuradas na Retaguarda (v2)

> **Status:** planejamento revisado (nada implementado além da Fase 0).
> **Criado em:** 18/07/2026 · **Revisado em:** 19/07/2026 após `docs/ANALISE_PLANO_PERMISSOES_PDV.md` — as correções procedentes da análise foram incorporadas; as sobredimensionadas foram ajustadas à realidade do projeto (ver §11).
> **Pré-requisitos concluídos:** divisão `/pdv` + `/gestao` ativa e verificada; rename "Gestão" → "Retaguarda" (Fase 0, commit `53db195`).

---

## 1. Objetivo

Dar ao administrador, dentro da **Retaguarda**, uma tela de **Permissões do PDV** onde ele decide:

1. **Quais abas do menu do PDV aparecem** (Caixa, Delivery, Balcão, Mesa, Encomendas);
2. **O que pode ser feito dentro de cada aba** (ações granulares);
3. **Quais controles globais ficam disponíveis** (botão Retaguarda, toggle de Delivery).

**Natureza desta entrega (honestidade sobre o alcance):** Fases 1–3 são **controle de interface e prevenção de acidentes** para o login único atual. Não são segurança contra má-fé — o mesmo usuário Firebase continua podendo abrir `/gestao` pela URL e escrever no Firestore. A segurança real por identidade é a trilha de **operadores** (§8).

---

## 2. Descoberta importante: operadores já começaram nas rules

O `firestore.rules` do working tree (ainda **não commitado**) já contém a fundação de operadores: coleção `roles_operador/{uid}` (com `ownerId`, `active`, `name`), funções `isOperator()/isActiveOperator()/isOperatorOf()/isStaffOf()` e o uso de `isStaffOf(ownerId)` nas coleções operacionais. Criar/excluir operador está reservado a uma futura API com Admin SDK.

**Decisão adotada por este plano (confirmar antes da Fase 1):**
- Esta entrega segue sendo **por loja e para o login do dono** (controle visual). O trabalho de operadores continua em plano separado.
- O modelo `pdvPermissions` por loja **vira o perfil padrão do papel operador** quando o login de operador chegar: dono ignora as restrições, operador as recebe. Isso mantém as duas trilhas compatíveis sem acoplar os cronogramas.
- As rules de operador não são pré-requisito nem bloqueio para as Fases 1–3; permanecem como estão até a trilha de operadores ser retomada.

---

## 3. Contrato de dados e helper (único e tipado)

Campo novo em `store_profiles/{uid}`:

```jsonc
{
  "pdvPermissions": {
    "enabled": true,            // kill switch: false/ausente = PDV ignora TUDO deste campo
    "updatedAt": "<serverTimestamp>",
    "updatedBy": "<uid>",

    // Abas como BOOLEANOS diretos (sem objeto {visible}) — elimina a
    // ambiguidade de caminho apontada na análise (§2.1).
    "tabs": {
      "caixa": true,
      "delivery": true,
      "novo_pedido": true,
      "mesas": true,
      "encomendas_pedidos": true
    },

    "actions": {
      "caixa": {
        "abrirCaixa": true,
        "fecharCaixa": true,
        "suprimento": true,
        "sangria": true,
        "cancelarVenda": true,        // controla TAMBÉM a reativação da venda (mesma alçada)
        "verCaixasAnteriores": true   // revogada => sessão histórica aberta é encerrada
      },
      "delivery": {
        "finalizarPedido": true,      // abrir fechamento + confirmar pagamento
        "mudarStatus": true,          // Recebido/Pronto/Saiu p/ entrega + motoboy
        "editarItens": true,          // diálogo Adicionar/Remover
        "cancelarPedido": true,
        "descontoAcrescimo": true,
        "imprimirCupom": true         // SÓ impressão manual; a automática segue a config da loja
      },
      "novo_pedido": {
        "finalizarVenda": true,       // renomeado de criarPedido: gate no botão Finalizar E no handler de confirmação
        "descontoAcrescimo": true,
        "vendaPrazo": true
      },
      "mesas": {
        "gerenciarMesa": true,        // abrir/reabrir/trocar/cancelar mesa e alterar cliente
        "lancarItens": true,
        "fecharComanda": true,        // inclui imprimir conta parcial
        "aceitarPedidoOnline": true,  // inclui rejeitar/excluir pedido online
        "descontoAcrescimo": true,
        "vendaPrazo": true
      },
      "encomendas_pedidos": {
        "mudarStatus": true,          // vale no card E dentro do diálogo Editar (bypass apontado na análise §3.5)
        "editarEncomenda": true,
        "lancarSinal": true,          // separado de mudarStatus (confirmação lança valor no caixa)
        "reimprimir": true
      }
    },

    "global": {
      "botaoRetaguarda": true,
      "toggleDelivery": true
    }
  }
}
```

**Helper `src/lib/pdv-permissions.ts`:**
- Tipo `PdvPermissionPath` = união TypeScript de todos os caminhos válidos (`'tabs.caixa' | 'actions.caixa.sangria' | 'global.toggleDelivery' | ...`). Caminho errado **não compila**.
- `getPdvPermissions(storeProfile)` → objeto **normalizado** (só booleanos; defaults `true` para chave conhecida ausente; chaves desconhecidas preservadas para forward-compat).
- `can(perms, path)` → boolean. Nunca retorna objeto.
- `getEligibleTabs(perms, theme)` → lista canônica de abas visíveis **e aplicáveis ao tema** (Encomendas só em `confeitaria`). É a ÚNICA fonte para: validação na Retaguarda, botões do menu, gate de render do conteúdo, aba inicial, fallback em tempo real, sanitização do histórico.
- Regra dos 3 estados: `storeProfile === undefined` (carregando) ≠ perfil carregado sem o campo (tudo liberado) ≠ campo presente. Existe `arePermissionsResolved(storeProfile)` para o gate de loading (§5.4).

---

## 4. UI na Retaguarda — tela "Permissões do PDV"

**Integração exata com `gestao/page.tsx`** (corrige a lacuna da análise §4):
- ID da aba: **`permissoes_pdv`** (sem prefixo `perfil_`, para não cair no catch-all `activeTab.startsWith('perfil_')` que renderiza o `StoreProfileTab`).
- Novo item na `SidebarNav.tsx` (ícone `ShieldCheck`), acima de "Perfil da Loja".
- O wrapper de largura/scroll em `gestao/page.tsx:521` ganha `permissoes_pdv` na lista de abas de página cheia; render em bloco próprio `{activeTab === 'permissoes_pdv' && <PermissoesPdvTab .../>}`.
- Histórico de abas da Gestão (`gestao-tab`) já funciona por ID — nada a fazer além de usar `handleTabChange`.

**Componente `src/components/admin/PermissoesPdvTab.tsx`:**
- Um card por aba do PDV com switch mestre "Aba visível" + sub-switches de ações (acinzentados quando a aba está oculta, valores preservados).
- Card "Controles gerais" (botão Retaguarda, toggle Delivery) e switch mestre **"Aplicar permissões no PDV"** (`enabled`) no topo — desligado, o PDV ignora tudo (kill switch e rollback instantâneo).
- Botão **"Restaurar padrão"** (marca tudo `true`).
- Seção Encomendas só aparece para tema `confeitaria`.

**Validação de salvamento:** `getEligibleTabs(candidato, temaAtual).length === 0` → bloqueia com aviso. (E mesmo assim o PDV trata o caso — §5.2.)

**Persistência (corrige análise §7):**
- Salvar grava **somente os caminhos-folha alterados** via `updateDoc` com dot-paths (`'pdvPermissions.actions.caixa.sangria': false`) + `pdvPermissions.updatedAt/updatedBy`. Nunca reescreve o mapa inteiro → duas sessões da Retaguarda não se sobrescrevem, cliente PWA antigo não apaga chaves novas, e a seção Encomendas escondida pelo tema não volta a defaults.
- Não permite salvar antes do primeiro snapshot do perfil resolver.
- Erro no `updateDoc` mantém o formulário sujo com toast de erro.

---

## 5. Aplicação no PDV

### 5.1 Navegação centralizada (corrige análise §2.4)
Toda troca de aba passa por uma única função no `pdv/page.tsx`:

```ts
selectPdvTab(requested: TabId) {
  const eligible = getEligibleTabs(perms, theme);
  const target = eligible.includes(requested) ? requested : fallbackTab(eligible);
  // fallbackTab: 'delivery' se elegível → aba ativa anterior se elegível → eligible[0]
  setActiveTab(target);
  if (target !== requested) window.history.replaceState({ type: 'pdv-tab', tab: target }, '');
}
```

Usada: nos botões do top bar, no handler de `popstate` (linha ~87, que hoje chama `setActiveTab` direto), e nos callbacks indiretos (`onOpenCaixa` das abas Delivery/Balcão/Mesa). O `handleTabChange`/`pushState` atual é adaptado, não duplicado.

**Gate síncrono de render:** cada bloco `{activeTab === 'x' && ...}` vira `{activeTab === 'x' && eligibleTabs.includes('x') && ...}` — aba proibida não monta nem por um frame, independente do efeito de fallback.

### 5.2 Aba inicial e PDV vazio (corrige análise §2.2 e §2.3)
- Aba inicial: **`delivery` quando elegível** (preserva o comportamento atual da loja sem configuração); senão a primeira de `getEligibleTabs()`.
- `eligibleTabs.length === 0` (config adulterada, mudança de tema etc.): tela de recuperação com aviso "Nenhuma aba liberada — ajuste as Permissões do PDV na Retaguarda" + botão para `/gestao`. Nunca tela branca.
- Mudança de tema em tempo real passa pelo mesmo caminho (o efeito observa `eligibleTabs`, não só `perms`).

### 5.3 Revogação em tempo real (política explícita — análise §2.6)
- **A revogação prevalece.** O efeito de fallback troca de aba SEM passar pela confirmação de "alterações não salvas" da Mesa; o rascunho local da mesa é **preservado em memória** (não é apagado) — se a permissão voltar, o operador continua de onde estava; se não voltar, se perde ao fechar o PDV (decisão de produto: rascunho não sobrevive à revogação).
- **Todo handler sensível re-checa `can()` no momento do submit** (não só o botão): confirmar Sangria, confirmar fechamento, salvar edição de itens, etc. Modal aberto com permissão revogada → submit bloqueado com toast "Permissão removida pelo administrador" (o modal não precisa fechar sozinho; ele só não consegue mais confirmar).
- `verCaixasAnteriores` revogada com sessão histórica aberta → volta à sessão atual.

### 5.4 Loading sem flash permissivo (corrige análise §2.5)
Enquanto `storeProfile === undefined` (primeiro snapshot não resolvido), o top bar renderiza a estrutura mas **sem os botões de aba e sem os controles globais** (skeleton). Na prática a janela é pequena (o perfil chega junto do resto), mas o estado "carregando" nunca é tratado como "tudo liberado".

### 5.5 Fechamento compartilhado (corrige análise §3.6)
`descontoAcrescimo` e `vendaPrazo` NÃO são implementados nas abas: o `useFechamento`/`FechamentoModal` (`components/admin/fechamento/`) recebe capacidades explícitas:

```ts
useFechamento({ ..., allowAdjustments, allowPrazo })
```

- `allowAdjustments: false` → campos de desconto/acréscimo somem E `buildCheckout()` zera `discount/surcharge` do estado.
- `allowPrazo: false` → Prazo sai das formas de pagamento simples e do split, e uma seleção anterior de `conta_casa`/Prazo é resetada.
- Uma mudança, três abas cobertas (Delivery, Balcão, Mesa) — e é onde a checagem fica imune a "esconder só o botão".

### 5.6 Regra anti-#310 (mantida da v1)
Checagens de permissão condicionam **JSX e handlers**. Nunca criam `return` antecipado antes de hooks nem hooks condicionais — a lição do crash que derrubou a primeira divisão `/pdv`+`/gestao`.

---

## 6. Mapeamento técnico (arquivo → mudança)

| # | Arquivo | Mudança |
|---|---|---|
| 1 | `src/lib/pdv-permissions.ts` **(novo)** | Tipos/paths, defaults, `getPdvPermissions`, `can`, `getEligibleTabs`, `arePermissionsResolved` |
| 2 | `src/components/admin/PermissoesPdvTab.tsx` **(novo)** | Tela da Retaguarda (§4) |
| 3 | `src/components/admin/SidebarNav.tsx` | Item `permissoes_pdv` |
| 4 | `src/app/(sistema)/gestao/page.tsx` | Render da aba + wrapper linha ~521 |
| 5 | `src/app/(sistema)/pdv/page.tsx` | `selectPdvTab`, gate síncrono das abas, aba inicial, skeleton de loading, controles globais, repasse de `permissions` |
| 6 | `src/components/caixa/CaixaTab.tsx` | Gates: abrir/fechar/suprimento/sangria/cancelar+reativar/histórico (botões E handlers) |
| 7 | `src/components/admin/DeliveryTab.tsx` | Gates: finalizar/status/editar/cancelar/imprimir manual |
| 8 | `src/components/admin/NovoPedidoTab.tsx` | Gates: finalizarVenda (botão + confirmação) |
| 9 | `src/components/admin/MesasTab.tsx` | Gates: gerenciarMesa/lancarItens/fecharComanda/aceitarPedidoOnline |
| 10 | `src/components/admin/EncomendasPedidosTab.tsx` | Gates: mudarStatus (card E diálogo Editar), editar, lancarSinal, reimprimir |
| 11 | `src/components/admin/fechamento/*` | Capacidades `allowAdjustments`/`allowPrazo` + reset de estado proibido |

Sem mudanças em: regras do Firestore, coleções, APIs, webhooks, impressão automática.

---

## 7. Ordem de implementação (leitores antes da escrita — análise §8)

| Fase | Entrega | Observação |
|---|---|---|
| **0 ✅** | Rename Retaguarda | feita (53db195) |
| **1** | `lib/pdv-permissions.ts` + testes unitários do helper | puro/tipado; primeiro código com teste automatizado do projeto (vitest mínimo, só para esta lib) |
| **2** | PDV consome permissões (abas, navegação, loading, fallback, globais) | inócuo em produção: sem a tela, nenhum perfil tem `enabled: true` |
| **3** | Fechamento compartilhado + ações por aba (um commit por aba: Caixa → Delivery → Balcão → Mesa → Encomendas) | handlers re-checam `can()` |
| **4** | Tela na Retaguarda (a escrita entra por último) | só libera controles que o PDV já consome |
| **5** | Canário: ativar `enabled: true` só na Gostinho de Céu; validar com duas máquinas (Retaguarda salvando + PDV aberto) usando o checklist do §9 | depois liberar para as demais lojas |
| **6 (separada)** | Trilha de operadores (retomar as rules já iniciadas + API Admin SDK + guard + tela de usuários) | plano próprio; `pdvPermissions` vira o perfil do papel operador |

**Rollback:** desligar o switch `enabled` na tela (ou direto no Firestore) — o PDV volta ao comportamento integral sem deploy e sem apagar a configuração. Rollback de código é `git revert` dos commits da fase (cada fase é independente).

---

## 8. Segurança — enquadramento

- **Fases 1–5 = prevenção de acidentes.** Documentado na tela ("estas opções organizam o PDV; não impedem quem conhece o sistema").
- **PIN client-side foi descartado** (análise §6.2 procede: `store_profiles` tem leitura pública — um hash de PIN de 4–6 dígitos ali é quebrável offline; seria fricção disfarçada de segurança). A proteção real é a trilha de operadores (Fase 6), que já tem as rules iniciadas com o modelo certo (`roles_operador` + `isStaffOf`), identidade separada e negação de escrita por regra — não por interface.

---

## 9. Verificação

**Automatizada (Fase 1):** testes unitários de `pdv-permissions.ts` — perfil ausente libera tudo; parcial preenche defaults; `false` explícito nunca vira `true`; tipo inválido normaliza; chaves desconhecidas sobrevivem ao save; `getEligibleTabs` com todos os temas; caminho de aba inelegível.

**Checklist manual (Fases 2–5, nas lojas reais):**
1. Loja sem o campo → PDV idêntico ao atual, abrindo em Delivery.
2. `enabled: false` → idem, mesmo com restrições salvas.
3. Ocultar a aba ativa com o PDV aberto → troca suave para aba elegível, sem tela branca, sem #310, histórico (Back) não reabre a aba.
4. Botão "Abrir Caixa" da aba Delivery com Caixa oculta → não fura o gate.
5. Sangria revogada com modal aberto → confirmar é bloqueado com toast.
6. Desconto revogado → campos somem e desconto pendente não vai no `buildCheckout`.
7. Prazo revogado → some das formas simples e do split.
8. Encomendas: `mudarStatus: false` bloqueia também o status dentro do Editar; confirmar não lança sinal sem `lancarSinal`.
9. Duas sessões da Retaguarda salvando campos diferentes → nenhuma sobrescreve a outra (dot-paths).
10. Todas as abas desmarcadas à força no Firestore → tela de recuperação.

---

## 10. Decisões em aberto (respostas necessárias antes da Fase 1)

1. **Operadores:** confirmar a decisão do §2 (esta entrega = visual/por loja; operadores em plano separado). As rules não commitadas de `roles_operador` ficam paradas até lá — ou você quer que eu as commite/deploye já?
2. **Matriz de ações (§3):** os agrupamentos estão bons? (ex.: `cancelarVenda` cobrindo reativação; `gerenciarMesa` cobrindo cancelar/trocar/reabrir; `imprimirCupom` só manual.)
3. **Rascunho de mesa na revogação:** preservado em memória mas sem submit (proposta) — ok?

---

## 11. Nota sobre a análise externa

`docs/ANALISE_PLANO_PERMISSOES_PDV.md` foi incorporada quase integralmente (contrato tipado, `getEligibleTabs`, aba inicial retrocompatível, navegação centralizada + gate síncrono, loading em 3 estados, política de revogação, matriz de ações expandida, fechamento compartilhado, integração exata na Gestão, dot-paths na persistência, leitores-antes-da-escrita, kill switch, PIN descartado). Dois pontos foram **dimensionados** à realidade do projeto (1 dev, 3 lojas, zero infra de teste): a pirâmide completa de testes (componentes + E2E + emulator) vira testes unitários do helper + checklist manual nas lojas; e o versionamento com `revision`/transação vira dot-paths por folha + `updatedAt` (elimina as corridas realistas; se um conflito real aparecer, a transação entra depois sem mudar o schema).
