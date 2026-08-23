# Plano — De onde vem a venda (origem, funil de identificação e segmentação)

> **Status:** plano COMPLETO — Fases 1 a 4 implementadas em 23/08/2026 (`68a4544`, `e403b92`, `022350c`, `6627bae` e o commit da Fase 4). Único item não feito: o eixo de bairro da Fase 3, por falta de dado — ver 4.6.
> **Criado em:** 23/08/2026
> **Origem:** o card do placar mostrava a mesma foto quatro vezes (corrigido em `2730edb`, agrupamento por pessoa). Puxando o fio: a loja não sabe **de onde** vem quem abre o cardápio, e o único jeito de dar nome a alguém hoje depende de um link que pode vazar.
> **Relação com outros planos:** `docs/PLANO_INTEGRIDADE_DADOS.md` (vínculo por id, não por texto) vale aqui inteiro — origem e identidade só entram como id ou chave normalizada.

---

## 1. Objetivo

Responder três perguntas que hoje a dona não consegue responder:

1. **De onde veio essa pessoa?** (Instagram, WhatsApp, panfleto, embalagem, indicação)
2. **Quem é ela?** — sem truque, sem link que vaza, e sem repetir o processo com quem já é cliente.
3. **De onde vem o dinheiro?** — não "quantas visitas o Instagram trouxe", mas **quantos reais**.

Com duas restrições:

- **Nada de captura escondida.** Nenhum site lê o telefone de quem abre a página; qualquer botão que finja fazer isso é engano e cai na LGPD. Identidade só chega quando a pessoa age (manda mensagem, digita no carrinho).
- **Nada de virar painel de métrica.** Cada número novo só entra se mudar uma decisão da dona: onde divulgar, o que produzir, a quem ligar.

---

## 2. O retrato de hoje (medido em 23/08/2026, últimos 7 dias)

| | Gostinho de Céu | Lima Limão |
|---|---|---|
| Visitas ao cardápio | 441 | 153 |
| Pessoas (visitantes distintos) | 120 | 43 |
| Com nome ou telefone | 39 | 22 |
| Chegaram a abrir um produto | 16 | 34 |
| Fecharam pedido pelo cardápio | 6 | 14 |
| **Conversão do cardápio** | **5%** | **33%** |
| Pedidos no período (todos os canais) | 66 | 80 |

Últimos 30 dias, todas as lojas: `source` = **802 pdv** contra **225 cardápio**; `orderType` = 704 retirada, 213 entrega, 110 mesa.

**O que esses números dizem.** Na Gostinho de Céu, 441 visitas viraram 6 pedidos no cardápio — mas a loja fez 66 pedidos. O cardápio ali é **vitrine**: a pessoa olha e fecha no WhatsApp ou no balcão. Sem ligar a visita ao pedido que fechou em outro canal, a leitura ingênua é "o cardápio não vende" — e a dona desliga justamente a divulgação que está funcionando.

A Lima Limão, com um terço das visitas, converte 6× melhor. São operações diferentes e **não podem ser lidas com a mesma régua**.

**Identidade hoje:** dos 98 visitantes históricos da Gostinho, só **10** chegaram identificados por link marcado — e de apenas **3 telefones**. Todo o resto é anônimo.

---

## 3. O que já existe (não reconstruir)

| Peça | Onde | Serve para |
|---|---|---|
| Visita append-only | `store_visits` | placar por sessão de caixa |
| Pessoa + linha do tempo + carrinho | `store_visitors` | quem é, o que olhou, o que ficou parado |
| Agrupamento por pessoa | `lib/visitantes.ts` (`agruparPorPessoa`) | 1 pessoa = 1 linha, mesmo com vários aparelhos |
| Código do visitante | `lib/contato-link.ts` (`codigoDoVisitante`) | casar a mensagem do WhatsApp com a visita |
| Marca de contato no link | `lib/contato-link.server.ts` + `/api/cardapio/identificar` | identidade provável de quem recebe link da loja |
| Reconhecimento no aparelho | `MenuPageClient.tsx:504` (`customer_profile`) | cliente que já pediu é reconhecido ao abrir |
| Modal de escolha | `components/menu/OrderChoiceDialog.tsx` | Delivery / Encomendas / WhatsApp |
| Links por combinação | `lib/order-link.ts` + aba WhatsApp, seção "Links" | a loja já tem vários links no ar |
| Canal do pedido | `orders.source` (`pdv` ou `cardapio`), `orderType` | separar venda do balcão da venda online |
| Campanhas | `lib/campanhas` + `/wapi/send-message` | falar com uma lista escolhida |
| Bairro e taxa | `deliveryFee`, `neighborhood` | geografia da venda |

---

## 4. Os eixos de segmentação

Cada eixo é independente: entra sozinho, sem esperar os outros.

### 4.1 Origem — de onde a pessoa veio

Parâmetro `?via=` no link, escolhido pelo dono ao gerar o endereço na aba WhatsApp. Gravado na visita **e** na pessoa.

- **Canal:** instagram, facebook, whatsapp, google, tiktok, panfleto, indicação.
- **Peça:** `via=ig-bio`, `via=ig-story`, `via=post-dia-das-maes` — nome livre normalizado (minúsculas, sem acento, sem espaço) para não virar lixo do tipo "teste1" e "Teste 1" convivendo.
- **QR impresso:** o mesmo mecanismo cobre balcão, panfleto, cartão e **a embalagem do produto**. QR na caixa do bolo mede recompra por embalagem, e é coisa que concorrente nenhum faz.
- **Parceiro ou influenciador:** um `via=` por parceiro mede quem realmente trouxe gente — e encerra discussão de permuta no olhômetro.

> Responde: onde vale a pena postar. Custo: baixo.

### 4.2 Atribuição — quem levou o crédito

A pessoa vê no Instagram, volta pelo WhatsApp e compra. **Quem vendeu?**

Guardar as duas pontas no documento da pessoa: `origemPrimeira` (nunca sobrescrita) e `origemUltima`. Sem isso o WhatsApp leva o crédito de tudo — é sempre o último clique — e o Instagram parece inútil.

Com o agrupamento por pessoa já pronto, as duas pontas sobrevivem à troca de aparelho. **Atenção:** na fusão, a origem do documento mais antigo precisa ser preservada, porque o documento mais recente costuma vir do webview do WhatsApp, sem origem nenhuma.

> Responde: o Instagram traz gente que compra, mesmo quando o pedido fecha em outro canal. Custo: baixo.

### 4.3 Identificação — o funil só para quem é novo

| Quem chega | O que acontece |
|---|---|
| Reconhecido no aparelho | vai direto ao destino, em silêncio. Nenhum passo extra. |
| Desconhecido | modal → "Delivery" → WhatsApp com `Cód. #XXXXX` → telefone **confirmado** + origem |

Peça que falta: `webhooks/wapi/route.ts:109` só responde no primeiro contato do número **ou** depois de 12h de silêncio. O pedido de link precisa de gatilho próprio, que responda sempre que a mensagem trouxer o código.

Limites honestos: reconhece o **aparelho**, não a pessoa; o webview do Instagram pode não guardar o storage; aparelho emprestado existe. Por isso o pulo é silencioso — nada de "Bem-vinda, Maria" estampado em tela pública.

> Responde: telefone real de quem é novo, sem incomodar quem já é cliente. Custo: médio.

### 4.4 Dinheiro por origem — a única tabela que a dona vai olhar

Ligar a visita ao pedido **mesmo quando ele fecha em outro canal**: casar por `clienteId` quando existir, telefone normalizado como reserva.

> ⚠️ Casar por telefone perde pedidos: o PDV grava o número como foi digitado. Id primeiro, sempre (ver `PLANO_INTEGRIDADE_DADOS.md`).

Saída: por origem, no período — visitas, pessoas, pedidos, **receita**, ticket médio, conversão.

**Medido ao ligar (23/08/2026, 7 dias):** na Gostinho de Céu, 9 dos 64 pedidos encontraram dono entre quem visitou o cardápio (R$ 353,90); na Lima Limão, 17 de 79 (R$ 676,70). O resto — R$ 1.854,80 e R$ 2.473,80 — é venda sem cliente identificado, quase toda de balcão ("Cliente Balcão", sem telefone). **Por isso a tela mostra a linha "fora da conta" logo abaixo da tabela:** sem ela a dona soma a coluna, não bate com o faturamento e conclui que o número está errado. É também a maior alavanca escondida da loja — identificar o cliente no balcão dobraria o alcance desta tabela.

> Responde: onde está o dinheiro, não o clique. Custo: médio.

### 4.5 Comportamento — o que a vitrine mostra e o que trava

- Carrinho parado por faixa de valor (a fila já existe; falta a faixa).
- Produto muito aberto e pouco vendido: foto ruim, preço fora ou descrição faltando.
- Profundidade da visita: quantos produtos abriu antes de sair.
- Quantas visitas até o primeiro pedido (ciclo de decisão).
- **Busca sem resultado** (`ShowcasePageClient` já lê `?s=`): "18 pessoas procuraram brigadeiro e não acharam" é decisão de cardápio, não de marketing.

> Responde: o que produzir e o que arrumar na vitrine. Custo: baixo a médio.

### 4.6 Momento e lugar

- Visitas **fora do horário de funcionamento** = demanda reprimida: quantas pessoas bateram na porta fechada, e a que horas.
- Hora e dia da semana da visita comparados aos do pedido.
- ~~Bairro de quem visita contra bairro de quem compra~~ — **sem base de dados, não implementado.** A visita é anônima: `store_visits` e `store_visitors` não têm endereço, e bairro só existe no pedido (148 dos 1.011 pedidos de 30 dias). Cruzar pelo cadastro cobriria só os identificados (39 numa semana), o que daria uma tabela de 5 linhas com 1 pessoa cada — número que engana mais do que informa. Para valer, o cardápio teria de perguntar o bairro antes do carrinho: decisão de produto, não de código.

**Medido ao implementar (23/08/2026, 30 dias):** Gostinho de Céu teve **127 de 658 visitas (19%) com a loja fechada**; Lima Limão, 30 de 215 (14%). E o padrão não é madrugada — é a BORDA do horário: a hora com mais gente na Gostinho é **18h (28 visitas), o minuto em que ela fecha**, seguida de 09h (18), uma hora antes de abrir. Na Lima Limão, 08h e 16h — mesma coisa. Meia hora a mais em cada ponta pegaria perto de 46 visitas por mês numa loja que faz ~66 pedidos por semana.

> Responde: horário de abertura e política de frete. Custo: baixo.

### 4.7 Ciclo de vida — quem some

Recência, frequência e valor por pessoa (já dá para calcular com o que existe): **novo**, **fiel**, **sumido**.

Cruzando com Campanhas: "12 clientes fiéis não pedem há 30 dias" vira uma lista pronta para uma mensagem — o módulo de disparo já existe.

**Como ficou:** dois públicos novos em `lib/campanhas/audience.ts`, ao lado dos quatro que já existiam. **Fiéis que sumiram** (3 pedidos ou mais e nada há 30+ dias) é diferente de "inativos 60+ dias", que pega quem comprou uma única vez e nunca voltou — perder um fiel dói mais e reverte mais fácil. **Olharam e não pediram** vem do cardápio, não do cadastro: quem abriu nos últimos 7 dias, deixou telefone e não fechou. É o público mais quente que existe, e nenhum cadastro sabia dele antes deste plano.

> Responde: a quem falar hoje. Custo: médio.

---

## 5. Fases

**Fase 1 — Origem e funil** (a base de tudo) — ✅ FEITA
`?via=` no link; gravação em `store_visits` e `store_visitors` com `origemPrimeira` e `origemUltima`; gerador de link por canal na aba WhatsApp; pulo do modal para quem é conhecido; gatilho novo do webhook para o pedido de link; "de onde vieram" na tela de Visitantes.

**Fase 2 — Dinheiro por origem** — ✅ FEITA
Ligação visita→pedido por id; tabela de receita, ticket e conversão por origem; QR por ponto físico (embalagem, balcão, panfleto).

**Fase 3 — Decisões** — ✅ FEITA (menos o bairro, ver 4.6)
Busca sem resultado; demanda reprimida fora do horário; bairro que visita contra bairro que compra; faixas de carrinho parado.

**Fase 4 — Ação** — ✅ FEITA
Ciclo de vida (novo, fiel, sumido) alimentando Campanhas; avisos em vez de painel — "hoje o Instagram trouxe 30 visitas e nenhum pedido".

---

## 6. Riscos e limites

| Risco | Cuidado |
|---|---|
| Captura enganosa de telefone | Não existe e não se faz. Identidade só por ação da pessoa. |
| Link marcado colado em lugar público | O link público **nunca** recebe marca; a marca ganha validade curta e teto de aberturas. Sem isso, todo mundo vira o mesmo contato. |
| Cardinalidade de origem | Lista fechada de canais mais nome de campanha normalizado. |
| Custo de leitura no Firestore | Resumo agregado por dia e origem, em vez de varrer coleção a cada abertura de tela. |
| Aparelho não é pessoa | Reconhecimento é melhor esforço; o funil é a rede de segurança. |
| Virar painel de métrica | Toda tela nova precisa caber na frase: "vendo isso, a dona faz o quê?" |
| LGPD | Origem é dado de navegação. Cruzar com telefone só depois que a pessoa se identificou por vontade dela. |

---

## 7. Decisões em aberto

1. Card "Delivery" passa pelo WhatsApp sempre, ou por opção do dono em cada link? (recomendado: opção, com saída "ver o cardápio agora")
2. Loja fechada: manda o link junto do aviso? (recomendado: sim)
3. Origem: lista fechada, ou lista mais nome livre de campanha? (recomendado: os dois)
4. Reconhecido pula o funil em silêncio ou mostra "não sou eu"? (recomendado: silêncio)
