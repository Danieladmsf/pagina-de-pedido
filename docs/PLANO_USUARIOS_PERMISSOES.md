# Plano — Usuários com permissões e segurança real (login de operador)

> **Status:** implementação parcial. A base entrou no commit `4e51258` em 20/07/2026; uma auditoria em 31/07/2026 confirmou o fluxo principal, mas encontrou bloqueios de segurança antes do canário/rollout (ver §0).
> **Criado em:** 19/07/2026
> **Leitura histórica:** as seções abaixo preservam o plano e o retrato do código em 19/07/2026. Afirmações como “falta” e “nada implementado” devem ser lidas nessa data-base.
> **Relação com o que já existe:** é a "Fase 7" que o plano `docs/PLANO_PERMISSOES_PDV.md` deixou para depois. As permissões do PDV (já implementadas e testadas) viram o **perfil de cada usuário**. As regras de operador no Firestore **já começaram** (ver §2).
> **Diferença desta fase:** aqui a proteção é **de verdade, no servidor** — não só esconder itens de interface. É o que o dono pediu ("com mais segurança").

---

## 0-B. Tudo virou interruptor do dono (21/08/2026)

O dono pediu o contrário do que este plano assumia em vários pontos: **nada
reservado ao master por decisão do código**. "Ao invés de predefinir algumas
coisas, por que não deixar tudo para escolher na página?"

O que mudou:

| Antes | Agora |
|---|---|
| 13 módulos, 9 travados em "Só o dono" | 16 módulos, nenhum travado |
| Módulo = booleano (só consulta) | Módulo = `{ ver, editar }`, duas decisões |
| Relatórios pendurado no Dashboard; Estoque em Produtos | chave própria para cada um |
| Visitantes sem chave (saía de carona na aba Delivery) | módulo próprio (menu, tela e placar) |
| Perfil da loja em 6 sub-chaves imaginadas | **uma** chave: o documento é salvo inteiro, separar seria promessa falsa |
| `verCaixasAnteriores` e `vendaPrazo` forçados a `false` no código | escolha do dono |
| Retaguarda do funcionário = casca read-only separada | mesma tela do dono, com o catálogo em leitura para quem não pode alterar |
| Gerir usuários = só o master | delegável, com trava de não escalada |
| Senha do funcionário = link por e-mail | o dono escolhe (ou sorteia) a senha na tela; apelido dispensa e-mail |

**As duas metades de cada interruptor.** Toda permissão nova tem gate de
interface *e* regra no Firestore lendo `permissions.retaguarda`. "Ver" sem
"alterar" é recusado no servidor, não só escondido na tela.

**O que sustenta o refactor:** `PdvAccessContext.storeUser` — a sessão de quem
está logado com o `uid` da loja. Resolve de uma vez os ~45 pontos em que as
telas descobriam o tenant por `user.uid` (§5 previa trocar um a um).

**Pendências desta rodada:**

1. `npm run test:rules` **não rodou** na máquina do dono: o node.exe não
   consegue abrir conexão nem para 127.0.0.1 (firewall/antivírus — testado com
   um servidor HTTP local do próprio node). As regras estão commitadas mas
   **não devem ir para produção** antes da suíte passar em algum lugar.
2. O gate da tela `VisitantesPage` ficou no working tree: o arquivo tinha WIP
   de outra sessão e commitá-lo sozinho quebraria o build.
3. Módulos liberados só para "ver" que ainda não têm tela de leitura própria
   (Clientes, WhatsApp, Campanhas, Encomendas, Entregas, Perfil) mostram a tela
   real com uma faixa de "modo consulta"; quem tentar salvar é recusado pelo
   servidor. Dar a esses módulos uma versão de leitura de verdade é o próximo
   passo natural.

Os itens 1-4 da seção 0 (31/07) continuam válidos: leitura legada por sessão
anônima em `clientes`, histórico de `orders`/caixa acessível a quem opera
venda, `store_profiles` público e baixa pública de estoque.

---

## 0. Atualização de implementação e auditoria (31/07/2026)

Já existem no código: `PdvAccessContext` com `ownerId` resolvido, perfil fail-closed por operador, guard de owner/operador, API server-side de usuários com Firebase Auth, convite por e-mail, tela “Usuários e acesso”, catálogo read-only para operador, autorização granular no PDV e suíte de regras para o emulador.

A auditoria desta data também corrigiu regressões localizadas no gate da Retaguarda, no tenant usado para fotos do WhatsApp, na sincronização entre `roles_operador.active` e Firebase Auth e na imutabilidade de `ownerId` nas regras.

**Ainda não considerar a promessa de “segurança real” concluída.** Antes da Fase F/canário, é obrigatório resolver:

1. `clientes` e `credit_transactions` ainda possuem leitura legada por sessão anônima; isso não protege de verdade a base e o extrato do cliente.
2. Um operador que precisa operar pedidos/caixa ainda consegue ler documentos históricos de `orders`, `cash_registers` e `cash_transactions`, logo consegue reconstruir faturamento anterior mesmo sem Dashboard.
3. `store_profiles` é lido publicamente por causa do cardápio e mistura configuração pública com dados que o plano classifica como privados; é necessário separar projeção pública de configuração privada.
4. A baixa pública de `menuItems.stockQuantity` e os pings de `active_sessions` continuam permissivos demais e precisam de um fluxo autenticado/transacional mais estrito.
5. A suíte de regras passou no Firebase Emulator usando o JRE 21 já instalado fora do `PATH`, mas o log ainda registra casos negados por limite de 1.000 expressões. É necessário ampliar os cenários positivos e fazer a suíte falhar diante de erro de avaliação, não apenas conferir `permission-denied`. O deploy das regras também deve ser confirmado separadamente.

Até esses itens serem resolvidos, os gates de interface ajudam a evitar erro operacional e várias ações já são recusadas no servidor, mas a garantia forte descrita no objetivo ainda é parcial.

---

## 1. Objetivo

Sair do modelo de **um login por loja** para **vários usuários, cada um com o seu login e o seu conjunto de permissões**:

- **Master (o dono):** vê tudo — todas as abas do PDV e todos os itens do menu lateral da Retaguarda.
- **Usuário simples (funcionário):** vê só o que o master liberar, no PDV **e** no menu lateral da Retaguarda.

E — o ponto central desta fase — que a restrição seja **imposta pelo servidor**: um funcionário sem acesso ao faturamento não consegue vê-lo nem contornando a interface.

**Os dois níveis de "permissão" (importante entender a diferença):**

| Nível | O que faz | Onde vive | Custo |
|---|---|---|---|
| **Interface** | Esconde a aba/o item do menu | No app (já temos, via `pdvPermissions`) | baixo |
| **Servidor** | Impede tecnicamente o acesso ao dado | Nas regras do Firestore | alto, é o trabalho desta fase |

O nível de interface sozinho resolve "funcionário não bagunça por acidente". O nível de servidor é o que protege **números do negócio** (faturamento, custos, base de clientes) contra curiosidade ou má-fé.

---

## 2. O que já existe (aproveitável — não jogar fora)

Confirmado no código em 19/07/2026:

- **`firestore.rules` já tem a fundação de operador** (deployada no commit df3b27c): coleção `roles_operador/{uid}` com `{ ownerId, active, name }`, e as funções `isOperator()`, `isActiveOperator()`, `isOperatorOf(ownerId)`, `isStaffOf(ownerId)`. Já aplicadas em pedidos, caixa, clientes e estoque (operador ativo é "staff"; cadastros/perfil seguem só do dono). Criar/excluir operador é **negado no cliente** — só via Admin SDK.
- **Admin SDK existe** em `src/lib/firebase-admin.ts`, mas **só expõe Firestore** (`getFirestore`). **Falta** a parte de Auth (`getAuth().createUser(...)`) para criar os logins. As credenciais de service account já estão em env vars (usadas por webhooks/campanhas).
- **`pdvPermissions`** (contrato tipado, helper `can`, `getEligibleTabs`) já normaliza permissões — reaproveitável como o "perfil" de cada usuário.
- **Guard de auth** em `src/app/(sistema)/layout.tsx` exige `roles_admin` hoje — precisa passar a aceitar operador também.

### O maior obstáculo técnico (medido, não estimado)

Há **~25 pontos em 10 arquivos** que consultam dados assim: `where('ownerId', '==', user.uid)`. Todos assumem que **o usuário logado é o dono**. Para um operador (uid diferente do dono), isso quebra: ele filtraria pelo próprio uid e não veria os dados da loja. **Esse refactor — trocar `user.uid` pelo `ownerId` resolvido — é o coração desta fase** (§5).

---

## 3. Identidade e papéis

Três papéis:

- **`owner` (master):** a conta atual da loja (`roles_admin`). Acesso total. Não muda.
- **`operator` (funcionário):** conta nova, registrada em `roles_operador/{uid}` apontando para o `ownerId` da loja. Acesso conforme o perfil.
- **`cliente` (anônimo):** o cardápio público. Não muda.

`roles_operador/{uid}` ganha o campo de perfil:

```jsonc
{
  "ownerId": "<uid da loja>",
  "active": true,
  "name": "Maria",
  "permissions": {           // mesmo formato de pdvPermissions, estendido:
    "pdv":  { "tabs": {...}, "actions": {...} },
    "retaguarda": {          // NOVO: itens do menu lateral
      "dashboard": false,    // relatórios/faturamento
      "produtos": true,
      "categorias": true,
      "clientes": true,
      "ofertas": false,
      "campanhas": false,
      "perfil": false,
      "permissoes": false,   // quem edita permissões
      "usuarios": false      // quem cria outros usuários
    }
  }
}
```

Regra de ouro: **só o master** enxerga `permissoes` e `usuarios`. Um operador nunca cria/edita usuários nem se autopromove.

---

## 4. Modelo de permissões da Retaguarda

Estende o helper existente. Hoje `pdvPermissions` cobre as abas do PDV; agora cobre também os **itens do menu lateral** da Retaguarda (Dashboard, Produtos, Categorias, Adicionais, Clientes, Ofertas, WhatsApp, Campanhas, Freelance, Perfil, Permissões, Usuários).

- Master: todos os itens sempre visíveis.
- Operador: só os itens marcados; a sidebar (`SidebarNav.tsx`) filtra pelo perfil; cada rota interna revalida (não basta esconder o item do menu — o gate de conteúdo também checa).

---

## 5. Resolver o `ownerId` (o coração da fase)

Um contexto único no topo do sistema:

```ts
PdvAccessContext = {
  role: 'owner' | 'operator',
  ownerId: string,        // do dono, sempre — resolvido do papel
  permissions: Permissions,
  isLoading: boolean,
}
```

Resolução:
- `roles_admin/{uid}` existe → `role: 'owner'`, `ownerId = uid`.
- `roles_operador/{uid}` existe e `active` → `role: 'operator'`, `ownerId = operatorData.ownerId`.
- Nenhum → sem acesso (volta ao login).

Depois, **substituir `user.uid` por `ownerId` do contexto** nos ~25 pontos de query e nas escritas. Feito **um arquivo por commit**, com verificação, para não quebrar o dono (que hoje funciona). Enquanto o refactor não termina, operador não é liberado — a fase não vai ao ar pela metade.

---

## 6. Segurança no servidor (o "com mais segurança")

Aqui mora a diferença desta fase. Cada coleção declara **quem pode o quê**, e o Firestore recusa o resto — mesmo que alguém chame a API direto, fora da interface.

**Classificação dos dados:**

| Categoria | Coleções | Operador ativo | Master |
|---|---|---|---|
| **Operacional** | orders, mesas, cash_transactions (caixa), estoque de menuItems | ler + escrever (já nas rules) | tudo |
| **Cadastro** | menuItems (preço/nome), categories, addons, promoções | **só ler** (para montar pedido) — **não** edita | tudo |
| **Sensível** | relatórios agregados, custos/margem, campanhas, base de clientes p/ exportação, store_profiles (config), admin_secrets, roles_* | **sem acesso** | tudo |

As funções `isStaffOf`/`isOperatorOf` já existem; falta **estender a classificação** para cadastro (só leitura) e sensível (negado), coleção por coleção, e **testar no emulador do Firestore** antes de publicar.

### A tensão honesta que o plano precisa encarar

**Operar caixa exige ler pedidos, e pedidos têm valores.** Então um operador que fecha pedidos consegue, somando, ver receita. Não dá para "operar sem ver valor". O que dá para proteger de verdade e vale a pena:

- **Custos e margem** de produto (se existirem) — o operador vê preço de venda, nunca o custo.
- **Relatórios agregados e histórico** — a visão de faturamento por período/Dashboard fica fora do app do operador; ele só enxerga a operação do **caixa atual**, não o histórico.
- **Configurações, campanhas, exportação da base de clientes, permissões e usuários** — negados por regra.

Ou seja: a promessa realista não é "o operador não vê nenhum número", é "o operador não vê **custos, histórico agregado e configurações**, e não consegue **alterar** nada além do operacional". Isso precisa estar escrito na tela para não prometer o que não entrega.

---

## 7. Criar os logins (Admin SDK + Auth)

Criar/remover usuário do Firebase **não pode** ser feito do navegador — vai para uma **API route** com Admin SDK:

1. Estender `firebase-admin.ts` para expor `getAuth()` (hoje só tem Firestore).
2. `POST /api/usuarios` (autenticado, só master): valida que quem chama é dono; `getAuth().createUser({ email })`; grava `roles_operador/{novoUid}` com `ownerId = master.uid` e o perfil.
3. **Senha inicial:** usar o **link de definição de senha do Firebase** enviado ao e-mail do funcionário — ele mesmo cria a senha. Isso evita senha em texto trafegando e respeita a regra de não manusear senhas de terceiros. (Alternativa: master define uma senha temporária, mas é menos seguro.)
4. Desativar = `active: false` (login bloqueado sem apagar histórico). Remover = Admin SDK apaga o usuário do Auth **e** o `roles_operador`.

A API confere no servidor que o solicitante é o dono daquela loja — o cliente nunca cria operador direto (as rules já negam `create`).

---

## 8. Tela de gestão de usuários (Retaguarda)

Novo item **"Usuários"** no menu lateral (visível só para master):

- Lista dos funcionários (nome, e-mail, ativo/inativo).
- **Novo usuário:** nome + e-mail + os toggles de permissão (abas/ações do PDV + itens do menu da Retaguarda) — reusa a tela de Permissões do PDV já pronta, agora salvando no perfil do usuário.
- Ações: editar permissões, ativar/desativar, remover, reenviar link de senha.
- Não é possível rebaixar o próprio master nem criar outro master por engano (trava explícita).

---

## 9. Guard e roteamento

- `(sistema)/layout.tsx` passa a aceitar **owner OU operador ativo** (hoje só `roles_admin`).
- **PDV:** owner e operador entram (operador com abas filtradas pelo perfil).
- **Retaguarda:** entra quem tiver ao menos um item de menu liberado; itens filtrados pelo perfil; quem não tem nada é mandado ao PDV.
- A **senha da Retaguarda** (fase anterior) é substituída, para operadores, pela própria identidade: cada um entra com o login dele. Para o master, a senha pode continuar como conveniência (decisão em aberto, §11).

---

## 10. Fases de implementação

| Fase | Entrega | Risco |
|---|---|---|
| **A. Contexto de acesso** | `PdvAccessContext` resolvendo role + ownerId; refactor dos ~25 `user.uid` → `ownerId` (um arquivo por commit). Sem liberar operador ainda. | médio-alto — mecânico mas espalhado; testar que o dono segue idêntico |
| **B. Regras no servidor** | Classificar cada coleção (operacional/cadastro/sensível); estender rules; **testar no Firebase Emulator**. Publicar antes do app. | alto — é a segurança; erro aqui ou vaza ou trava |
| **C. Criar usuários** | `getAuth()` no admin; `POST /api/usuarios`; link de definição de senha; ativar/desativar/remover. | médio |
| **D. Tela de Usuários + perfil na Retaguarda** | Menu "Usuários"; permissões do menu lateral; sidebar e rotas filtradas por perfil. | médio |
| **E. Guard + roteamento** | Layout aceita operador; PDV/Retaguarda filtrados; senha vira login. | médio |
| **F. Canário** | Um operador de teste numa loja; validar que vê só o liberado e que o servidor **recusa** o resto (tentativa direta ao Firestore). | — |

**Ordem obrigatória:** A antes de tudo (sem ownerId resolvido, nada funciona para operador); B publicado antes de C-D-E (a interface não pode liberar acesso que a regra ainda não protege).

---

## 11. Decisões em aberto (responder antes da Fase A)

1. **Até onde vai a proteção "sensível"?** Confirmar a lista do §6: custos/margem, histórico/relatórios, campanhas, exportação de clientes, configurações — todos negados ao operador? Algum deles o funcionário precisa ver?
2. **O operador vê valores do caixa atual?** (proposta: sim, é inerente a operar; histórico agregado, não.)
3. **Senha inicial:** link por e-mail (recomendado, mais seguro) ou senha temporária definida pelo master?
4. **A senha da Retaguarda continua** para o master, ou o login já basta e ela é removida?
5. **Níveis intermediários** (ex.: "gerente" que vê relatório mas não configura) — precisa agora ou dois papéis (master/simples) bastam para começar?

---

## 12. Resumo em uma linha

O que já existe (permissões de interface + fundação de regras de operador) vira a base; esta fase adiciona **identidade por pessoa**, **proteção real no servidor** e **uma tela para o master criar e limitar cada usuário** — sendo o refactor do `ownerId` (§5) e as regras do Firestore (§6) o grosso do trabalho e do risco.
