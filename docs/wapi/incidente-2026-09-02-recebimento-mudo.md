# 02/09/2026 — 4h32 sem resposta automática (o recebimento caiu, não o WhatsApp)

A dona da Gostinho de Céu avisou que "a partir de certo horário" as respostas
automáticas pararam. Era verdade, e dá para medir.

## O que se mediu

| Instância | Parou | Voltou | Silêncio |
|---|---|---|---|
| Gostinho (`LITE-8NDQT1-UWX43P`) | 16:00:07 | 20:32:29 | **4h32** |
| Lima Limão (`LITE-JMDANG-I3824S`) | 16:59:39 | 20:31:42 | 3h32 |

Horários em BRT. Em 7 dias (46.288 eventos em `whatsapp_webhook_events`) esse é
o único buraco desse tamanho: os demais são de madrugada, ≤2h, sem movimento.

A última resposta automática saiu às 15:23. No mesmo intervalo (16h–20h30), o
dia anterior rendeu 25 respostas e o retrasado 16. Neste dia: **zero**.

## De que lado caiu

Três verificações separam as causas:

1. **Não foi o WhatsApp desconectar.** Às 18:47:24, no meio do apagão, o app
   enviou uma notificação de pedido cancelado e a W-API aceitou, devolvendo
   `messageId 3EB05C50F20F4047E63133C9FDC83A9F`.
2. **Não foi a Vercel cair.** O site gravou visitas às 17h, 18h, 19h e 20h, e um
   pedido às 17h.
3. **Não foi mudança de código.** Último commit era de 25/08 — 8 dias antes.

E o que fecha o caso: aquele `messageId` **não aparece em nenhum webhook**.
Busca em todos os eventos das 48h: 0 ocorrências, numa integração que registra
27.600 avisos de status por semana. A W-API aceitou enviar e nunca avisou de
nada — nem do ack da própria mensagem que ela mesma despachou.

> A instância estava viva e conectada. O que morreu foi a **entrega dos
> webhooks**. Sem ela nenhuma mensagem de cliente chega ao app, e resposta
> automática não tem como existir.

## Por que ninguém percebeu por 4h32

A auto-cura já existia (`/wapi/status`: 30 min de silêncio → refaz os 5 PUTs),
mas dependia de um humano:

- ela só roda enquanto **a aba de conexão do WhatsApp está aberta** no navegador
  (poll de 15s) — e ninguém fica com essa tela aberta;
- o PDV também re-registra, mas **uma vez por carregamento de página** (trava
  `whatsappWebhookSyncRef`) e **só para `role === 'owner'`**;
- a tela mostrava **"Conectado / Online"**, tecnicamente correto e naquele
  momento enganoso: o aparelho estava mesmo conectado.

O recebimento voltou às 20:31/20:32 — o minuto em que foram olhar a tela.

## O que se pode e o que não se pode consertar

**Não existe recuperação.** A documentação da W-API diz que mensagens não são
armazenadas ("não armazenamos mensagens", eliminadas após o envio) e a leitura
de chats é negada neste plano (403 em `/chats/fetch-chats`, ver `d6fc196`).
O que não for entregue no instante em que chega está perdido. Não há
reconciliação possível — nenhum código do nosso lado muda isso.

Para comparar: na Cloud API oficial da Meta, entrega que falha é retentada
"imediatamente, depois mais algumas vezes com frequência decrescente ao longo
das 36 horas seguintes". Este apagão teria sido recuperado sozinho. O preço de
migrar não é só custo e burocracia: a operação usa resposta a **story** (reação
e comentário), que a API oficial não expõe.

## O que foi feito

Redução de dano, sem prometer cura:

- `src/lib/wapi/webhook-health.ts` — regra única de "está entrando mensagem?":
  15 min de silêncio → re-registrar, 30 min → avisar a loja, com backoff. Loja
  fechada não alerta.
- `src/lib/wapi/webhook-watchdog.ts` — refaz o registro **sem depender de tela**.
- `/api/cron/webhook-watchdog` — varredura a cada 10 min, assinada pelo QStash
  (agendada por `scripts/agendar-vigia-webhook.mjs`; o cron da Vercel no plano
  Hobby só roda uma vez por dia e não serviria).
- `/wapi/webhook-health/[empresaId]` — estado para a tela e segundo gatilho do
  vigia. Vale para operador: quem atende é quem precisa saber.
- `WhatsAppSilenceAlert` no layout do sistema e o card da aba WhatsApp passando a
  distinguir **conectado** de **recebendo**.

Janela de exposição: de horas para ~15 min.

## O dado que falta, e como ele será colhido

Não dá para saber retroativamente se o silêncio foi **registro perdido do lado
da W-API** (o vigia cura) ou **entrega do provedor fora** (o vigia não cura).

Por isso cada incidente é gravado em `whatsapp_webhook_incidents` com o tempo
entre o re-registro e a primeira mensagem que voltou:

- voltou em ≤ 5 min do re-registro → `veredicto: 'registro_perdido'`;
- só voltou muito depois → `veredicto: 'entrega_do_provedor'`.

Se os vereditos vierem majoritariamente `entrega_do_provedor`, o vigia é teto e a
conversa sobre trocar de provedor passa a ter dado em vez de palpite.

A coleção grava `expireAt` (90 dias); ligar a política de TTL no console do
Firestore, como já foi feito em `whatsapp_webhook_events` (a service account não
consegue: 403 em `datastore.indexes.update`).

## Como refazer a medição

Tudo saiu de `whatsapp_webhook_events` (payload inteiro, TTL 30 dias) lido pelo
Admin SDK: buracos por `instanceId`, cruzados com `whatsapp_auto_replies`
(o que saiu), `whatsapp_messages` (o que o app enviou) e `store_visits` (se o
site estava no ar).
