# Plano — Identificação do cliente na venda (e quando o Prazo aparece)

> **Status:** desenho aprovado, não implementado.
> **Criado em:** 01/08/2026
> **Origem:** o botão "Sem cliente" que nasceu junto com a validação de telefone. O dono leu a tela e apontou o certo: *"não seria melhor colocar um else? Se não buscar cliente, não aparecer o Prazo. E se buscar e não encontrar, aparecer um botão cadastrar."*
> **Relação:** é a Fase 1.2 do `docs/PLANO_INTEGRIDADE_DADOS.md` feita direito. Aquele plano manda validar o telefone na entrada; este define **o que a tela mostra** em cada situação.

---

## 1. O problema

Hoje o Prazo **aparece sempre**: `resolveFormasPagamento` injeta `conta_casa` no fechamento interno de forma incondicional (`payment-methods.ts:21`). Como fiado sem cadastro não existe, o app compensa com um aviso dentro do modal:

> ⚠️ Nenhum cliente informado. Prazo precisa de um cliente com telefone. **Ao confirmar, o sistema abre o cadastro rápido** para saber de quem é a dívida.

Ou seja: a tela oferece um caminho que **só falha depois**, e o conserto acontece no pior momento — no meio do fechamento, com o cliente esperando no balcão.

O botão **"Sem cliente"** foi criado para dar saída à validação de telefone. Ele resolve o sintoma e deixa o operador declarar algo que a tela já sabia: se nada foi digitado, a venda é anônima.

---

## 2. A regra nova, em uma frase

**O Prazo é consequência da identificação, não uma opção solta.** A tela deriva um estado da busca do cliente, e cada estado decide o que aparece.

| Estado | Como se chega | Prazo | O que a tela mostra |
|---|---|---|---|
| **Anônimo** | nada digitado | **não aparece** | nada de especial — é a venda de balcão normal |
| **Incompleto** | digitou algo que ainda não é telefone válido nem nome útil | **não aparece** | as sugestões do autocomplete |
| **Não encontrado** | telefone válido (ou nome) sem cadastro que case | **não aparece** | botão **"Cadastrar cliente"** no bloco do cliente |
| **Conflito** | mais de um cadastro para o mesmo telefone | **não aparece** | "há mais de um cadastro com este número — resolva na aba Clientes" |
| **Vinculado** | exatamente um cadastro casado | **aparece** | nome do cliente + limite disponível |

Duas exceções dentro de "Vinculado", que **aparecem desabilitadas com o motivo** em vez de sumir — aqui o operador precisa saber que existe e por que não pode:

- cliente sem Prazo ativo → *"Prazo desativado para este cliente"*;
- limite esgotado → *"Limite esgotado — disponível R$ 0,00"*.

**Por que sumir nos quatro primeiros e desabilitar nos dois últimos:** botão desabilitado sem causa vira dúvida no balcão ("por que não posso?"). Quando a causa é o próprio cliente, mostrar e explicar ensina; quando não há cliente nenhum, o botão é só ruído.

---

## 3. O que sai e o que entra

**Sai:** o botão "Sem cliente". Não digitar nada **já é** a venda anônima — o estado é derivado, não declarado. O "✕ Limpar", que zera os campos, continua (ele tem outra função).

**Entra:** o botão **"Cadastrar cliente"**, no bloco do cliente, quando a busca não encontra. Ele abre o `QuickRegisterClientModal` que já existe — a diferença é **quando**: a pedido do operador, antes do fechamento, e não como surpresa no confirmar.

**Continua igual:** o cadastro rápido, a validação de limite no `resolveContaCasa` e o bloqueio por permissão (`allowPrazo`).

---

## 4. Onde mexe

**Novo — `src/lib/vendas/identidade-cliente.ts`:** função pura que recebe `{ nome, telefone, clientes }` e devolve `{ estado, cliente, motivoPrazo }`. Pura de propósito: é regra de negócio, tem que ser testável sem tela e igual nos três canais. A lista já vem de `useCustomerLookup`, que carrega os clientes uma vez e filtra arquivado/`mergeInProgress`.

**`payment-methods.ts`:** `resolveFormasPagamento` para de injetar `conta_casa` incondicionalmente. Passa a receber se o Prazo é elegível.

**`useFechamento.ts`:** `allowPrazo` vira `permissão E identidade elegível` — a permissão continua mandando, a identidade entra como segunda condição.

**`FechamentoModal.tsx`:** o aviso deixa de ser "o sistema pede o cadastro ao confirmar" e passa a explicar o estado atual (para quem vai a dívida, quanto há de limite, ou por que o Prazo não está disponível).

**`NovoPedidoTab.tsx` e `MesasTab.tsx`:** derivam o estado, somem com `anonymousSale`, mostram o "Cadastrar".

**Delivery e Encomendas ficam de fora:** no Delivery o cliente vem do pedido, não da digitação; na criação de encomenda o Prazo já é filtrado de propósito. Se o mesmo estado servir lá depois, entra num segundo passo — não neste.

---

## 5. O que pode dar errado (e a defesa)

| Risco | Defesa |
|---|---|
| Sumir o Prazo de uma venda legítima | O estado "Vinculado" é o caminho normal de quem vende fiado: o cliente já está cadastrado, o operador digita o telefone e o Prazo aparece. Quem hoje escolhe Prazo sem cliente **já não conseguia** concluir sem cadastrar |
| Operador achar que "sumiu o fiado" | O bloco do cliente diz o que falta ("Cadastrar cliente" / "resolva o telefone duplicado"). Nunca some sem dizer o porquê |
| A UI liberar o que o servidor nega | `resolveContaCasa` **continua** validando no confirmar. A tela é conveniência; a regra vale no servidor. Limite pode mudar entre escolher e confirmar |
| Mexer no caminho do dinheiro | Entra **sozinho**, sem nada junto, e testado na conta de teste **antes** de publicar (ver §6) |

---

## 6. Como testar antes de publicar

Na conta de teste (`teste@gmail.com`), com o código novo rodando, os cinco caminhos:

1. **Anônima:** não digita nada → Prazo não aparece → venda em dinheiro conclui.
2. **Cliente novo:** digita telefone → "Cadastrar cliente" → cadastra → Prazo aparece → venda a prazo conclui e a dívida cai no cadastro certo.
3. **Cliente existente com Prazo:** digita telefone → vincula → Prazo aparece com o limite disponível.
4. **Cliente existente sem Prazo ativo:** Prazo aparece desabilitado, com o motivo.
5. **Telefone duplicado:** Prazo não aparece; a tela manda resolver em Clientes.

Mais os unitários da função pura (um por estado) e o de regressão: **venda anônima e venda com cliente novo continuam concluindo** — foi essa combinação que quebrou em 01/08/2026.

---

## 7. Resumo em uma linha

O Prazo deixa de ser um botão que sempre aparece e falha depois, e passa a ser consequência de ter cliente identificado — com "Cadastrar" no lugar onde a falta é percebida, e sem precisar de um botão para declarar que a venda é anônima.
