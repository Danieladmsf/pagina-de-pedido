# Plano de implementação — venda por unidade e por peso

Data da análise: 15/07/2026

## 1. Objetivo

Adicionar ao cadastro de produtos dois modos de venda:

- **Por unidade**: comportamento atual e padrão. O preço é cobrado por unidade e a quantidade é inteira.
- **Por peso**: o preço cadastrado passa a representar o valor de 1 kg. Ao selecionar o produto, o usuário informa o peso e o sistema calcula o valor proporcional.

A nova lógica deve funcionar, sem divergência de valores, em todos os pontos que criam, editam, exibem ou reaproveitam pedidos:

- cardápio público — delivery, retirada/balcão e consumo no local;
- vitrines públicas de ofertas, promoções e combos;
- PDV — balcão/retirada e delivery interno;
- mesas/comandas;
- edição de pedidos em delivery;
- pedidos novamente pelo cliente;
- encomendas vinculadas a produtos do cardápio;
- promoções, estoque, caixa, fechamento, relatórios, histórico de clientes;
- impressão de produção e do cliente;
- mensagens de WhatsApp.

Este documento é apenas o plano. Nenhuma regra de venda por peso foi implementada nesta etapa.

## 2. Resumo executivo da solução recomendada

1. Incluir em cada produto o campo `saleMode`, com os valores `unit` ou `weight`.
2. Interpretar produtos antigos sem esse campo como `unit`. Assim não é necessária uma migração destrutiva.
3. Manter o campo `price` existente:
   - em produto `unit`, `price` significa R$/unidade;
   - em produto `weight`, `price` significa R$/kg.
4. Usar o modal compartilhado `MenuItemDialog` como ponto único de seleção. Para produto por peso, ele exibirá um campo de peso e o total calculado em tempo real. Isso leva a mesma regra ao cardápio, PDV, mesas e edição de delivery.
5. Guardar o peso informado como inteiro em `weightGrams`, evitando erros de ponto flutuante. Manter também `quantity = weightGrams / 1000` para compatibilidade com os cálculos antigos baseados em `unitPrice * quantity`.
6. Gravar `saleMode`, `weightGrams`, `unitPrice` e `lineTotal` dentro de cada item do pedido. `lineTotal` será o total final arredondado daquela linha.
7. Centralizar cálculo, arredondamento, formatação e serialização em um único módulo. Hoje essas regras estão repetidas em vários arquivos.
8. Adaptar estoque para aceitar quantidade fracionada em kg, sempre normalizada para três casas decimais.
9. Atualizar todos os leitores de pedido para preferirem `lineTotal`, com fallback para a fórmula antiga. Pedidos históricos continuarão funcionando.
10. Impedir, na primeira versão, que um produto por peso seja componente de combo. O formato atual de combo não informa quantos gramas de cada componente são consumidos.

## 3. Diagnóstico do código atual

### 3.1 Cadastro de produto

O cadastro está em `src/components/admin/ProductModal.tsx` e hoje grava:

- `name`;
- `price`;
- `stockQuantity`;
- categoria, imagem, descrição e adicionais;
- campos de marmita.

Não há informação sobre a unidade comercial. O preço é sempre exibido como “Preço (R$)” e o estoque é convertido com `parseInt`, o que elimina casas decimais.

A listagem e a edição rápida ficam em `src/app/(sistema)/gestao/page.tsx`. Nessa tela:

- todo preço é mostrado como valor unitário;
- todo estoque é mostrado como unidade;
- a edição rápida altera apenas `price`;
- a duplicação copia todos os campos do produto, o que será compatível com `saleMode` quando ele existir.

### 3.2 Dois formatos de carrinho

O projeto possui dois formatos relacionados, mas diferentes:

- Cardápio público: `CartProvider`, em `src/components/providers/CartProvider.tsx`, usa `CartItem`, `quantity` e `customization.addons`.
- Canais internos: PDV, mesas e edição de delivery guardam arrays locais com `quantity`, `addons`, `notes` e `unitPrice` no nível da linha.

`src/lib/cart.ts` já centraliza parte da inclusão de itens internos, mas ainda assume que toda inclusão simples equivale a `+1` unidade.

Sem uma camada central de medição e preço, a venda por peso poderia funcionar em um canal e calcular diferente em outro.

### 3.3 Seleção de produto

`src/components/menu/MenuItemDialog.tsx` já é reutilizado por:

- cardápio público;
- `NovoPedidoTab`;
- `MesasTab`;
- edição de itens em `DeliveryTab`.

Atualmente o modal:

- controla `quantity` como inteiro, começando em 1;
- usa botões `-` e `+`;
- calcula `(preço do produto + adicionais) * quantidade`;
- fecha após adicionar.

Produtos sem adicionais podem ignorar o modal e entrar diretamente no carrinho. Produtos por peso nunca poderão usar esse atalho; precisam abrir o modal mesmo sem adicionais.

### 3.4 Criação e edição de pedidos

Há quatro caminhos principais:

| Caminho | Arquivo | Situação atual |
|---|---|---|
| Cardápio público | `src/components/cart/CartDrawer.tsx` | Revalida preço do catálogo e grava o pedido diretamente no Firestore. |
| Balcão/delivery no PDV | `src/components/admin/NovoPedidoTab.tsx` | Sanitiza itens, finaliza pagamento, grava pedido e estoque. |
| Mesas | `src/components/admin/MesasTab.tsx` | Cria/atualiza comanda e reconcilia o delta de estoque. |
| Edição de delivery | `src/components/admin/DeliveryTab.tsx` | Edita os itens e recalcula subtotal, total e estoque. |

Todos multiplicam `unitPrice * quantity`. Os sanitizadores são repetidos e atualmente descartariam qualquer campo novo de peso se não forem alterados.

### 3.5 Estoque

`src/lib/inventory.ts` centraliza a reconciliação e é uma boa base, mas considera `quantity` como número de unidades. A interface e as mensagens falam explicitamente em “unidades”.

Outros pontos também assumem estoque inteiro:

- `ProductModal` usa `parseInt`;
- a edição rápida de estoque em Gestão usa `parseInt`;
- o modal e o carrinho público comparam quantidades inteiras;
- combos expandem a quantidade do combo em uma unidade de cada componente.

Para peso, `stockQuantity` deve representar kg e aceitar até três casas decimais. Todo delta precisa ser normalizado para evitar resíduos como `0.30000000000000004`.

### 3.6 Leitores e saídas de pedido

Existem vários lugares que exibem `quantity` como “x” ou recalculam o total:

- `src/lib/order-receipt-html.ts`;
- `src/app/(sistema)/pdv/page.tsx`, inclusive a mensagem de WhatsApp;
- `src/app/my-orders/page.tsx`;
- `src/components/admin/DeliveryTab.tsx`;
- `src/components/admin/MesasTab.tsx`;
- `src/components/admin/NovoPedidoTab.tsx`;
- `src/components/admin/fechamento/FechamentoModal.tsx`;
- `src/components/admin/ClientesTab.tsx`;
- `src/components/admin/DashboardTab.tsx`;
- `src/components/caixa/CaixaTab.tsx`.

Sem adaptação, 350 g apareceriam como `0.35x`, e alguns totais ou contadores de itens ficariam semanticamente incorretos.

Também existem vitrines secundárias que exibem preço sem criar o carrinho diretamente:

- `src/components/menu/ShowcasePageClient.tsx`;
- `src/components/menu/MenuVitrine.tsx`.

Elas precisam receber a mesma formatação de R$/kg; caso contrário, a página principal mostraria “/kg”, mas as páginas de ofertas e combos poderiam apresentar o mesmo valor como se fosse preço unitário.

### 3.7 Promoções e combos

As promoções em `src/components/admin/PromotionsTab.tsx` e `src/hooks/usePromotions.ts` substituem `price` por `promoPrice`. A matemática percentual já pode funcionar para kg, mas a interface precisa mostrar “R$/kg”.

Os combos em `src/components/admin/ComboModal.tsx` armazenam apenas `itemId`, nome e preço. Não há peso do componente. Se um produto por peso entrar em um combo, o estoque atual descontaria “1”, sem saber se isso significa 1 unidade ou 1 kg.

### 3.8 Encomendas

O módulo de encomendas possui motor próprio em:

- `src/lib/encomendas/catalog.ts`;
- `src/components/encomendas/EncomendaCatalogEditor.tsx`;
- `src/components/encomendas/EncomendaWizard.tsx`;
- `src/lib/encomendas/types.ts`;
- `src/lib/encomendas/receipt.ts`.

Ele pode vincular SKUs aos produtos de `menuItems`, mas hoje copia somente nome, preço e foto e sempre usa quantidade inteira. Um produto por peso vinculado seria cobrado como se seu preço por kg fosse preço por unidade. Esse fluxo precisa ser adaptado ou, temporariamente, impedir o vínculo de itens por peso. Como o objetivo é cobrir todos os canais, a recomendação é adaptá-lo antes da liberação geral.

### 3.9 Segurança do preço

O cardápio público compara o carrinho com os produtos carregados no navegador antes de gravar o pedido. Isso evita erros comuns de estado desatualizado, mas não é validação autoritativa: um cliente tecnicamente pode alterar o JavaScript ou o payload.

As regras em `firestore.rules` permitem que o cliente autenticado anonimamente crie seu próprio pedido, mas não recalculam preço, peso ou total a partir do catálogo. Essa é uma fragilidade existente e fica mais importante quando o cliente passa a enviar peso fracionado.

Para uma implantação resistente a manipulação, a criação de pedido público deve ser validada no servidor.

## 4. Contrato funcional recomendado

### 4.1 Produto por unidade

- Cadastro padrão para produto novo.
- Produto antigo sem `saleMode` continua sendo considerado `unit`.
- `price` é o preço de uma unidade.
- `quantity` deve ser inteiro maior que zero.
- Estoque, quando ativo, é contado em unidades inteiras.
- Fluxos e botões atuais de `-` e `+` permanecem.

### 4.2 Produto por peso

- `saleMode = 'weight'`.
- `price` é sempre o preço de 1 kg.
- Cards e telas administrativas mostram `R$ 00,00/kg`.
- Ao selecionar o produto, abre o modal com campo “Peso”.
- A entrada principal é em gramas, porque é a leitura mais comum em balanças e evita digitação de vírgula em celular.
- O sistema também mostra a conversão, por exemplo: `350 g (0,350 kg)`.
- Precisão inicial: 1 g.
- Peso deve ser inteiro, maior que zero e, quando houver estoque, menor ou igual ao disponível.
- O total deve atualizar a cada alteração válida.
- No carrinho, botões `-1/+1` são substituídos por “Editar peso” e “Remover”.
- Cada pesagem entra como linha separada. Isso preserva a pesagem e o arredondamento de cada pacote.

### 4.3 Fórmula e arredondamento

Exemplo:

```text
preço por kg = R$ 39,90
peso = 350 g
quantidade em kg = 350 / 1000 = 0,350
total bruto = 39,90 × 0,350 = 13,965
total cobrado = R$ 13,97
```

Regra:

```text
effectiveRate = preço oficial ou promocional + adicionais cobrados por kg
quantityKg = weightGrams / 1000
lineTotal = arredondarEmCentavos(effectiveRate × quantityKg)
orderSubtotal = soma de lineTotal de todas as linhas
```

O arredondamento deve ocorrer por linha. Nunca usar apenas `toFixed` como parte da matemática; `toFixed` deve ficar restrito à apresentação.

### 4.4 Adicionais em produto por peso

Decisão recomendada para a primeira versão:

- adicional vinculado a produto por peso também representa um valor por kg;
- no modal e no cadastro, a interface deve indicar `+ R$ X,XX/kg`;
- o adicional entra em `effectiveRate` antes da multiplicação pelo peso.

Isso preserva o comportamento matemático atual de `(produto + adicionais) × quantidade`. Se o negócio precisar cobrar um adicional fixo por embalagem, será necessário acrescentar posteriormente um campo como `addonPricingMode: 'per_measure' | 'fixed_per_line'`. Não se deve misturar os dois comportamentos implicitamente.

### 4.5 Promoções

- `promoPrice` de produto por peso significa preço promocional por kg.
- Desconto percentual e desconto fixo continuam sendo calculados sobre o preço de 1 kg.
- Todas as etiquetas devem mostrar `/kg`.
- O checkout deve buscar a promoção ativa e recalcular a linha com o peso registrado.

### 4.6 Combos

Na primeira versão:

- um combo continua sendo vendido por unidade;
- produtos por peso não aparecem no seletor de componentes do combo;
- o sistema bloqueia a mudança de `unit` para `weight` se o produto estiver referenciado em um combo ativo, informando quais combos precisam ser ajustados.

Suporte futuro exigiria `componentWeightGrams` em cada componente do combo.

## 5. Modelo de dados proposto

### 5.1 Produto em `menuItems`

```ts
type SaleMode = 'unit' | 'weight';

interface MenuItem {
  // campos existentes
  price: number;
  stockQuantity?: number | null;

  // novo; ausente significa 'unit'
  saleMode?: SaleMode;
}
```

Semântica de `stockQuantity`:

- para `unit`: número inteiro de unidades;
- para `weight`: quantidade disponível em kg, normalizada para três casas decimais;
- `null`: estoque ilimitado, como hoje.

No código, nunca acessar diretamente essa semântica sem passar pelos helpers de medição.

### 5.2 Linha de carrinho e linha de pedido

```ts
interface SaleLine {
  id: string;
  name: string;
  saleMode: 'unit' | 'weight';

  // unidade: número de unidades; peso: kg equivalentes
  quantity: number;

  // obrigatório somente para peso e fonte da verdade da medição
  weightGrams?: number;

  // snapshot da tarifa efetiva: R$/un ou R$/kg
  unitPrice: number;

  // snapshot do total final da linha, arredondado em centavos
  lineTotal: number;

  addons: Array<{
    id?: string;
    name: string;
    price: number;
    group?: string;
  }>;
  notes?: string;
  isCombo?: boolean;
  comboItems?: unknown[] | null;
}
```

Para compatibilidade:

- pedidos antigos sem `saleMode` são `unit`;
- pedidos antigos sem `lineTotal` usam `unitPrice * quantity`;
- em item por peso, `quantity` é sempre derivado de `weightGrams`, nunca aceito como fonte independente;
- telas históricas usam os snapshots do pedido, não o preço atual do produto.

### 5.3 Exemplo de item por peso gravado

```json
{
  "id": "produto-123",
  "name": "Carne assada",
  "saleMode": "weight",
  "weightGrams": 350,
  "quantity": 0.35,
  "unitPrice": 39.9,
  "lineTotal": 13.97,
  "addons": [],
  "notes": ""
}
```

## 6. Centralização obrigatória da regra

Criar um módulo, por exemplo `src/lib/sales-measurement.ts`, com funções puras:

```ts
normalizeSaleMode(item)
isWeightedItem(item)
normalizeWeightGrams(value)
gramsToKg(grams)
normalizeStockAmount(value, saleMode)
calculateEffectiveRate(item, addons, promotion)
calculateSaleLine(input)
getSaleLineTotal(line)         // lineTotal ou fallback legado
getOrderSubtotal(items)
formatCatalogPrice(item)
formatSaleQuantity(line)       // "2 un." ou "350 g"
formatStock(item)
getCartDisplayCount(items)
serializeOrderLine(cartLine)
```

Regras desse módulo:

- aceitar `saleMode` ausente como `unit`;
- validar inteiros para unidade;
- validar gramas inteiros para peso;
- normalizar kg e estoque para três casas;
- arredondar dinheiro em centavos por linha;
- rejeitar `NaN`, infinito, zero e valores negativos;
- não confiar em `quantity` recebida para item por peso; derivá-la de `weightGrams`;
- preservar fallback de pedidos históricos.

`src/lib/cart.ts` deve usar esse módulo. Durante a transição, podem existir adaptadores para os dois formatos atuais de carrinho, mas não duas fórmulas diferentes.

## 7. Plano de implementação por etapa

### Etapa 1 — Tipos, helpers e compatibilidade

Arquivos principais:

- `src/lib/types.ts`;
- novo `src/lib/sales-measurement.ts`;
- `src/lib/cart.ts`.

Tarefas:

1. Adicionar `SaleMode` e os novos campos aos tipos.
2. Criar os helpers de cálculo, validação e formatação.
3. Fazer o fallback `saleMode ausente -> unit`.
4. Criar `serializeOrderLine` para substituir os três sanitizadores repetidos de PDV, mesas e delivery.
5. Criar `getSaleLineTotal` e `getOrderSubtotal` para eliminar multiplicações espalhadas.
6. Manter os formatos antigos legíveis durante toda a migração.

### Etapa 2 — Cadastro e gestão de produtos

Arquivos principais:

- `src/components/admin/ProductModal.tsx`;
- `src/app/(sistema)/gestao/page.tsx`.

Tarefas:

1. Incluir seletor “Venda por unidade / Venda por peso”.
2. Deixar “Por unidade” selecionado para produto novo.
3. Alterar dinamicamente o rótulo:
   - `Preço por unidade (R$)`;
   - `Preço por kg (R$/kg)`.
4. Alterar o estoque:
   - unidade: inteiro e rótulo `Estoque (un.)`;
   - peso: decimal em kg, passo `0,001` e rótulo `Estoque (kg)`.
5. Usar parser decimal compatível com vírgula brasileira; remover `parseInt` dos produtos por peso.
6. Ao trocar o modo de um produto com estoque preenchido, exigir confirmação e novo valor. Não reinterpretar silenciosamente “10 unidades” como “10 kg”.
7. Bloquear mudança para peso quando o produto estiver em combo.
8. Mostrar badge “Por unidade” ou “Por kg” na listagem.
9. Ajustar edição rápida para mostrar `Preço por kg` quando aplicável.
10. Garantir que duplicar produto copie `saleMode`.

### Etapa 3 — Modal único de seleção

Arquivo principal:

- `src/components/menu/MenuItemDialog.tsx`.

Tarefas:

1. Renomear conceitualmente `itemNeedsCustomization` para algo como `itemRequiresSelectionDialog`, incluindo:
   - adicionais;
   - grupos de adicionais;
   - produto por peso.
2. No modo por peso:
   - exibir preço por kg;
   - exibir campo numérico de gramas com teclado decimal/numérico em celular;
   - mostrar conversão para kg;
   - mostrar total em tempo real;
   - desabilitar “Adicionar” para peso vazio ou inválido;
   - verificar estoque antes de adicionar.
3. Remover o stepper de quantidade no modo por peso.
4. Manter o fluxo de adicionais, aplicando os preços por kg.
5. Aceitar modo de edição com peso inicial para editar uma linha do carrinho.
6. Gerar `cartItemId` único para cada pesagem.

O aproveitamento deste modal é essencial: os quatro canais principais já dependem dele, reduzindo a chance de cálculos diferentes.

### Etapa 4 — Cardápio público e checkout

Arquivos principais:

- `src/components/MenuPageClient.tsx`;
- `src/components/menu/ShowcasePageClient.tsx`;
- `src/components/menu/MenuVitrine.tsx`;
- `src/components/providers/CartProvider.tsx`;
- `src/components/cart/CartDrawer.tsx`;
- `src/app/my-orders/page.tsx`.

Tarefas:

1. Cards de produto por peso devem mostrar `R$ X/kg`.
2. Vitrines de ofertas, promoções e combos devem usar o mesmo formatador de preço por medida.
3. Clique ou botão de adicionar sempre abre o modal para peso.
4. Não usar controles rápidos `-1/+1` no card de produto por peso.
5. `CartProvider` não deve juntar automaticamente duas pesagens em uma linha.
6. `totalPrice` deve somar `getSaleLineTotal`.
7. O contador do carrinho não deve somar kg como se fossem itens. Regra sugerida:
   - somar quantidades dos produtos por unidade;
   - contar cada linha por peso como uma porção/pacote.
8. No carrinho, mostrar por exemplo:
   - `350 g × R$ 39,90/kg`;
   - `Total: R$ 13,97`.
9. Trocar `-` e `+` por “Editar peso” e “Remover”.
10. No checkout, buscar o produto oficial e:
   - confirmar que ele ainda é vendido por peso;
   - validar `weightGrams`;
   - recalcular `quantity` e `lineTotal`;
   - aplicar preço/promocional atual;
   - rejeitar linha criada com modo antigo depois de o cadastro mudar.
11. `Pedir novamente` deve reaproveitar o mesmo peso histórico, mas recalcular pelo preço atual e validar o estoque. Se o modo do produto mudou, pedir nova seleção.

### Etapa 5 — PDV balcão e delivery interno

Arquivo principal:

- `src/components/admin/NovoPedidoTab.tsx`.

Tarefas:

1. Produto por peso sempre abre o modal.
2. Carrinho interno mostra peso, tarifa por kg e total da linha.
3. Substituir controles de unidade por edição de peso.
4. Substituir `cartTotal` pela função central.
5. Persistir todos os campos novos através de `serializeOrderLine`.
6. Salvar e restaurar corretamente o rascunho `balcao_draft_order`.
7. Rascunhos antigos permanecem por unidade.
8. Fechamento, desconto, acréscimo, pagamento dividido e Conta da Casa recebem o subtotal já calculado; suas regras financeiras não precisam mudar.

### Etapa 6 — Mesas e comandas

Arquivo principal:

- `src/components/admin/MesasTab.tsx`.

Tarefas:

1. Aplicar o mesmo modal, visual e cálculo do PDV.
2. Persistir peso e `lineTotal` ao criar e ao salvar comanda.
3. Na comparação entre carrinho atual e original, calcular diferença de estoque por medição.
4. Para impressão somente de itens novos, não subtrair pesos como se fossem unidades por `cartItemId` genérico. Comparar linhas estáveis e calcular delta em gramas.
5. Ao reabrir mesa ou adicionar item pendente, item por peso deve exigir o modal; nunca inserir automaticamente “1 kg”.
6. Finalização e fechamento consomem o total central.

### Etapa 7 — Edição de pedidos de delivery

Arquivo principal:

- `src/components/admin/DeliveryTab.tsx`.

Tarefas:

1. Carregar campos de peso existentes no carrinho de edição.
2. Permitir editar peso de linha existente.
3. Produto por peso novo abre o modal.
4. Recalcular subtotal com `lineTotal`.
5. Serializar os campos novos sem descartá-los.
6. Reconciliar estoque pelo delta em kg.
7. Manter taxa de entrega separada; peso comercial do produto não altera automaticamente o frete.

### Etapa 8 — Estoque transacional

Arquivos principais:

- `src/lib/inventory.ts`;
- `src/components/menu/MenuItemDialog.tsx`;
- `src/components/cart/CartDrawer.tsx`;
- telas administrativas de carrinho.

Tarefas:

1. Ampliar `OrderLikeItem` com `saleMode` e `weightGrams`.
2. `getStockDemand` deve usar:
   - quantidade inteira para unidade;
   - `weightGrams / 1000` para peso.
3. Normalizar todas as operações de peso para três casas decimais.
4. Usar tolerância segura ao comparar estoque decimal.
5. Atualizar `stockDeductedItems` com a quantidade comercial reservada, documentando que o valor pode ser unidades ou kg conforme o produto.
6. Editar pedido aplica somente o delta.
7. Cancelar restaura exatamente a quantidade reservada.
8. Mensagens devem dizer `350 g disponíveis` ou `0,350 kg`, nunca “0.35 unidades”.
9. Combo com item por peso deve ser rejeitado antes de chegar a essa camada.

### Etapa 9 — Impressão, mensagens e histórico

Arquivos principais:

- `src/lib/order-receipt-html.ts`;
- `src/app/(sistema)/pdv/page.tsx`;
- `src/app/my-orders/page.tsx`;
- `src/components/admin/ClientesTab.tsx`;
- `src/components/admin/fechamento/FechamentoModal.tsx`;
- `src/components/caixa/CaixaTab.tsx`;
- `src/components/admin/DashboardTab.tsx`.

Tarefas:

1. Criar um formatador único de linha de pedido.
2. Cupom de cliente e cozinha mostram `350 g`, tarifa por kg e total.
3. WhatsApp usa o mesmo formato e o `lineTotal` salvo.
4. Histórico do cliente e “Meus pedidos” mostram peso, não `0.35x`.
5. Caixa usa o valor financeiro gravado, e detalhes usam `lineTotal`.
6. Fechamento mostra peso corretamente sem alterar desconto, acréscimo ou divisão de pagamentos.
7. Dashboard não mistura kg com unidades em uma soma chamada “quantidade”. Para ranking misto, ordenar por faturamento e mostrar a medida de cada produto (`25 un.` ou `8,450 kg`).
8. Pedidos históricos sem os campos novos continuam no formato atual.

### Etapa 10 — Promoções, combos e encomendas

Arquivos principais:

- `src/components/admin/PromotionsTab.tsx`;
- `src/hooks/usePromotions.ts`;
- `src/components/admin/ComboModal.tsx`;
- `src/lib/encomendas/catalog.ts`;
- `src/lib/encomendas/types.ts`;
- `src/components/encomendas/EncomendaCatalogEditor.tsx`;
- `src/components/encomendas/EncomendaWizard.tsx`;
- `src/lib/encomendas/receipt.ts`.

Tarefas:

1. Promoções mostram e tratam o valor como R$/kg.
2. Combo filtra produtos por peso e valida referências antigas.
3. Catálogo de encomendas vinculado deve herdar `saleMode`.
4. `SkuRow` de produto por peso deve abrir entrada de peso em vez de stepper inteiro.
5. Linhas de encomenda devem guardar `weightGrams`, `saleMode`, tarifa e total.
6. Resumo, WhatsApp e recibo de encomendas devem formatar gramas/kg.
7. Enquanto essa etapa não estiver concluída, o seletor de produtos em encomendas deve ocultar ou bloquear produtos por peso para impedir cobrança errada.

### Etapa 11 — Validação autoritativa do pedido público

Tarefas recomendadas antes de considerar a funcionalidade protegida contra fraude:

1. Criar endpoint de checkout no servidor usando Firebase Admin.
2. Receber somente IDs, peso, adicionais escolhidos, canal e dados do cliente.
3. Buscar produtos, adicionais e promoções no servidor.
4. Validar visibilidade por canal, disponibilidade, modo de venda, peso e estoque.
5. Recalcular todas as linhas e o subtotal.
6. Gravar pedido e baixar estoque na mesma transação.
7. Ignorar `unitPrice`, `lineTotal`, `subtotal` e `totalAmount` enviados pelo navegador.
8. Restringir em `firestore.rules` a criação direta de pedidos pelo cliente após a migração para o endpoint.

Se essa etapa for adiada, a validação central no cliente ainda é obrigatória para consistência funcional, mas não elimina manipulação intencional.

## 8. Matriz de impacto por canal

| Canal/área | Seleção por peso | Recalcula preço | Persiste peso | Edita peso | Estoque | Saída formatada |
|---|---:|---:|---:|---:|---:|---:|
| Cardápio — delivery | Sim | Sim | Sim | Sim | Sim | Sim |
| Cardápio — retirada | Sim | Sim | Sim | Sim | Sim | Sim |
| Cardápio — local | Sim | Sim | Sim | Sim | Sim | Sim |
| PDV — balcão | Sim | Sim | Sim | Sim | Sim | Sim |
| PDV — delivery interno | Sim | Sim | Sim | Sim | Sim | Sim |
| Mesas | Sim | Sim | Sim | Sim | Sim | Sim |
| Edição de delivery | Sim | Sim | Sim | Sim | Delta | Sim |
| Pedir novamente | Reusa/solicita | Sim | Sim | Sim | Sim | Sim |
| Encomendas | Sim | Sim | Sim | Sim | Conforme regra do módulo | Sim |
| Promoções | N/A | Tarifa/kg | N/A | N/A | N/A | Sim |
| Caixa/fechamento | N/A | Usa snapshot | Lê | Não | N/A | Sim |
| Relatórios/clientes | N/A | Usa snapshot | Lê | Não | N/A | Sim |
| Impressão/WhatsApp | N/A | Usa snapshot | Lê | Não | N/A | Sim |

## 9. Casos de borda que devem ser tratados

- Peso vazio, zero, negativo, decimal de gramas ou texto inválido.
- Peso acima do estoque.
- Duas vendas simultâneas do último peso disponível.
- Produto muda de unidade para peso enquanto existe em carrinho ou rascunho.
- Produto muda de peso para unidade antes do checkout.
- Preço ou promoção muda enquanto o modal está aberto.
- Promoção expira antes do checkout.
- Produto por peso com adicionais.
- Produto por peso referenciado por combo antigo.
- Produto por peso vinculado a encomenda antiga.
- Edição de pedido reduz ou aumenta peso e precisa devolver/baixar somente o delta.
- Cancelamento restaura peso exato.
- Arredondamento de valores com meio centavo.
- Várias linhas do mesmo produto com pesos diferentes.
- Estoque ilimitado.
- Impressão em 58 mm e 80 mm.
- Pedido histórico sem `saleMode`, `weightGrams` ou `lineTotal`.
- Rascunho antigo do balcão.
- Repetição de pedido cujo produto foi excluído ou mudou de modo.
- Contadores de carrinho, mesa e dashboard não somarem kg como número de itens.
- Entrega grátis por valor mínimo continuar usando o subtotal monetário, não o peso.
- Desconto, acréscimo, pagamento dividido e Conta da Casa aplicarem o mesmo total exibido.

## 10. Plano de testes

### 10.1 Testes unitários dos helpers

1. Produto sem `saleMode` retorna `unit`.
2. Produto por unidade: 3 × R$ 10,00 = R$ 30,00.
3. Produto por peso: 350 g × R$ 39,90/kg = R$ 13,97.
4. 1.000 g equivale exatamente a uma tarifa por kg.
5. Promoção por kg substitui a tarifa base.
6. Adicionais por kg entram na tarifa efetiva.
7. Peso zero, negativo, fracionário em gramas, infinito ou `NaN` é rejeitado.
8. `lineTotal` novo tem precedência.
9. Pedido antigo usa `unitPrice * quantity`.
10. Formatação alterna corretamente entre `un.`, `g` e `kg`.
11. Contador do carrinho não soma 0,350 como “0,35 item”.
12. Normalização do estoque não deixa resíduos além de 0,001 kg.

### 10.2 Testes de estoque

1. Estoque de 1,000 kg aceita 350 g e sobra 0,650 kg.
2. Em seguida aceita 650 g e zera.
3. Rejeita 651 g quando há 650 g.
4. Editar 350 g para 500 g abate somente 150 g.
5. Editar 500 g para 200 g devolve 300 g.
6. Cancelar restaura o valor reservado.
7. Duas transações concorrentes não deixam estoque negativo.
8. Estoque ilimitado não é alterado.

### 10.3 Testes de integração por canal

Executar, no mínimo, a seguinte combinação:

- produto unitário sem e com adicionais;
- produto por peso sem e com adicionais;
- preço normal e promocional;
- estoque desligado, limitado e insuficiente;
- cardápio delivery, retirada e local;
- PDV balcão e delivery;
- mesa nova, edição, reabertura e finalização;
- edição de pedido em delivery;
- encomenda vinculada;
- pedido repetido;
- desconto, acréscimo, dinheiro, Pix, cartão, Prazo e pagamento dividido;
- frete normal, frete grátis e frete pago ao motoboy.

Em cada cenário, conferir:

1. valor no modal;
2. valor no carrinho;
3. valor persistido no Firestore;
4. subtotal e total do pedido;
5. lançamento no caixa;
6. baixa/restauração de estoque;
7. impressão de cozinha e cliente;
8. WhatsApp;
9. histórico do cliente;
10. dashboard.

### 10.4 Validação técnica

- `npm run typecheck`;
- `npm run build`;
- testes automatizados dos helpers;
- teste manual em desktop e celular;
- teste de impressão 58 mm e 80 mm;
- teste com dois navegadores finalizando simultaneamente;
- conferência de pedidos antigos reais em ambiente de homologação.

O projeto não possui atualmente script de testes no `package.json`. Deve-se adicionar uma ferramenta de testes compatível com TypeScript, ou usar o executor nativo do Node com transpile apropriado, antes de implementar a matemática crítica.

## 11. Estratégia de migração e liberação

1. Publicar primeiro tipos, helpers e fallbacks, sem criar produtos por peso.
2. Atualizar todos os leitores de pedidos para entender o formato novo.
3. Atualizar todos os escritores e sanitizadores.
4. Liberar o cadastro por peso apenas em homologação.
5. Criar um produto de teste com estoque baixo e passar pela matriz de canais.
6. Validar caixa, impressão, WhatsApp e relatórios.
7. Liberar para uma loja/produto piloto.
8. Monitorar erros de checkout, divergências de subtotal e estoque por alguns ciclos de venda.
9. Só então liberar criação ampla de produtos por peso.

Não é obrigatório atualizar todos os produtos antigos. Leitura preguiçosa (`saleMode` ausente = `unit`) é mais segura. Um backfill opcional pode ser feito depois, em lotes, apenas para tornar o banco explícito.

Para rollback, desativar temporariamente a seleção de novos produtos por peso sem apagar `saleMode` ou alterar pedidos existentes. Os leitores devem continuar entendendo os dados já gravados.

## 12. Critérios de aceite

A implementação estará concluída quando:

- produto novo nasce como venda por unidade;
- administrador consegue escolher venda por peso e cadastrar preço por kg;
- todos os cards identificam corretamente R$/unidade ou R$/kg;
- produto por peso sempre pede peso antes de entrar no carrinho;
- 350 g de um produto de R$ 39,90/kg cobra R$ 13,97 em todos os canais;
- o mesmo total aparece no modal, carrinho, pedido, caixa, cupom, WhatsApp e histórico;
- estoque por peso aceita três casas e é reconciliado por transação;
- edição e cancelamento aplicam o delta correto;
- produto por peso não entra acidentalmente em combo;
- promoções funcionam como tarifa promocional por kg;
- encomendas não tratam preço por kg como preço por unidade;
- pedidos históricos e produtos antigos permanecem funcionando;
- `typecheck` e `build` passam;
- a matriz de testes por canal passa sem divergência de centavos.

## 13. Decisões que não devem ficar implícitas durante a implementação

As seguintes decisões estão assumidas neste plano e devem ser confirmadas antes de começar o código:

1. Entrada manual em gramas, sem integração automática com balança nesta versão.
2. Precisão de 1 g e estoque em kg com três casas decimais.
3. Adicionais de produto por peso também são cobrados por kg.
4. Cada pesagem gera uma linha separada no carrinho.
5. Combos não aceitam produtos por peso na primeira versão.
6. Frete continua baseado nas regras atuais; o peso comercial não é peso logístico.
7. Pedir novamente reaproveita o peso antigo, mas usa preço e estoque atuais.
8. O módulo de encomendas será adaptado antes da liberação geral; até lá, o vínculo é bloqueado.

## 14. Ordem recomendada dos commits

1. `types + helpers + testes unitários`;
2. `leitores históricos e formatadores`;
3. `cadastro e gestão de produto`;
4. `modal e carrinho público`;
5. `PDV balcão/delivery`;
6. `mesas`;
7. `edição de delivery`;
8. `estoque transacional`;
9. `impressão, WhatsApp, caixa, clientes e dashboard`;
10. `promoções, combos e encomendas`;
11. `checkout público autoritativo e regras do Firestore`;
12. `homologação e liberação gradual`.

Essa divisão reduz o risco de um commit muito grande, permite testar compatibilidade a cada etapa e evita liberar o novo modo enquanto algum canal ainda descarta ou interpreta incorretamente o peso.
