# 22/08/2026 — "o status comentado/reagido não responde"

Oitava queixa sobre as mensagens automáticas. Desta vez a dona do Gostinho de Céu
apontou uma coisa bem específica: **as interações no story dela não recebiam
resposta, mas as conversas normais recebiam**. Ela estava certa, e por dois
motivos diferentes ao mesmo tempo.

Análise feita sobre `whatsapp_webhook_events` de produção (197 mil eventos).
Horários em Brasília.

## O que a loja recebeu no sábado 22/08

| Interação no status | Quantas | Responderam |
|---|---|---|
| Reação (💚) no story da loja | 5 | **0** |
| Comentário em texto no story | 1 | **0** |
| DM comum (depois das 10h) | 3 | 3 |

Do ponto de vista dela: seis pessoas mexeram no status, nenhuma foi respondida;
quem mandou mensagem normal foi respondido. Exatamente o que ela relatou.

## Causa 1 — a reação no story nunca foi respondida (desde sempre)

É a maior parte do volume: **135 reações em 96 horas** nas duas lojas, de 30
pessoas diferentes.

A reação chega assim:

```json
{ "chat": { "id": "status" },
  "sender": { "id": "168835248328839", "senderLid": "168835248328839@lid" },
  "msgContent": { "reactionMessage": {
    "key": { "participant": "62169752330325@lid", "remoteJID": "status@broadcast" },
    "text": "💚" } } }
```

`chat.id = "status"` é o mesmo carimbo dos **stories alheios** que a instância
recebe o dia inteiro (3.500 por dia — imagem, vídeo e texto de todos os
contatos). A camada que barra esses stories barrava a reação junto.

O que separa uma coisa da outra é o **alvo**, em `reactionMessage.key.participant`:
quem publicou o story reagido. Quando esse alguém é a própria loja
(`connectedLid`, ou `connectedPhone` no formato antigo
`<telefone>@s.whatsapp.net`), aquilo não é um story — é uma pessoa levantando a
mão para a loja.

**Correção:** `extractStoryReaction` em `src/lib/wapi/incoming-message.ts`, a
única exceção ao bloqueio de status. Ela é estreita de propósito: exige
`reactionMessage`, exige `remoteJID = status@broadcast`, exige que o autor do
story seja a loja, e exige emoji (tirar a reação não é levantar a mão).

Reação nunca traz telefone — 135 de 135 vieram só com LID —, então a resposta sai
pelo `@lid`, o mesmo caminho que já atende contato fora da agenda.

## Causa 2 — o comentário respondia, mas o envio morreu calado

Comentário em texto no story sempre passou pelo filtro (é DM de verdade, com o
status apenas *citado* — ver `docs/`/memória sobre citação x destino). Ontem, dia
21, os seis comentários foram respondidos.

O de sábado não. Assinatura no banco, em `whatsapp_auto_reply_contacts`:

```
lastInboundAt   09:14:47
updatedAt       09:15:17   ← 31 segundos depois
lastClosedReplyAt = null   ← carimbo devolvido pelo catch
```

Isso é o `catch` do envio desfazendo o claim. A W-API ficou pendurada 31
segundos e a resposta foi descartada **sem deixar rastro nenhum** — nada em
`whatsapp_auto_replies`, nada de erro gravado, nada na tela.

Três respostas morreram assim no sábado de manhã (07:50, 07:54 e 09:14), todas
com exatos 31 s, nas duas lojas. Em toda a base de 966 contatos, foram as únicas.

**Correções:**

1. `requestWapi` não tinha timeout nenhum: o `fetch` esperava o quanto a W-API
   quisesse. Agora tem teto de 20 s (`AbortSignal.timeout`) e devolve 408.
2. `enviarComSegundaChance` no webhook: uma segunda tentativa, 2 s depois, só
   para timeout/rede/5xx. Erro de dado (4xx) não melhora repetindo.
3. Quando falha mesmo assim, o motivo fica gravado no contato
   (`lastSendError`, `lastSendErrorAt`). Uma resposta perdida deixa de ser
   invisível.

## Causa 3 (achada no caminho) — LID que se disfarça de telefone

O `sender.id` às vezes repete o próprio LID em vez do telefone. Três LIDs em
produção começam com 55 e têm 13 dígitos — cara de celular brasileiro — e
passavam pela checagem de tamanho:

```
5506164863174@lid   554184998969@lid   5596510212155@lid
```

Os 20 eventos dessas pessoas eram todos `chat.id = "status"`, ou seja, ficavam
bloqueados antes. Mas é justamente o caminho que a Causa 1 abriu: se uma delas
reagisse num story, a resposta iria para um número que não é de ninguém.
`ehOProprioLid` fecha isso nos dois caminhos: quando o provedor diz que aquilo é
o LID, aquilo não é telefone.

## A saudação dupla, evitada antes de acontecer

A reação chega só com LID e a DM da mesma pessoa chega com o número — são chaves
de contato diferentes. Sem ligar as duas, a mesma pessoa receberia a saudação
duas vezes. Não é hipótese: no sábado a Profa. Camila **reagiu às 09:14:28 e
comentou às 09:14:47**, 19 segundos depois.

`resolverDestino` no webhook faz a ponte com um `get` direto por id — o ponteiro
(`telefoneConhecido`) mora no próprio doc de contato do LID, sem coleção nova nem
índice. E `scripts/backfill-lid-telefone.mjs` já gravou os **499 vínculos**
inequívocos que estavam nos 30 dias de webhook. Três LIDs com mais de um telefone
ficaram de fora, sem chute — são justamente os da Causa 3.

## Verificação antes de publicar

Filtro antigo x filtro novo sobre **10.340 eventos `received` reais** (96 h):

```
veredito igual:        10.205
passou a PASSAR:          135   ← todos "status | reactionMessage"
passou a BLOQUEAR:          0
endereço mudou:             0
```

Volume que isso libera: ~30 pessoas distintas em 96 h, e o claim por contato
mantém uma resposta por pessoa (primeiro contato uma vez; loja fechada a cada
2 h). Não vira enxurrada.

Também: 748 testes, `tsc` e `next build` limpos.

## O que ficou de fora, de propósito

- **`timestamp` continua 0 em todas as mensagens.** A W-API manda a hora em
  `moment`, e o filtro procura `messageTimestamp`/`timestamp`/`t`. Como nenhum
  existe, a proteção de "ignorar mensagem com mais de 5 minutos" nunca chega a
  rodar. Corrigir isso muda o comportamento de **todas** as mensagens, não só as
  do status — merece uma passada própria, com medição antes.
- Venda lançada no PDV continua sem notificar (item 2 do incidente de 15/08).
