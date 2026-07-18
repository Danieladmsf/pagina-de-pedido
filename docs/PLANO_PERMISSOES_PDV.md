# Plano — Permissões do PDV configuradas na Retaguarda

> **Status:** planejamento (nenhuma linha deste plano foi implementada ainda, exceto a Fase 0).
> **Criado em:** 18/07/2026
> **Pré-requisito concluído:** divisão do painel em `/pdv` (frente de caixa) e `/gestao` (Retaguarda), ativa e verificada em produção.

---

## 1. Objetivo

Dar ao administrador, dentro da **Retaguarda**, uma tela de **Permissões do PDV** onde ele decide:

1. **Quais abas do menu do PDV aparecem** para o operador (Caixa, Delivery, Balcão, Mesa, Encomendas);
2. **O que o operador pode fazer dentro de cada aba** (ações granulares — ex.: pode vender, mas não pode cancelar venda nem fazer sangria);
3. **Quais controles globais do PDV ficam disponíveis** (ex.: botão Retaguarda, toggle de Delivery LIGADO/DESLIGADO).

O resultado: a máquina da loja abre o `/pdv` enxuto, só com o que o dono liberou, e as operações sensíveis ficam restritas.

---

## 2. Contexto atual (o que existe hoje)

- **Login único por loja**: um só usuário Firebase com documento em `roles_admin`. Não existem papéis/operadores. Quem está no `/pdv` é o mesmo usuário que abre a `/gestao`.
- **Abas do PDV** (top bar do `src/app/(sistema)/pdv/page.tsx`), com seus IDs internos:
  | ID interno | Rótulo | Componente |
  |---|---|---|
  | `caixa` | Caixa | `components/caixa/CaixaTab.tsx` |
  | `delivery` | Delivery | `components/admin/DeliveryTab.tsx` |
  | `novo_pedido` | Balcão | `components/admin/NovoPedidoTab.tsx` |
  | `mesas` | Mesa | `components/admin/MesasTab.tsx` |
  | `encomendas_pedidos` | Encomendas (só tema confeitaria) | `components/encomendas/*` |
- **Controles globais do top bar do PDV**: botão **Retaguarda**, badge Aberto/Fechado do caixa, toggle **Delivery: LIGADO/DESLIGADO**, botão **Sair**.
- **Configurações da loja** moram em `store_profiles/{uid}` (documento único por loja, já assinado em tempo real pelo PDV via `useDoc`). A visibilidade da aba Encomendas já é condicionada por `storeProfile.theme === 'confeitaria'` — o mesmo mecanismo serve de modelo.

---

## 3. Modelo de dados

Novo campo no `store_profiles/{uid}` (não precisa de coleção nova nem de mudança nas regras do Firestore — o documento já é lido/escrito pelo dono):

```jsonc
{
  "pdvPermissions": {
    // Abas do menu: se a chave não existir, o padrão é TRUE (retrocompatível —
    // lojas que nunca configuraram continuam vendo tudo).
    "tabs": {
      "caixa":              { "visible": true },
      "delivery":           { "visible": true },
      "novo_pedido":        { "visible": true },
      "mesas":              { "visible": true },
      "encomendas_pedidos": { "visible": true }
    },

    // Ações granulares por aba (padrão TRUE quando ausente)
    "actions": {
      "caixa": {
        "abrirCaixa": true,
        "fecharCaixa": true,
        "suprimento": true,
        "sangria": true,
        "cancelarVenda": true,        // o X da lista de lançamentos
        "verCaixasAnteriores": true   // histórico de sessões
      },
      "delivery": {
        "finalizarPedido": true,      // modal de fechamento/pagamento
        "editarItens": true,          // diálogo Adicionar/Remover Itens
        "cancelarPedido": true,
        "descontoAcrescimo": true,    // campos do fechamento centralizado
        "imprimirCupom": true
      },
      "novo_pedido": {
        "criarPedido": true,
        "descontoAcrescimo": true,
        "vendaPrazo": true            // forma de pagamento Prazo / conta da casa
      },
      "mesas": {
        "abrirMesa": true,
        "lancarItens": true,
        "fecharComanda": true,
        "aceitarPedidoOnline": true   // fila de pedidos online da coluna direita
      },
      "encomendas_pedidos": {
        "mudarStatus": true,
        "editarEncomenda": true,
        "reimprimir": true
      }
    },

    // Controles globais do top bar do PDV (padrão TRUE)
    "global": {
      "botaoRetaguarda": true,        // esconde o atalho para /gestao
      "toggleDelivery": true          // liga/desliga a loja no cardápio
    }
  }
}
```

**Regras do modelo:**
- **Ausência = liberado.** Nenhuma migração de dados é necessária; lojas existentes não mudam de comportamento até o admin mexer na tela.
- Helper único de leitura: `lib/pdv-permissions.ts` exportando `getPdvPermissions(storeProfile)` que normaliza o objeto (preenche defaults) e `can(perms, 'caixa.sangria')`. **Toda** checagem passa por esse helper — nada de `storeProfile?.pdvPermissions?.actions?...` espalhado pelos componentes.

---

## 4. UI na Retaguarda — tela "Permissões do PDV"

**Onde:** novo item na sidebar da Retaguarda (`SidebarNav.tsx`), rótulo **"Permissões do PDV"**, ícone de cadeado (`Lock`/`ShieldCheck`), posicionado junto ao grupo do Perfil da Loja.

**Layout da tela** (`components/admin/PermissoesPdvTab.tsx`):

```
┌──────────────────────────────────────────────────────────┐
│ Permissões do PDV                                        │
│ Controle o que aparece e o que pode ser feito na frente  │
│ de caixa.                                                │
├──────────────────────────────────────────────────────────┤
│ ▸ CONTROLES GERAIS                                       │
│   [x] Botão "Retaguarda" visível no PDV                  │
│   [x] Toggle Delivery LIGADO/DESLIGADO                   │
├──────────────────────────────────────────────────────────┤
│ ▸ ABA CAIXA                              [x] Aba visível │
│     [x] Abrir caixa       [x] Fechar caixa               │
│     [x] Suprimento        [x] Sangria                    │
│     [x] Cancelar venda    [x] Ver caixas anteriores      │
├──────────────────────────────────────────────────────────┤
│ ▸ ABA DELIVERY                           [x] Aba visível │
│     [x] Finalizar pedido  [x] Editar itens               │
│     [x] Cancelar pedido   [x] Desconto/acréscimo         │
│     ...                                                  │
├──────────────────────────────────────────────────────────┤
│ (Balcão, Mesa, Encomendas — mesmo padrão)                │
│                                     [ Salvar permissões ]│
└──────────────────────────────────────────────────────────┘
```

**Comportamentos da tela:**
- Desmarcar "Aba visível" **desabilita visualmente** (acinzenta) os sub-toggles daquela aba, sem apagar os valores (se religar a aba, as ações voltam como estavam).
- A seção Encomendas só aparece se `theme === 'confeitaria'` (mesma condição da aba no PDV).
- Salvar faz `updateDoc` de `pdvPermissions` inteiro no `store_profiles` (merge no campo, não no documento).
- **Trava de segurança:** não permitir salvar com TODAS as abas invisíveis (o PDV ficaria vazio). Validação com toast explicativo.

---

## 5. Aplicação no PDV

### 5.1 Visibilidade das abas (top bar)
Em `pdv/page.tsx`, cada botão de aba passa a checar `can(perms, 'tabs.<id>')`, no mesmo estilo do gate existente `storeProfile?.theme === 'confeitaria'` da aba Encomendas.

- **Fallback da aba ativa:** se a aba atualmente ativa ficar invisível (admin salvou nova config com o PDV aberto — o `useDoc` atualiza em tempo real), trocar automaticamente para a primeira aba visível. Efeito pequeno no `pdv/page.tsx` observando `perms` + `activeTab`.
- A aba inicial (`useState('delivery')`) passa a ser "primeira aba visível" em vez de fixa.

### 5.2 Ações dentro das abas
Cada componente de aba recebe **um** prop novo: `permissions` (o objeto normalizado da sua seção). Internamente:

- **Esconder** botões de ações não liberadas (Suprimento, Sangria, X de cancelar, Fechar Caixa, etc.) — esconder, não desabilitar, para o operador nem ver a opção.
- Onde a ação tem atalho indireto (ex.: cancelar venda também cancela o pedido vinculado), a checagem fica **na função handler**, não só no botão.

**⚠️ Regra de implementação obrigatória (lição do bug React #310):** as checagens de permissão devem condicionar **JSX/handlers**, nunca criar `return` antecipado antes de hooks nem tornar hooks condicionais. O crash que derrubou a primeira tentativa da divisão `/pdv`+`/gestao` foi exatamente um return condicional no meio do `DeliveryTab` — não repetir o padrão.

### 5.3 Controles globais
- `global.botaoRetaguarda === false` → esconder o botão "Retaguarda" do top bar.
- `global.toggleDelivery === false` → esconder o toggle Delivery LIGADO/DESLIGADO.

---

## 6. Segurança — limites desta fase e evolução

**O que esta fase É:** controle de interface. Como o PDV e a Retaguarda usam o **mesmo login**, um operador que saiba a URL `/gestao` consegue abrir a Retaguarda digitando-a (mesmo com o botão escondido). Isso já resolve o caso real ("operador não mexe onde não deve por acidente"), mas **não é segurança contra má-fé**.

**Evolução — Fase de proteção real (decidir depois, fora do escopo deste plano):**
- **Opção A — PIN da Retaguarda:** um PIN de 4-6 dígitos (hash salvo no `store_profiles`) exigido pelo guard do layout ao entrar em `/gestao` quando `botaoRetaguarda === false`. Simples, sem novo login, mas o PIN protege só a UI (dados continuam acessíveis pelo mesmo usuário Firebase).
- **Opção B — Login de operador (a "Fase 2" já discutida na divisão de rotas):** usuários adicionais com papel `operador` em uma coleção de papéis, regras do Firestore restringindo escritas sensíveis, e tela de gestão de usuários na Retaguarda. É a solução completa e o dobro do trabalho. **As permissões desta fase viram o "perfil de permissões" do papel operador — o modelo de dados já nasce compatível.**

---

## 7. Mapeamento técnico (arquivo → mudança)

| # | Arquivo | Mudança |
|---|---|---|
| 1 | `src/lib/pdv-permissions.ts` **(novo)** | Tipos, defaults, `getPdvPermissions()`, `can()` |
| 2 | `src/components/admin/PermissoesPdvTab.tsx` **(novo)** | Tela de configuração (seção 4) |
| 3 | `src/components/admin/SidebarNav.tsx` | Item "Permissões do PDV" na lista |
| 4 | `src/app/(sistema)/gestao/page.tsx` | Renderizar a nova aba (`activeTab === 'permissoes_pdv'`) |
| 5 | `src/app/(sistema)/pdv/page.tsx` | Gate de visibilidade das abas + fallback da aba ativa + controles globais + repassar `permissions` |
| 6 | `src/components/caixa/CaixaTab.tsx` | Esconder Abrir/Fechar/Suprimento/Sangria/X/Caixas Anteriores conforme permissões |
| 7 | `src/components/admin/DeliveryTab.tsx` | Esconder finalizar/editar/cancelar/desconto/imprimir conforme permissões |
| 8 | `src/components/admin/NovoPedidoTab.tsx` | Esconder criar/desconto/prazo conforme permissões |
| 9 | `src/components/admin/MesasTab.tsx` | Esconder abrir/lançar/fechar/aceitar conforme permissões |
| 10 | `src/components/encomendas/*` (aba de pedidos) | Esconder status/editar/reimprimir conforme permissões |

Sem mudanças em: regras do Firestore, coleções, APIs, webhooks, impressão.

---

## 8. Fases de implementação

| Fase | Entrega | Risco |
|---|---|---|
| **0. Rename ✅ (feita em 18/07/2026)** | "Gestão" → "Retaguarda" no botão do PDV, no link da página de Ajuda e no subtítulo da sidebar. Rota continua `/gestao` (mudar a URL quebraria favoritos/histórico sem ganho). | zero |
| **1. Fundação** | `lib/pdv-permissions.ts` + tela na Retaguarda salvando no `store_profiles` (ainda sem efeito no PDV). | baixo — nada muda no PDV |
| **2. Visibilidade de abas** | Gate das abas + fallback da aba ativa + controles globais. | médio — testar flip em tempo real (admin salva com PDV aberto) |
| **3. Ações granulares** | Props `permissions` nos 5 componentes de aba, ação por ação. Fazer **uma aba por commit** (Caixa primeiro, que tem as ações mais sensíveis). | médio — muitos pontos de toque; commits pequenos |
| **4. Proteção real (opcional, decidir depois)** | PIN da Retaguarda (Opção A) ou login de operador (Opção B). | alto — envolve auth/regras |

**Ordem de commits sugerida:** F1 → F2 → F3-caixa → F3-delivery → F3-balcão → F3-mesa → F3-encomendas. Cada commit com build verde e push (padrão da casa).

---

## 9. Critérios de aceite / testes

1. Loja sem `pdvPermissions` no perfil → PDV idêntico ao de hoje (tudo visível). **Teste com as 3 lojas reais.**
2. Desmarcar aba Delivery → botão some do top bar; se o PDV estava na aba Delivery, cai na primeira aba visível sem tela branca e sem erro no console.
3. Desmarcar "Sangria" → botão Sangria some do CaixaTab; Suprimento continua.
4. Desmarcar "Cancelar venda" → o X some da lista de lançamentos.
5. Admin salva permissões com o PDV aberto em outra máquina → PDV reflete em tempo real (via `useDoc`) sem reload e **sem erro #310** (ver §5.2).
6. Desmarcar "Botão Retaguarda" → some do top bar do PDV; `/gestao` digitada na URL continua abrindo (limite documentado da fase, ver §6).
7. Tentar salvar com todas as abas invisíveis → bloqueado com aviso.
8. Loja tema confeitaria vê a seção Encomendas na tela de permissões; as outras não.

---

## 10. Decisões em aberto (confirmar antes da Fase 1)

1. **Granularidade está boa?** A lista de ações por aba (§3) foi derivada dos botões existentes. Confirmar se falta algo (ex.: permitir/bloquear reimpressão de cupom no Caixa? bloquear troca de motoboy no Delivery?).
2. **Configuração é por loja (um perfil de PDV para todas as máquinas).** Se precisar de perfis diferentes por máquina/turno, o modelo muda (multiplicar `pdvPermissions` por dispositivo) — avisar antes da Fase 1.
3. **Fase 4:** PIN simples (rápido) ou já partir para login de operador (completo)?
