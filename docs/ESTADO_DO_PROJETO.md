# Estado do Projeto — retomar daqui (atualizado 2026-07-25)

> Documento de handoff. Se o contexto se perder, comece por aqui.
> Nada ficou pela metade em produção.

---

## Resumo em 30 segundos

As três frentes que abriram este documento (19–20/07):

1. **Permissões do PDV** — PRONTO e NO AR. Nada a fazer.
2. **Usuários / login de operador** — **PUBLICADO e validado em produção** em 20/07 (commit `4e51258` + regras). Sobraram duas pontas, nenhuma urgente: a **decisão de design da Retaguarda** (§2) e a **Etapa 2** do relatório de vendas por funcionário (§2).
3. **WhatsApp parado (Lima Limão + Gostinho de Céu)** — DIAGNOSTICADO em 20/07 e **não é o código**. Depende de ação do dono na tela (reconectar/reler QR). **Nada mudou aqui desde então: confirmar com ele antes de assumir que segue quebrado.**

Depois disso o trabalho foi para outro lado (21–25/07): **Encomendas** ganhou o fluxo de confeitaria completo (bolo por kg, doces por cento, catálogo editável, acompanhamento do cliente), entrou **venda por peso (kg)** no PDV, a **auditoria** de quem fez cada lançamento do caixa, **frete editável** no pedido, e a **consolidação da impressão de cupom** (§5).

Código: `main` em `dee1604`, sincronizado com o GitHub, working tree limpo. Regras do Firestore em produção são as **novas** (com operador). Detalhe em §4.

---

## 1. Permissões do PDV — ✅ PRONTO E NO AR

- Implementado e deployado (commit `df3b27c`, 19/07). Testado em produção na loja teste.
- O dono liga na Retaguarda → "Permissões do PDV": escolhe abas visíveis e ações por aba do PDV.
- Senha da Retaguarda + "Modo Dono" funcionam.
- Planos: `docs/PLANO_PERMISSOES_PDV.md` (v3), `docs/EXEMPLOS_PERMISSOES_PDV.md`.
- **Nada pendente aqui.**

---

## 2. Usuários / login de operador — 🟢 PUBLICADO E VALIDADO EM PRODUÇÃO (2026-07-20)

**Publicado em 2026-07-20** na ordem segura: código primeiro (commit `4e51258`, deploy Vercel), depois as regras (firebase deploy). Validado no navegador com a conta teste (dono): PDV, Caixa (sessão/lançamentos/totais), Delivery + contador de clientes online, Retaguarda (Dashboard, Clientes, aba nova Usuários com a API respondendo), e o **cardápio público de uma loja real** — tudo funcionando, console limpo, com as regras novas. Retrocompatibilidade confirmada.

Ponto de reversão (se algo aparecer depois): commit `9bed103`; backup das regras antigas em `scratchpad/firestore.rules.PROD_BACKUP`.

**Criação de usuário validada (2026-07-20):** criei "Operador Teste" (email `teste+operador@gmail.com`, alias que cai na caixa do teste@gmail.com) pela tela, com acesso restrito (só Delivery + finalizar/mudar status). API respondeu, papel gravado com ownerId/permissões corretos, login criado no Firebase Auth, e-mail de convite enviado. Console limpo. **Falta só o login real do operador** (o dono abre o e-mail, cria a senha, loga com teste+operador@gmail.com e confere o PDV restrito — o dono digita a senha, eu não). A senha de Retaguarda de teste (1234) foi REMOVIDA da conta teste.

### (histórico) O que estava pendente antes da publicação

Plano: `docs/PLANO_USUARIOS_PERMISSOES.md`. O Codex implementou as Fases A–E direto no working tree e travou no limite de uso. **Eu (sessão de 20/07) revisei tudo e testei.**

### O que já funciona (verificado)
- **Regras do Firestore reescritas** com proteção granular por ação de operador (dono lê o próprio segredo, operador não se autopromove, cada ação testada isolada, Conta da Casa sempre bloqueada para operador, operador inativo/legado recusado).
- **API `/api/usuarios`** (criar/listar/editar/desativar/remover/reenviar convite) — via Admin SDK, com verificação de token (checkRevoked), sem login órfão, delete desativa antes de apagar.
- **Login por e-mail + link** de definição de senha (o funcionário cria a própria senha; o dono não a vê).
- **Contexto de acesso** (`PdvAccessContext`) resolve owner/operador e o `ownerId` real — o refactor dos ~25 `user.uid` já foi feito.
- **Tela "Usuários"** na Retaguarda (só master vê).
- Operador na Retaguarda vê catálogo **somente-leitura** (componente separado), não a tela de edição do dono.
- **Proteção do WhatsApp**: operador só dispara notificação pré-definida vinculada a um pedido real da loja dele.
- **O "Modo Dono" foi REMOVIDO** — faz sentido: com login próprio, o dono usa a conta dele; não precisa do desbloqueio temporário.

### Verificações que EU rodei e passaram (tudo local, nada em produção)
- Teste das regras no **emulador do Firestore**: 40+ cenários originais, todos passando. (Corrigi um bug no próprio script de teste — ele não autenticava os usuários de verdade.)
- **Reforcei a suíte com 11 cenários de ATAQUE** (escalação de privilégio + cross-tenant): operador não rouba pedido mudando ownerId, não cria pedido p/ outra loja, não lê papel de outro operador, não se autoconcede permissões, não lê caixa/segredo de outra loja, operador da loja B não vê nada da loja A. **Todos passaram.**
- 27 testes unitários (vitest) ✅ · TypeScript limpo ✅ · Build de produção ✅.
- **Instalei o Java** (Temurin JRE 21) nesta máquina para rodar o emulador. Caminho: `C:\Program Files\Eclipse Adoptium\jre-21.0.11.10-hotspot\bin`.

### ⚠️ Observação de robustez encontrada (não é falha de segurança)
As regras de UPDATE de pedido do operador (`operatorCanUpdateOrder` → delivery+mesa) batem no limite do Firestore de **1000 expressões avaliadas por request**. Nos testes só apareceu em casos que já eram negados (resultado correto: negar), e todos os casos permitidos passaram. Risco baixo mas real: uma combinação rara de campos poderia bloquear uma operação legítima do operador. Dívida técnica: no futuro, simplificar essas regras ou mover parte da validação de pedido para uma API com Admin SDK. Não bloqueia a publicação.

### O que FALTA (ordem obrigatória: regras antes da UI)
1. Publicar `firestore.rules` no Firebase (afeta produção — mas é retrocompatível: dono e clientes não mudam).
2. Commitar + push da feature (deploy na Vercel).
3. Criar um operador de teste e validar o login real (o dono digita a senha — eu não digito senhas).

### Consolidação feita (2026-07-20)
A tela "Permissões do PDV" era órfã (editava `store_profiles.pdvPermissions`, que o PDV não lê mais desde o login de operador: dono vê tudo via `getPdvPermissions({})`, operador usa `roles_operador`). **Removida** (componente + item de menu). A senha da Retaguarda virou `AdminPasswordSection` e foi para dentro de **Usuários** (menu renomeado "Usuários e acesso"). Commit `9c9397f`, no ar e verificado. Textos em linguagem de dono de loja.

### Registro de vendas por funcionário (auditoria) — ETAPA 1 FEITA (2026-07-20, commit cdad1b3)
Todo `cash_transaction` (venda, sangria, suprimento, abertura, fechamento, cancelamento) agora grava `criadoPorUid` (uid) + `usuario` (nome). Como todas as vendas passam pelo `registrarLancamento` do useCaixa, um ponto cobre todos os canais. `PdvAccessContext` expõe `actorName`. Regras: `canceledByUid` no hasOnly do cancelamento. Publicado e validado em produção (suprimento de teste na conta teste gravou criadoPorUid = uid do dono, confere). Vale das vendas NOVAS em diante.
**FALTA a ETAPA 2:** tela de consulta/relatório por funcionário ("hoje o Fulano vendeu R$ X em N pedidos", quem cancelou o quê). O dono topou; começar quando ele pedir.

### ⚠️ Ponto de design a decidir (o dono levantou, ainda não resolvido)
O dono propôs: **Retaguarda = sistema completo (operar caixa/delivery/mesa SEM trava) + back-office; PDV = versão restrita**. A implementação atual do Codex NÃO traz as abas operacionais completas para a Retaguarda — o operador na Retaguarda só vê catálogo em leitura. Ou seja: o modelo implementado é "operador opera no PDV (limitado) e consulta na Retaguarda", não "dono opera tudo pela Retaguarda". **Decidir se o modelo do Codex já atende ou se ainda quer trazer as operações completas para a Retaguarda.**

### Decisões do plano (§11) que o Codex já resolveu na implementação — o dono deve confirmar
- Sensível = owner-only: dashboard/faturamento, clientes, campanhas, WhatsApp, freelance, perfil, permissões, usuários. Operador NÃO vê.
- Conta da Casa (venda a prazo) e "ver caixas anteriores" = owner-only por ora (dependem de listar a base de clientes / histórico agregado).
- Senha inicial = link por e-mail (não senha definida pelo dono).

---

## 3. WhatsApp não dispara — 🔴 DIAGNOSTICADO, ação do dono

Detalhe completo na memória `wapi-instancia-token-troca.md`. Resumo:

- **NÃO é o código.** As duas lojas ativas pararam em **17/07**; os deploys vieram depois (18–19/07).
- **Lima Limão**: a instância própria venceu; foi apontada para a instância da Arte do Sabor, mas **o token não foi atualizado** (as duas lojas têm a mesma instância `LITE-JMDANG-I3824S` com tokens diferentes salvos — só um vale). Aparece "conectada" mas todo envio é recusado.
- **Gostinho de Céu**: instância desconectada (`pending_qr`) — precisa reler o QR.

### Ação do dono (pela tela WhatsApp da Retaguarda, sem código)
- Gostinho: reler QR para reconectar.
- Lima: reconectar (salva o token certo) OU dar uma instância própria a ela.

### Decisão do dono
Compartilhar a instância da Arte do Sabor com a Lima **não é limpo**: as mensagens da Lima sairão do número da Arte, e uma instância só tem um webhook. O ideal é instância própria para a Lima. **Decidir: compartilhar (corrigir token) ou instância própria.**

> Eu me ofereci para copiar o token válido via acesso admin, mas avisei que não resolve o número de saída. Aguardando o dono.

---

## 4. Estado do código (git)

- Branch: `main`, último commit `dee1604`. Local e `origin/main` **alinhados**.
- **Working tree limpo.** Ficam de fora, de propósito, só dois arquivos: `claude-auto.sh` (reescrita do dono, em andamento) e `.claude/settings.local.json` (config de máquina).
- Os **30 arquivos pendentes** que esta seção listava eram a feature de usuários. **Foram publicados** em `4e51258` (20/07) e estão versionados — conferido arquivo por arquivo (`PdvAccessContext.tsx`, `user-permissions.ts`, `api/usuarios/route.ts`, `UsuariosTab.tsx`, `OperatorCatalogReadOnly.tsx`, `wapi/operator-access.ts`, `scripts/firestore-rules.test.mjs`).
- **O repositório é PÚBLICO** (`Danieladmsf/pagina-de-pedido`). Segredo nenhum é versionado: `.env*`, service account do Firebase e `qz/private-key.pem` estão no `.gitignore`. O `qz/digital-certificate.txt` é rastreado de propósito — é o certificado **público**, que precisa ser distribuído.

### O que entrou desde o `9bed103` (29 commits, 20–25/07)

| quando | o quê |
|---|---|
| 20/07 | Login de operador publicado (`4e51258`), UI de Usuários (`cb2c6f8`), Permissões do PDV consolidada dentro de Usuários (`9c9397f`), carimbo de quem fez cada lançamento (`cdad1b3`) |
| 21–22/07 | Coluna "Quem fez" no caixa, **venda por peso (kg)** no PDV, alerta de pedido novo também na Retaguarda + 1 via por job |
| 23/07 | Bloco grande de **Encomendas**: bolo por kg, doces por cento, catálogo editável, acompanhamento do cliente, tema da loja, Pix na cobrança |
| 24/07 | Encomendas (brigadeiros de 50 em 50, sobra proporcional), **frete editável** no pedido, limpeza da raiz do repo |
| 24–25/07 | **Consolidação da impressão de cupom** — ver §5 |

---

## 5. Impressão de cupom — ✅ CONSOLIDADA (24–25/07)

Existiam **três geradores de cupom independentes** (pedido, caixa, encomenda), cada um com sua cópia do CSS térmico, do tamanho de papel e do fallback de impressão. Tinham divergido: o cupom de encomenda não declarava `@page`, então sem o QZ Tray o navegador imprimia em folha A4.

Hoje são quatro módulos no mesmo formato (`build*Html` monta, `print*` imprime):

- `src/lib/receipt-print.ts` — a base: papel, CSS térmico, documento, `brl()`, `printReceipt` (**único** ponto de entrada de impressão), `resolvePrintMode`, `claimAutoPrint`
- `src/lib/order-receipt-html.ts` · `src/lib/caixa-receipt.ts` · `src/lib/encomendas/receipt.ts`

**O QZ Tray continua sendo o caminho principal** — o navegador só entra quando ele não responde. Nada mudou na impressão silenciosa.

### A pegadinha que mais custa tempo aqui
O QZ **ignora `@media print` e `@page`**: com `format:'html'` ele renderiza como TELA e rasteriza na largura do config. Só o fallback do navegador lê essas regras. Logo, **a medida do cupom (largura e padding) tem que morar no `body`** — o bloco de impressão só pode repetir a mesma medida. Havia exatamente essa contradição, e por isso ajuste no `@media print` não surtia efeito na impressora de verdade.

### Também resolvido no caminho
- `manualPrint` (legado) × `printMode`: dois campos decidiam a mesma coisa, e no mesmo `useEffect` o som lia um e a impressão lia o outro. Fonte única agora é `resolvePrintMode`; o perfil não grava mais o espelho.
- PDV e Retaguarda abertos em duas abas do mesmo PC imprimiam o pedido **duas vezes** — `claimAutoPrint` reserva por máquina.
- Dinheiro padronizado em `R$ 1.500,00` nos três (pedido e caixa saíam com ponto decimal).

61 testes cobrindo isso em `src/lib/receipt-print.test.ts` e `src/lib/caixa-receipt.test.ts`. Detalhe completo na memória `qz-tray-silent-printing.md`.

---

## 6. Como retomar (para a próxima sessão / próximo agente)

1. Ler este arquivo + a memória do projeto (MEMORY.md).
2. Confirmar com o dono as duas decisões abertas: (a) modelo da Retaguarda para usuários (§2); (b) WhatsApp compartilhar vs instância própria (§3).
3. Se liberado a publicar usuários: rodar o teste de regras (`node scripts/firestore-rules.test.mjs` via emulador — precisa do Java já instalado) → publicar rules → commit/push → criar operador teste.
4. WhatsApp: orientar o dono a reconectar pela tela; só mexer via admin se ele pedir.

### Comando do teste de regras (já funciona nesta máquina)
```
export PATH="/c/Program Files/Eclipse Adoptium/jre-21.0.11.10-hotspot/bin:$PATH"
npx --yes firebase-tools@13.35.1 emulators:exec --only firestore --project demo-cardapio-rules "node scripts/firestore-rules.test.mjs"
```
