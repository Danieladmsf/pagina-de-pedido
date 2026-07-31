# Plano — Integridade dos dados (vínculos por id, identidade do cliente e exclusões)

> **Status:** planejamento. A primeira fatia já entrou (`d2c23c1`, 31/07/2026): venda do caixa passou a gravar `orderId`/`encomendaId`.
> **Criado em:** 31/07/2026
> **Origem:** auditoria medida em produção em 31/07/2026 (números no §2) — nasceu de uma compra do Prazo que não abria porque o telefone tinha sido gravado como `(16)992156780`.
> **Relação com outros planos:** `docs/PLANO_USUARIOS_PERMISSOES.md` (Fase 7) trata de **quem pode ver o dado**. Este plano trata de **se o dado aponta para o lugar certo**. São independentes e podem andar em paralelo.

---

## 1. Objetivo

Que todo vínculo entre registros seja por **id**, não por texto; que o cliente tenha uma **chave única confiável**; e que apagar alguma coisa não deixe **referência morta**.

Com duas restrições que valem mais que a velocidade:

- **Nada de reescrever histórico.** Dado antigo continua sendo lido pelo caminho antigo.
- **Nada de quebrar o que funciona.** Cada fase entra sozinha, verificável em produção, e pode voltar atrás.

---

## 2. O retrato de hoje (medido em 31/07/2026, não estimado)

| Esfera | Como o vínculo é feito | Situação |
|---|---|---|
| Venda do caixa → pedido | `orderId`/`encomendaId` (novos) · prefixo `#abcde` do título (antigos) | **205 de 1.361** lançamentos antigos sem id nenhum: 192 Mesa, 4 encomenda, 9 venda manual |
| Compra a prazo → pedido | `orderId` desde 28/07 · `encomendaId` desde 31/07 · prefixo na descrição (antigos) | 45 de 51 débitos dependem do prefixo |
| Pedido → cliente | **Telefone**, como texto | 3 pedidos têm **nome** no campo telefone ("LARA", "Cidinha"); 10 formatos diferentes de número na base |
| Cliente sem telefone | **Nome** (`where('nome','==')`) | Homônimos viram um cliente só — furo ativo |
| Id do pedido | Firestore (20 chars) desde 31/07 | 696 pedidos antigos com id curto de `Math.random()` (8 chars) |
| Promoção → produto | `items[].menuItemId` | 13 referências, **todas vivas** hoje |
| Prefixo de 5 chars | comparação por `startsWith` | **0 colisões** em 1.405 pedidos — mas o pool cresce |

---

## 3. Os cinco princípios que impedem a quebra

1. **Id novo entra ao lado do texto, nunca no lugar.** A leitura tenta id primeiro e cai no texto como reserva. Foi assim que a Fase 1 entrou sem tocar em 1.361 lançamentos.
2. **Migração não reescreve o que o humano digitou.** Só se repara quando a origem é inequívoca (ex.: `createdAt` a partir de `orderDateTime`). Telefone digitado errado é conflito para o dono resolver, não para o script adivinhar.
3. **Escrita nova passa por um ponto único.** Se uma regra precisa ser repetida em quatro abas, ela está no lugar errado (`lib/`, não no componente).
4. **Contrato compartilhado tem um tipo só.** O tipo de `registrarLancamento` estava copiado à mão em 6 abas e o campo novo era descartado em silêncio onde ninguém repetia. Centralizar foi o que fez o `tsc` apontar os erros.
5. **Fase só termina com verificação em produção**, com dado real — teste verde não é prova de que a tela funciona (o bug da corrida de efeitos passou por 28 testes).

---

## 4. Fase 0 — Mapa de integridade (só leitura, 1 script)

**Entrega:** `scripts/auditoria-integridade.mjs` — dry-run por padrão, roda contra todas as lojas e imprime um relatório por coleção.

O que mede:

- **Referências mortas:** promoção/combo → produto, pedido → itens do menu, lançamento → pedido, débito do Prazo → pedido/encomenda, caixa → sessão de caixa.
- **Órfãos:** `credit_transactions` de cliente que não existe mais; pedido sem `ownerId` válido; encomenda sem cliente.
- **Vínculos por texto ainda em uso:** quantos e de quais anos.
- **Identidade:** clientes com telefone repetido, telefone inválido (< 10 dígitos), nome duplicado sem telefone, pedido com telefone não numérico.
- **Divergências de saldo:** `creditBalance` do cadastro × soma do extrato (a regra é: **o extrato manda**).

**Por que é a Fase 0:** sem esse número, as fases seguintes viram opinião. Ele também vira o guardrail permanente da Fase 5.

**Risco:** nenhum (leitura). **Verificação:** rodar duas vezes e comparar — o relatório tem que ser estável.

---

## 5. Fase 1 — Identidade do cliente (o furo que vira dinheiro errado)

O telefone é a única chave entre pedido, cadastro, Prazo e campanhas. Hoje ele é campo livre e, quando falta, o app casa **pelo nome**.

**1.1 — Normalizar na escrita, em todos os pontos.**
Já feito no PDV (`NovoPedidoTab`), na Mesa (`MesasTab`) e no cardápio público (`CartDrawer`, que já normalizava). Falta varrer: cadastro rápido, import de CSV, edição na aba Clientes, encomendas (já normaliza) e qualquer rota de API que aceite telefone. **Um helper único** (`normalizeCreditPhone`), nunca `replace` solto.

**1.2 — Validar na entrada, com máscara.**
O campo do PDV aceita qualquer texto. Passa a ter máscara e a recusar o que não for telefone — com uma saída explícita para venda anônima ("sem cliente"), que é um caso legítimo e não pode ser bloqueado.

**1.3 — Acabar com o casamento por nome.**
`syncCustomerFromOrder` deixa de fazer `where('nome','==',nome)`. Sem telefone válido, o cliente vira id determinístico (`{ownerId}_n_{slug}`) e é **marcado como não identificado** — não se funde com ninguém.

**1.4 — Tela de conflitos (Retaguarda → Clientes).**
Lista o que a Fase 0 achou: telefone repetido, telefone inválido, homônimos sem telefone, saldo divergente do extrato. Cada linha com uma ação: unificar, corrigir, ignorar. **O dono decide; o script não funde nada sozinho** — foi fusão automática que já apagou R$ 77 de dívida real uma vez.

**O que pode quebrar:** venda rápida sem cliente (se a validação for rígida demais) e o Prazo (que exige telefone). Mitigação: a venda anônima continua num clique; o Prazo já exige celular desde `e4aa76c`.

**Verificação:** vender no PDV sem cliente, com cliente novo e com cliente existente digitado em três formatos diferentes — os três têm que cair no mesmo cadastro.

---

## 6. Fase 2 — Fechar os vínculos que ainda dependem de texto

**2.1 — Encomenda no caixa.** O lançamento já grava `encomendaId`; falta o `CaixaTab` carregar a coleção `encomendas` (só quando a loja for confeitaria) e abrir a linha usando `encomendaComoPedido`, que já existe e está testado.

**2.2 — Acerto de Prazo antigo.** As 4 linhas antigas casam o cliente **pelo nome escrito no título**. Passam a exibir "sem vínculo" em vez de adivinhar — melhor não mostrar do que apontar o cliente errado (é a mesma regra já aplicada ao pagamento que não é encontrado).

**2.3 — Aposentar o prefixo como fonte primária.** O prefixo de 5 chars continua valendo para o histórico, mas com um corte: **só casa com pedido criado ANTES do lançamento**. Isso elimina o furo de um lançamento de 2026 abrir um pedido de 2027 que por acaso começa igual — sem tocar em dado nenhum, só na comparação.

**Risco:** baixo, tudo em leitura. **Verificação:** as linhas antigas que abriam continuam abrindo; as de encomenda passam a abrir; nenhuma linha nova deixa de abrir.

---

## 7. Fase 3 — Exclusões e referências mortas

A auditoria de exclusões mapeou 11 pontos; dois seguem abertos e são os que doem:

**3.1 — Excluir produto** deixa referência morta em promoção/combo. Passa a **verificar antes** ("este produto está em 2 promoções") e oferecer remover das promoções junto. Hoje há 0 refs mortas — é hora de fechar, enquanto está limpo.

**3.2 — Excluir cliente** não leva a dívida junto: a subcoleção `credit_transactions` fica, e um recadastro com o mesmo telefone **ressuscita o saldo**. Regra nova: cliente com saldo ≠ 0 **não é excluído** — é arquivado (some das listas, mantém o extrato). Excluir de verdade só com saldo zerado e confirmação que diz o que será perdido.

**3.3 — Padrão para o resto.** Toda exclusão passa a responder duas perguntas antes de agir: *isto tem histórico?* (se tem, arquiva) e *alguém aponta para isto?* (se aponta, mostra quem).

**O que pode quebrar:** fluxos de limpeza que hoje excluem sem perguntar. Mitigação: arquivar é reversível; excluir não.

---

## 8. Fase 4 — Dados legados: o que dá e o que não dá

| Caso | Dá para reparar? | Decisão |
|---|---|---|
| `createdAt` ausente em pedidos do PDV | **Sim** — `orderDateTime` é inequívoco | Backfill com dry-run, por loja |
| 3 pedidos com nome no campo telefone | **Sim, manualmente** | Entra na tela de conflitos (§5.4) |
| 696 pedidos com id curto | Não precisa | Ficam. Ids não se reescrevem — quebraria todo vínculo que já existe |
| 205 lançamentos sem id | **Não** | "Mesa 4 - Finalizada" não guarda de qual comanda veio. A tela passa a dizer *"venda antiga, sem vínculo"* em vez de só não abrir |
| 45 débitos por prefixo | Parcial | Onde o prefixo casa com **um** pedido só, grava o `orderId` de verdade (dry-run + revisão) |

---

## 9. Fase 5 — Guardrails permanentes

1. **`npm run audit:integridade`** — o script da Fase 0 com saída de código: **falha** se aparecer referência morta nova. Roda no CI e pode rodar semanalmente.
2. **Testes de contrato** para cada regra de vínculo (já existem 13 no agrupamento do caixa e 5 na leitura de encomenda; faltam os do cliente).
3. **Regras do Firestore** exigindo os campos de vínculo nas escritas novas. **Cuidado que vale a pena escrever:** exigir campo em regra **quebra clientes com bundle antigo em cache** — o PDV roda o dia inteiro sem recarregar. Só depois de a versão nova estar em todas as lojas, e com o `PWARegister` forçando atualização.
4. **Convenção no `CLAUDE.md`:** vínculo entre coleções é sempre por id; texto é para humano ler.

---

## 10. Ordem, risco e volta atrás

| Fase | Risco | O que pode quebrar | Como voltar |
|---|---|---|---|
| 0 — Mapa | nenhum | — | — |
| 1 — Identidade do cliente | **alto** (mexe em venda) | venda rápida, Prazo, sincronização de cliente | reverter o commit; nada é reescrito no banco |
| 2 — Vínculos restantes | baixo | expansão de linhas no caixa | reverter; é só leitura |
| 3 — Exclusões | médio | fluxos que excluem sem perguntar | arquivar é reversível |
| 4 — Legado | médio | dado antigo | dry-run obrigatório + backup do que for tocado |
| 5 — Guardrails | baixo/alto | o item 3 (regras) é o único capaz de travar venda | ativar por último, loja a loja |

**Ordem recomendada:** 0 → 1 → 2 → 5.1/5.2 → 3 → 4 → 5.3.
A Fase 1 vem antes porque é a única que ainda está **produzindo** dado ruim todo dia.

---

## 11. O que fica de fora deste plano

- **Fase 7 (usuários e permissões)** — plano próprio, `docs/PLANO_USUARIOS_PERMISSOES.md`.
- **Estoque, campanhas e W-API** — auditei estoque só de passagem (o modelo central está correto); os outros não foram auditados e não entram sem medição antes.

---

## 12. Decisões em aberto (responder antes da Fase 1)

1. **Telefone vira obrigatório no PDV?** Ou continua opcional, com a venda anônima explícita? (recomendo opcional + botão "sem cliente", para não atrasar o balcão)
2. **Cliente com saldo pode ser excluído?** (recomendo: não — arquiva)
3. **O `audit:integridade` roda sozinho** (semanal) ou só sob demanda?
4. **Os 45 débitos por prefixo:** gravar `orderId` de verdade neles, ou deixar como estão? (funciona hoje; é higiene, não urgência)

---

## 13. Resumo em uma linha

Trocar todo vínculo por texto por vínculo por id, começando pela identidade do cliente — que é a única que ainda está estragando dado novo —, sem reescrever histórico e com uma verificação automática que impede a volta do problema.
