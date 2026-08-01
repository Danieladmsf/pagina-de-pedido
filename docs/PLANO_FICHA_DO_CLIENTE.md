# Plano — Ficha do cliente (o histórico de compras que só o Prazo tem hoje)

> **Status:** desenho, não implementado.
> **Criado em:** 01/08/2026
> **Origem:** o dono, olhando a tela do Prazo: *"a página do prazo está bem completa e detalhada. Poderia, ao clicar no card do cliente, abrir a mesma página, porém dedicada às compras com outras formas de pagamento, com registro completo."*

---

## 1. O problema

Hoje o cliente tem **duas portas de tamanhos muito diferentes**:

| Porta | O que abre | Para quem |
|---|---|---|
| Clique no card (`ClientesTab:1178`) | Modal com celular, nascimento, endereço e **três contadores**: `totalPedidos`, `ticketMedio`, `ultimoPedido` | todos |
| Ícone 💲 | **PrazoPage** — extrato lançamento a lançamento, saldo, KPIs, filtros, busca, CSV, impressão, envio no WhatsApp | só quem tem Prazo |

Ou seja: **quem compra fiado tem prontuário; quem paga no pix tem três números.** E os três números são contadores derivados — a mesma categoria de dado que já mentiu no badge do limite hoje.

O que não existe em lugar nenhum: **o que o cliente comprou, quando e como pagou.**

---

## 2. A proposta

A mesma página, com dois modos — e o clique no card passa a abrir a ficha, não o modal:

```
Ficha do cliente
├── Compras   ← novo, e o padrão ao clicar no card
└── Prazo     ← a PrazoPage de hoje, aparece só se o cliente tem fiado
```

O ícone 💲 continua existindo e vai direto para a aba Prazo, sem passo a mais para quem cobra fiado todo dia.

**Aba Compras**, com a mesma anatomia que já funciona no Prazo:

- **KPIs:** total gasto, nº de compras, ticket médio, primeira e última compra, **forma de pagamento mais usada** e **canal mais usado** (balcão, mesa, delivery, encomenda).
- **Lista cronológica** de compras, cada linha expansível mostrando os itens (o mesmo componente do extrato), com data, canal, forma de pagamento e total.
- **Filtros:** período (30/90/12 meses/tudo), forma de pagamento e canal.
- **Busca** por item ou nº do pedido — achar "quando ele levou aquela torta" é o caso de uso real.
- **Exportar** CSV de compras e CSV de itens, e **imprimir** — mesmos arquivos já existentes.

---

## 3. O que reaproveita (e é bastante)

| Já existe | Onde |
|---|---|
| Carregar os pedidos do cliente (telefone + resgate por id + encomendas) | `PrazoPage` — foi o que consertei em 31/07 |
| Ler encomenda como pedido | `lib/encomendas/pedido.ts` |
| Linha expansível com itens, adicionais e observações | `PrazoPage` |
| CSV de itens comprados | `buildItemsCsv` (`lib/prazo-statement.ts`) — já é quase a exportação desta aba |
| Layout de KPI, filtros de período, busca, impressão | `PrazoPage` |

**O que é novo:** um agregador puro `resumoDeCompras(pedidos)` → total, contagem, ticket, primeira/última, quebra por forma de pagamento, por canal e itens mais comprados. Puro e testável, como o `statementTotals` do Prazo.

**O que NÃO reaproveita:** `buildStatement` e `matchOrderForTransaction` são do extrato (débito/crédito). A aba Compras lê os **pedidos direto**, sem passar por lançamento.

---

## 4. A verdade que a tela precisa dizer

O histórico é **as compras que conseguimos ligar a este cliente** — não necessariamente todas.

A auditoria de 31/07 mediu: **795 pedidos ligados ao cliente por nome** e **673 por telefone**; `clienteId` só existe nos pedidos novos. Uma compra feita com o telefone digitado errado não aparece aqui, e fingir o contrário seria pior que não ter a tela.

Então a ficha diz, em texto pequeno e honesto: *"12 compras encontradas para este cliente (telefone e cadastro)"* — e, quando o cliente tem pedidos ligados só por telefone, isso fica visível. **A ficha vira, de quebra, o melhor lugar para perceber vínculo faltando** — é a mesma informação que a tela de conflitos da Fase 1 vai usar.

**O que ela NÃO faz:** usar `totalPedidos`/`ticketMedio` do cadastro como fonte. São contadores derivados que dessincronizam — os números saem das compras efetivamente carregadas. Se divergirem do contador, quem manda é o que foi contado (mesma regra do extrato × `creditBalance`).

---

## 5. Onde mexe

- **Novo:** `src/lib/clientes/resumo-compras.ts` (+ testes) — o agregador puro.
- **Novo:** `src/components/admin/FichaClientePage.tsx` — a casca com as duas abas; a aba Prazo renderiza a `PrazoPage` que já existe, sem reescrevê-la.
- **`ClientesTab`:** o clique no card abre a ficha; o modal "Ver Detalhes" atual vira a seção de cadastro dentro dela (ou some, se ficar redundante).
- **`PrazoPage`:** ganha uma prop para não repetir o cabeçalho do cliente quando estiver dentro da ficha. Nada de lógica muda.

**Custo de dados: zero a mais.** A consulta de pedidos por telefone já é feita hoje pela PrazoPage; a ficha usa a mesma.

---

## 6. Riscos

| Risco | Defesa |
|---|---|
| Virar "mais uma tela" que ninguém abre | Ela substitui o clique no card, que hoje entrega pouco — não é um destino novo a descobrir |
| Prometer histórico completo e mostrar parcial | A contagem e a origem do vínculo ficam escritas na tela (§4) |
| Mexer na PrazoPage e quebrar o fiado | A PrazoPage entra **inteira**, como está; só ganha uma prop de cabeçalho |
| Loja com muitos pedidos | Mesma consulta de hoje, já filtrada por telefone do cliente |

---

## 7. Resumo em uma linha

O prontuário que hoje só existe para quem compra fiado passa a existir para todo cliente — mesma página, mesma anatomia, aba própria para as compras à vista, e honesta sobre quantas compras conseguiu ligar.
