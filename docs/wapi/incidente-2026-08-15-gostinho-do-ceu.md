# Incidente 15/08/2026 — "as mensagens automáticas pararam" (Gostinho de Céu)

Análise feita em 15/08/2026 a partir de leitura direta do Firestore de produção.
Todos os horários abaixo estão em **horário de Brasília** (o banco grava em UTC).

## Veredito

**Não foi a W-API e não havia fila travada.** O envio nunca parou.
O único silêncio real foi de **12:31 às 12:47 (16 minutos)**, causado pelo próprio
clique da cliente em "Desconectar". O que ela interpretou como "parou de enviar"
é comportamento do nosso app: **venda lançada no PDV não dispara notificação**.

## Dados da loja

| Campo | Valor |
|---|---|
| Nome | Gostinho de Céu |
| empresaId / ownerId | `5Hg3VG3qYAZNsobVnReK9aPntjx1` |
| Instância W-API | `LITE-8NDQT1-UWX43P` |
| Número conectado | `5516993638485` |
| Coleção de config | `roles_admin/{empresaId}.whatsappIntegration` |

A instância é **a mesma de antes** do incidente — foi revinculada com o mesmo ID e
a mesma chave pegos no painel da W-API. A W-API não perdeu nada; quem perdeu o
ponteiro para a instância foi o nosso banco.

## Linha do tempo de 15/08

| Hora | O que aconteceu |
|---|---|
| 10:15 → 12:00 | Respostas automáticas saindo normalmente (10 "primeiro contato", 7 "loja fechada") |
| 10:54 / 10:58 | Pedido do cardápio → confirmação + "pronto para retirada" enviados |
| 11:58 | Pedido do cardápio (cliente `16991782099`) → confirmação + "pronto" enviados |
| **12:17** | Venda lançada **no PDV** (retirada, tel `16981363704`) → **nenhuma mensagem** |
| **12:20** | Cancelamento do pedido das 11:58 → mensagem enviada com sucesso |
| **12:22** | Venda lançada **no PDV** (entrega, tel `16991782099` — mesmo cliente do pedido cancelado) → **nenhuma mensagem** |
| **12:31:53** | `webhookDisconnected` — **o clique em "Desconectar"**. Credencial apagada do banco |
| 12:43:46 | Integração recriada (revinculada com ID + chave da W-API) |
| 12:47:53 | `webhookConnected` — voltou |
| 12:48:44 | Respostas automáticas voltando a sair |

## Evidências coletadas

- **Sem gap nenhum**: 1.800 a 5.300 eventos de webhook por dia entre 08/08 e 15/08.
- **Respostas automáticas ininterruptas** desde maio (1.708 no total; 17 no dia 15/08).
- **218 mensagens no log, ZERO com erro** (`whatsapp_messages`, campo `errorMessage`).
- **Nenhuma campanha** em `scheduled_campaigns` para esta loja — não existe fila de campanha.
- Nos últimos 3 dias, **todo pedido vindo do cardápio recebeu suas mensagens**.
  Os 5 pedidos sem notificação eram **todos** `source: "pdv"`.

## Reconstrução do que a cliente viu (inferência, não fato confirmado)

O cliente `16991782099` pediu pelo cardápio às 11:58 e recebeu tudo. O pedido foi
cancelado às 12:20 (mensagem enviada). Dois minutos depois **o pedido foi refeito
no PDV** — e nenhuma mensagem saiu, porque `pdv/page.tsx` pula de propósito todo
pedido com `source === 'pdv'`. Somado à venda de balcão das 12:17, também muda, a
conclusão dela foi "parou de enviar". Onze minutos depois, clicou em Desconectar.

## Problemas de código encontrados (em ordem de prioridade)

### 1. "Desconectar" apaga as credenciais e não avisa
`src/app/wapi/disconnect/route.ts:30` — `deleteWhatsAppIntegration` zera o campo
inteiro: ID da instância e chave cifrada. O aviso em `WhatsAppTab.tsx:330` diz só
*"Desconectar este WhatsApp da loja? Voce podera conectar novamente depois."*, sem
mencionar que apaga a chave e que será preciso buscá-la de novo no painel da W-API.
**Foi por isso que ela precisou ligar.**

Correção proposta: separar "desligar o celular" (só chama a W-API, mantém as
credenciais) de "remover a conexão" (apaga, com aviso explícito). O mais simples é
nunca apagar `wapiInstanceId`/`wapiTokenEncrypted` — só marcar `connected: false`.

### 2. Venda de PDV não notifica, e nada na tela diz isso
`src/app/(sistema)/pdv/page.tsx:80` — `if (!o || o.source === 'pdv' || !o.customerPhone) continue;`
Faz sentido para balcão, mas quando o operador digita o telefone numa venda de
entrega/retirada, ele espera a mensagem. **Causa direta da confusão do dia 15/08.**

### 3. Notificação de pedido depende do navegador aberto
`src/app/(sistema)/pdv/page.tsx:72-97` — a varredura roda no cliente a cada 30s,
com janela de 30 min. Se ninguém tiver o PDV/Retaguarda aberto e logado, nenhuma
notificação de pedido sai; passados 30 min o pedido nunca mais é notificado.
As respostas automáticas (webhook, servidor) e as campanhas (QStash) são robustas;
só esta parte não é.

### 4. Log de mensagens preso em "queued" para sempre
`src/app/wapi/send-message/route.ts:124` grava `status: 'queued'` e nada nunca
atualiza — mesmo com 1.008 acks de `message-status` e 97 de `delivery` chegando
pelo webhook só no dia 15/08. Quem olhar essa lista conclui que está tudo parado
na fila. Dá para casar o `providerMessageId` com o ack.

### 5. Campanha morre se a integração sumir
`src/app/api/cron/dispatch/route.ts:70` — se houvesse campanha rodando às 12:31,
ela viraria `status: 'error'` no meio, e não há botão de retomar na UI
(`CampanhasTab.tsx` só mostra o selo "erro" no histórico).

## Estado no fim da sessão

Nada foi alterado — a análise foi só de leitura. **Decisão pendente do dono:**
implementar as correções 1 e 2 (as que fecham o buraco que gerou a ligação) e,
opcionalmente, a 4.

## Como refazer o diagnóstico

O service account fica na raiz do projeto
(`studio-2243391254-75492-firebase-adminsdk-fbsvc-*.json`). Um script `.mjs` dentro
de `scripts/` com `firebase-admin` lê tudo. Coleções úteis:

- `roles_admin/{empresaId}.whatsappIntegration` — instância, token cifrado, `connected`, `lastWebhookAt`
- `whatsapp_webhook_events` — todo evento da W-API (TTL 30 dias); `hook` = `received`/`message-status`/`delivery`/`connected`/`disconnected`; `empresaId` vazio = evento descartado
- `whatsapp_auto_replies` — respostas automáticas efetivamente enviadas
- `whatsapp_auto_reply_contacts` — travas por contato (`firstContactSentAt`, `lastClosedReplyAt`)
- `whatsapp_messages` — log das notificações de pedido
- `whatsapp_send_claims` — trava anti-duplicidade por pedido+tipo
- `scheduled_campaigns` — campanhas e seu cursor
- `orders` — atenção: `createdAt` é **Timestamp**, não string (filtrar por string não funciona)

Consultas com `where('empresaId', ...)` + `orderBy('createdAt')` exigem índice
composto que não existe — ordenar em memória ou filtrar só por `createdAt`.
