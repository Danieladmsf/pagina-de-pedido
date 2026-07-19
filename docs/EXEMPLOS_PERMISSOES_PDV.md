# Permissões do PDV — os 3 pontos em aberto, explicados com exemplos do dia a dia

> Complemento simples do plano `docs/PLANO_PERMISSOES_PDV.md`.
> Personagens dos exemplos: **Maria**, funcionária que fica no caixa da Gostinho de Céu, e **você**, o dono.

---

## Pergunta 1 — Isso vale para a máquina ou para a pessoa?

Hoje o sistema tem **um login só por loja**. A Maria e você usam o mesmo login — o sistema não sabe quem está na frente do computador.

### Cena com o que estou propondo agora ("gaveta trancada")

Você configura na Retaguarda: *"esconder Sangria e Fechar Caixa"*.

- O computador do caixa fica sem esses botões. A Maria não os vê.
- **Você também não os vê** quando usa aquele mesmo PDV — o sistema não distingue você da Maria.
- Para fazer uma sangria, você abre a Retaguarda ou reativa o botão.

É como trancar uma gaveta da loja: fica trancada para todo mundo, e você tem a chave (a Retaguarda).

### Cena com login de operador (o passo futuro)

A Maria teria **o login dela** ("maria / senha dela").

- Quando **ela** entra, o PDV esconde Sangria.
- Quando **você** entra, aparece tudo.
- Aí sim o sistema sabe quem é quem.

### O que preciso que você decida

Fazemos primeiro a versão "gaveta trancada" (rápida) e o login da Maria fica para depois?

> Observação: descobri que já existe um **começo** do "login da Maria" feito pelo outro assistente (Codex) nas regras do banco — está guardado, não atrapalha nada.

**Minha sugestão:** versão simples agora; login de operador depois, como projeto próprio.

---

## Pergunta 2 — Um botão de permissão pode controlar duas coisas parecidas?

### Exemplo real: cancelar e reativar venda

No Caixa existe o **X que cancela uma venda** — e também o caminho inverso, **reativar** uma venda cancelada.

**Cena:** a Maria lançou uma venda errada e cancela com o X. Depois percebe que cancelou a venda errada e reativa.

- **Minha proposta:** um único botão na configuração — **"Pode cancelar/reativar venda"** — controla os dois. Se você desligar, a Maria não cancela nem reativa; qualquer correção vira tarefa sua.
- **A alternativa** seria dois botões separados ("pode cancelar" / "pode reativar"), mas isso só enche a tela de opções sem uso prático.

### Mesmo raciocínio na aba Mesa

Um único botão **"Gerenciar mesa"** cobriria:

- abrir uma mesa;
- trocar um cliente de mesa;
- reabrir uma comanda fechada;
- cancelar uma mesa.

Tudo num botão só, em vez de quatro.

### O que preciso que você decida

Esses agrupamentos estão bons para o seu dia a dia? (Se preferir separar algum, é só dizer qual.)

---

## Pergunta 3 — E se você mudar uma permissão bem na hora em que a Maria está no meio de um pedido?

**Cena:** a Maria está na aba Mesa montando a comanda da mesa 5 — já lançou 2 bolos e 1 café, mas ainda não salvou. Nesse exato momento, você, em casa no celular, desliga a aba Mesa na Retaguarda.

### O que acontece no computador dela (minha proposta)

1. A aba Mesa **some na hora** e a tela pula para outra aba (Delivery, por exemplo).
2. O pedido da mesa 5 **não é apagado** — fica guardado na memória do computador.
3. Se você reativar a permissão 10 minutos depois, a Maria volta para a aba Mesa e os 2 bolos e o café ainda estão lá.
4. Enquanto estiver bloqueado, ela **não consegue enviar** aquele pedido.

**A alternativa ruim** seria apagar tudo na hora — a Maria perderia o trabalho e teria que redigitar.

### E se ela estiver com uma janela aberta?

Se a Maria abriu a janelinha de Sangria e você desliga a permissão naquele segundo:

- o botão **"Confirmar"** dela para de funcionar;
- aparece um aviso: *"Permissão removida pelo administrador"*.

### O que preciso que você decida

Concorda com essa regra: **bloqueia na hora, mas nunca apaga o que o operador estava digitando**?

---

## Resumo — o que eu sugiro

| # | Ponto | Sugestão |
|---|-------|----------|
| 1 | Máquina ou pessoa? | Versão "gaveta trancada" agora (vale para o PDV inteiro); login individual da Maria em etapa futura |
| 2 | Agrupamento de botões | Cancelar/reativar juntos; "Gerenciar mesa" cobre as 4 ações de mesa |
| 3 | Mudança em tempo real | Bloqueia na hora, mas **nunca apaga** o que o operador estava digitando |

Se concordar com os três, é só dizer **"pode seguir assim"** que eu começo a Fase 1 do plano.
