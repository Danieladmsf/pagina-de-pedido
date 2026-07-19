# Plano — Permissões do PDV configuradas na Retaguarda (v3)

> **Status:** planejamento revisado (nada implementado além da Fase 0).
> **Criado em:** 18/07/2026 · **v2 em** 19/07/2026 após `docs/ANALISE_PLANO_PERMISSOES_PDV.md` · **v3 em** 19/07/2026 incorporando a decisão do dono: **senha para abrir a Retaguarda + "Modo Dono" no PDV** (ver §5.7 e §5.8; exemplos do dia a dia em `docs/EXEMPLOS_PERMISSOES_PDV.md`).
> **Pré-requisitos concluídos:** divisão `/pdv` + `/gestao` ativa e verificada; rename "Gestão" → "Retaguarda" (Fase 0, commit `53db195`).

---

## 1. Objetivo

Dar ao administrador, dentro da **Retaguarda**, uma tela de **Permissões do PDV** onde ele decide:

1. **Quais abas do menu do PDV aparecem** (Caixa, Delivery, Balcão, Mesa, Encomendas);
2. **O que pode ser feito dentro de cada aba** (ações granulares);
3. **Quais controles globais ficam disponíveis** (botão Retaguarda, toggle de Delivery);
4. **Senha do administrador**: abrir a Retaguarda passa a pedir uma senha (§5.7);
5. **"Modo Dono" no PDV**: um cadeado no PDV que, com a mesma senha, mostra tudo temporariamente — o dono não precisa de uma segunda tela de PDV nem de reconfigurar permissões para fazer uma sangria (§5.8).

**Natureza desta entrega (honestidade sobre o alcance):** é **controle de interface + fricção por senha** — resolve o caso real (funcionário não mexe onde não deve, nem por acidente nem por curiosidade). Não é segurança contra má-fé com conhecimento técnico: o computador inteiro usa o login da loja, então quem souber usar ferramentas de desenvolvedor contorna. A segurança à prova de má-fé é a trilha de **operadores** (§8).

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
- Card **"Senha do administrador"**: definir/alterar/remover a senha da Retaguarda (§5.7). Alterar ou remover exige digitar a senha atual. Sem senha definida, nada pede senha (retrocompatível).
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

### 5.7 Senha da Retaguarda
Fluxo do dia a dia: o funcionário clica em "Retaguarda" (ou digita `/gestao` na URL) → aparece um diálogo pedindo a senha → sem a senha certa, não entra.

- **Onde a senha fica:** hash (SHA-256 + salt aleatório) em uma coleção nova **`admin_secrets/{uid}`** — NUNCA no `store_profiles`, que tem leitura pública (qualquer pessoa na internet poderia baixar o hash e quebrá-lo offline; foi o motivo de a v2 ter descartado o PIN). `admin_secrets` exige a única mudança de rules desta entrega: `read/write` apenas para o usuário autenticado dono do documento. É uma adição isolada — não toca no trabalho não commitado de operadores.
- **Onde é exigida:** (a) no clique do botão "Retaguarda" do PDV; (b) num gate client-side do próprio `/gestao` (cobre o acesso direto pela URL). O gate vive na página da Gestão, não no layout compartilhado — o `/pdv` nunca pede senha para operar.
- **Sessão de desbloqueio:** válida na aba do navegador (sessionStorage) por **30 minutos** ou até fechar a aba, o que vier primeiro. Dentro da validade, navegar Retaguarda ↔ Frente de Caixa não repete a senha.
- **Sem senha definida → comportamento atual** (nada pede senha). Loja alguma muda até o dono criar a senha na tela de Permissões.
- **Esqueci a senha:** não há recuperação automática nesta fase; remove-se o documento `admin_secrets` via suporte (Admin SDK). Documentado na tela ("guarde bem esta senha").

### 5.8 "Modo Dono" no PDV
Fluxo do dia a dia: o dono está no PDV restrito e precisa fazer uma sangria bloqueada → clica no **cadeado** no top bar → digita a senha da Retaguarda → o PDV mostra **tudo** (todas as abas e ações), com um selo visível **"Modo Dono ativo"** e botão para sair do modo.

- Tecnicamente: um estado `ownerMode` que faz `getPdvPermissions()` retornar tudo liberado. Um único ponto de decisão no helper — os componentes não sabem que o modo existe.
- Expira sozinho: **10 minutos** sem interação, ao clicar em "Sair do Modo Dono", ou ao recarregar a página. Volta ao PDV restrito sem reload.
- O cadeado só aparece quando há senha definida E `enabled: true` (sem restrições ativas, não há o que destravar).
- Elimina a necessidade de "um segundo PDV completo do adm": é o mesmo PDV, destravado temporariamente.

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
| 12 | `src/lib/admin-password.ts` **(novo)** | Hash+salt, verificar senha, sessão de desbloqueio (sessionStorage), estado do Modo Dono |
| 13 | `src/components/admin/AdminPasswordDialog.tsx` **(novo)** | Diálogo de senha (usado pelo botão Retaguarda, pelo gate do `/gestao` e pelo cadeado do Modo Dono) |
| 14 | `firestore.rules` | **Única mudança de rules:** bloco isolado `admin_secrets/{uid}` (read/write só do dono autenticado) |

Sem mudanças em: coleções existentes, APIs, webhooks, impressão automática, trabalho não commitado de operadores.

---

## 7. Ordem de implementação (leitores antes da escrita — análise §8)

| Fase | Entrega | Observação |
|---|---|---|
| **0 ✅** | Rename Retaguarda | feita (53db195) |
| **1** | `lib/pdv-permissions.ts` + testes unitários do helper | puro/tipado; primeiro código com teste automatizado do projeto (vitest mínimo, só para esta lib) |
| **2** | PDV consome permissões (abas, navegação, loading, fallback, globais) | inócuo em produção: sem a tela, nenhum perfil tem `enabled: true` |
| **3** | Fechamento compartilhado + ações por aba (um commit por aba: Caixa → Delivery → Balcão → Mesa → Encomendas) | handlers re-checam `can()` |
| **4** | Tela na Retaguarda (a escrita entra por último) | só libera controles que o PDV já consome |
| **5** | Senha da Retaguarda + Modo Dono (`admin_secrets` + rules isoladas + diálogo + cadeado) | sem senha definida, nada muda; ordem código→rules do padrão da casa |
| **6** | Canário: ativar `enabled: true` + definir senha só na Gostinho de Céu; validar com duas máquinas (Retaguarda salvando + PDV aberto) usando o checklist do §9 | depois liberar para as demais lojas |
| **7 (separada)** | Trilha de operadores (retomar as rules já iniciadas + API Admin SDK + guard + tela de usuários) | plano próprio; `pdvPermissions` vira o perfil do papel operador |

**Rollback:** desligar o switch `enabled` na tela (ou direto no Firestore) — o PDV volta ao comportamento integral sem deploy e sem apagar a configuração. Rollback de código é `git revert` dos commits da fase (cada fase é independente).

---

## 8. Segurança — enquadramento

- **Fases 1–6 = prevenção de acidentes + fricção por senha.** Documentado na tela ("estas opções organizam o PDV; não impedem quem conhece o sistema").
- **A senha (§5.7) corrige o problema que derrubou o PIN da v1/v2:** o hash sai do `store_profiles` (leitura pública — quebrável offline por qualquer um) e vai para `admin_secrets` (legível só pela sessão autenticada da loja). Limite honesto que permanece: o PDV usa o MESMO login do dono, então um funcionário com conhecimento técnico e acesso à máquina ainda conseguiria ler o hash ou chamar o Firestore direto. Para o cenário real (funcionário comum, clique acidental), a senha resolve; contra má-fé técnica, não.
- **Proteção à prova de má-fé** é a trilha de operadores (Fase 7), que já tem as rules iniciadas com o modelo certo (`roles_operador` + `isStaffOf`), identidade separada e negação de escrita por regra — não por interface.

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
11. Sem senha definida → botão Retaguarda entra direto, cadeado não aparece (comportamento atual intacto).
12. Com senha: botão Retaguarda e URL `/gestao` pedem senha; senha errada não entra; certa entra e não repete por 30 min na mesma aba.
13. Modo Dono: cadeado + senha mostra tudo com selo visível; expira em 10 min sem interação e ao recarregar; "Sair do Modo Dono" volta ao restrito sem reload.
14. Alterar/remover senha exige a senha atual.

---

## 10. Decisões em aberto (respostas necessárias antes da Fase 1)

1. ~~**Operadores agora ou depois?**~~ **RESOLVIDA (19/07/2026):** o dono confirmou o desenho "PDV restrito para funcionários + Retaguarda completa protegida por senha + Modo Dono no PDV" — que é esta entrega, por loja, com o login atual. Operadores ficam para plano separado (Fase 7). Pendência menor: o que fazer com as rules não commitadas de `roles_operador` (seguram como estão até a Fase 7, salvo ordem em contrário).
2. **Matriz de ações (§3):** os agrupamentos estão bons? (ex.: `cancelarVenda` cobrindo reativação; `gerenciarMesa` cobrindo cancelar/trocar/reabrir; `imprimirCupom` só manual.) Exemplos práticos em `docs/EXEMPLOS_PERMISSOES_PDV.md`.
3. **Rascunho de mesa na revogação:** preservado em memória mas sem submit (proposta) — ok? Exemplos práticos no mesmo arquivo.

---

## 11. Nota sobre a análise externa

`docs/ANALISE_PLANO_PERMISSOES_PDV.md` foi incorporada quase integralmente (contrato tipado, `getEligibleTabs`, aba inicial retrocompatível, navegação centralizada + gate síncrono, loading em 3 estados, política de revogação, matriz de ações expandida, fechamento compartilhado, integração exata na Gestão, dot-paths na persistência, leitores-antes-da-escrita, kill switch, PIN descartado). Dois pontos foram **dimensionados** à realidade do projeto (1 dev, 3 lojas, zero infra de teste): a pirâmide completa de testes (componentes + E2E + emulator) vira testes unitários do helper + checklist manual nas lojas; e o versionamento com `revision`/transação vira dot-paths por folha + `updatedAt` (elimina as corridas realistas; se um conflito real aparecer, a transação entra depois sem mudar o schema).
