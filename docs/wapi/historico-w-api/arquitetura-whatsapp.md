# Arquitetura para suporte WhatsApp por loja

## Objetivo

Ao criar uma nova conta/loja no sistema, o ideal e criar tambem uma instancia de WhatsApp separada para essa loja.

Cada loja precisa ter seu proprio WhatsApp conectado, sem misturar sessao, mensagens ou QR Code com outras lojas.

## Separacao recomendada

O WhatsApp nao deve rodar dentro da Vercel/Next.js.

A Vercel deve continuar cuidando de:

- cadastro de lojas;
- pedidos;
- painel administrativo;
- status de entrega;
- criacao de notificacoes.

A VM deve cuidar apenas do WhatsApp:

- rodar `whatsapp.js`;
- manter as sessoes conectadas;
- gerar QR Code por loja;
- enviar mensagens;
- receber mensagens;
- controlar reconexao.

## Estrutura geral

```text
Next.js / Vercel
  -> sistema principal
  -> banco de dados
  -> pedidos
  -> painel
  -> cria eventos de notificacao

VM WhatsApp Service
  -> Node.js
  -> whatsapp.js
  -> sessoes separadas por loja
  -> envio e recebimento de mensagens
```

## VM disponivel

Configuracao informada:

```text
CPU: 2 cores
RAM: 7.8 GiB
Disco: 96 GB total, 92 GB livres
Sistema: Ubuntu 24.04.4 LTS
Hostname: srv1660429
IP publica: 72.60.31.249
```

Essa maquina e suficiente para um MVP com `whatsapp.js`, desde que o servico seja organizado com limite de instancias e monitoramento.

Ponto principal: `whatsapp.js` usa Chromium/Puppeteer por baixo. Cada sessao conectada pode consumir memoria consideravel.

Estimativa pratica inicial:

```text
Uso seguro inicial: 5 a 10 lojas conectadas
Uso possivel com ajuste fino: 10 a 20 lojas
Acima disso: avaliar outra VM, containers separados ou API oficial do WhatsApp
```

Para comecar, eu usaria:

```text
Ubuntu 24.04
Node.js LTS
PM2
1 servico Node principal
whatsapp.js com LocalAuth por storeId
sessoes salvas em /srv/whatsapp-sessions
logs em /var/log/whatsapp-service
```

Depois, se crescer:

```text
Docker ou PM2 cluster controlado
1 processo por loja ou grupo de lojas
Redis/fila dedicada
monitoramento de memoria
reinicio automatico por instancia
```

## Cuidados especificos nessa VM

Como a VM tem 2 cores e 7.8 GiB de RAM, nao recomendo subir uma instancia pesada para cada loja logo no inicio.

Melhor caminho para o MVP:

```text
1 processo Node
varias sessoes isoladas por storeId
limite de lojas ativas
fila de mensagens
reconexao controlada
QR Code por loja no painel
```

Evitar:

```text
abrir Chromium sem limite
reiniciar todas as sessoes ao mesmo tempo
guardar sessao dentro do projeto Git
deixar rota da VM aberta sem token
enviar mensagens diretamente pelo Next.js
```

Pastas sugeridas:

```text
/srv/whatsapp-service
/srv/whatsapp-sessions
/srv/whatsapp-sessions/store-id-1
/srv/whatsapp-sessions/store-id-2
/var/log/whatsapp-service
```

## Fluxo ao criar nova conta

Quando uma nova loja for criada:

```text
1. O sistema cria a loja no banco.
2. O sistema chama a VM:
   POST /internal/whatsapp/instances
3. A VM cria uma instancia/sessao para essa loja.
4. O painel mostra o QR Code.
5. O cliente escaneia o QR Code no WhatsApp.
6. A loja fica com WhatsApp proprio e isolado.
```

## Identificacao da instancia

Cada loja deve ter uma identificacao unica.

Exemplo:

```text
storeId: gostinho-do-ceu
sessionPath: /srv/whatsapp-sessions/gostinho-do-ceu
status: connected | disconnected | pending_qr | error
phone: numero conectado
```

## Dados sugeridos no banco

Criar uma tabela ou colecao para controlar as instancias:

```text
whatsapp_instances
- storeId
- userId
- status
- phoneNumber
- qrCode
- sessionPath
- lastConnectedAt
- createdAt
- updatedAt
```

Criar tambem uma tabela ou colecao para fila de mensagens:

```text
notification_jobs
- storeId
- type: order_created | delivery_out | daily_greeting
- customerPhone
- message
- orderId
- status: pending | sent | failed
- attempts
- createdAt
```

## Envio de mensagem ao finalizar pedido

O sistema principal nao deve enviar a mensagem diretamente.

Fluxo recomendado:

```text
1. Cliente finaliza pedido.
2. Sistema cria o pedido.
3. Sistema cria um notification_job.
4. VM busca ou recebe esse job.
5. VM envia a mensagem usando o WhatsApp da loja correta.
6. VM marca o job como sent ou failed.
```

Mensagem exemplo:

```text
Ola! Seu pedido foi recebido com sucesso.
Pedido: #123
Status: em preparo
```

## Envio quando a entrega sair

Quando o status do pedido mudar para "saiu para entrega":

```text
1. Admin altera status do pedido.
2. Sistema cria notification_job do tipo delivery_out.
3. VM envia mensagem pelo WhatsApp conectado da loja.
```

Mensagem exemplo:

```text
Seu pedido saiu para entrega.
Em breve chegara ate voce.
```

## Saudacao no primeiro contato do dia

A VM pode ouvir mensagens recebidas no WhatsApp.

Quando um cliente mandar mensagem:

```text
1. VM identifica a loja pela instancia conectada.
2. VM identifica o telefone do cliente.
3. VM verifica se esse cliente ja recebeu saudacao hoje.
4. Se nao recebeu, envia saudacao com link do cardapio.
5. Registra que a saudacao do dia ja foi enviada.
```

Mensagem exemplo:

```text
Ola! Seja bem-vindo.
Veja nosso cardapio:
https://seu-dominio.com?s=loja
```

## Isolamento entre lojas

Para o primeiro MVP, pode usar um unico servico Node na VM controlando varias sessoes.

Cada sessao deve usar um `clientId` diferente:

```text
clientId = storeId
```

As sessoes devem ficar em pastas separadas:

```text
/srv/whatsapp-sessions/loja-1
/srv/whatsapp-sessions/loja-2
/srv/whatsapp-sessions/loja-3
```

## Estrutura mais profissional

Quando o projeto crescer, o ideal e separar melhor:

```text
1 processo ou container por loja
```

Vantagem:

- uma sessao travada nao derruba todas;
- melhor isolamento;
- mais facil reiniciar uma loja especifica;
- mais seguro para escalar.

Desvantagem:

- consome mais memoria;
- exige mais controle com Docker, PM2 ou algum orquestrador.

## Sugestao pratica

Para comecar:

```text
MVP:
- uma VM;
- um servico Node;
- whatsapp.js;
- varias sessoes separadas por storeId;
- controle pelo banco;
- fila de notification_jobs.
```

Depois:

```text
Escala:
- Docker ou PM2;
- processo separado por loja;
- monitoramento;
- retentativas;
- logs por loja;
- painel para reconectar QR Code.
```

## Rotas sugeridas na VM

```text
POST /internal/whatsapp/instances
Cria uma instancia para uma loja.

GET /internal/whatsapp/instances/:storeId/status
Retorna status da instancia.

GET /internal/whatsapp/instances/:storeId/qr
Retorna QR Code atual.

POST /internal/whatsapp/messages
Envia mensagem usando o WhatsApp da loja correta.

POST /internal/whatsapp/instances/:storeId/restart
Reinicia uma instancia especifica.
```

## Seguranca

As rotas internas da VM nao devem ficar abertas publicamente sem protecao.

Usar pelo menos:

- token interno entre Vercel e VM;
- HTTPS;
- validacao de `storeId`;
- limite de requisicoes;
- logs de envio;
- nunca expor sessoes do WhatsApp no Git.

## Observacao importante

`whatsapp.js` usa WhatsApp Web.

Isso significa que:

- pode desconectar;
- pode pedir QR Code novamente;
- pode falhar se o WhatsApp bloquear automacao;
- nao e a API oficial da Meta.

Para uso profissional em escala, o caminho mais seguro no futuro e usar a WhatsApp Business Cloud API oficial.

Mesmo assim, para comecar com uma VM e validar o produto, `whatsapp.js` pode funcionar bem se houver isolamento, fila e monitoramento.
