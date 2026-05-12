# O que precisa ser feito para o WhatsApp funcionar

Para a integracao do WhatsApp funcionar corretamente no sistema, cada loja precisa ter uma instancia propria da W-API.

Nao pode ser usada uma unica instancia compartilhada, porque isso faria mensagens de lojas diferentes sairem pelo mesmo numero de WhatsApp.

## 1. Liberar o plano correto na W-API

A conta da W-API precisa permitir criar varias instancias automaticamente via API.

O endpoint esperado e:

```text
POST https://api.w-api.app/v1/integrator/create-instance
```

Esse endpoint precisa retornar, para cada loja:

```text
instanceId
token da instancia
```

Se a conta atual estiver no trial e permitir apenas uma instancia, sera necessario contratar ou liberar um plano de integrador, pacote de instancias ou permissao equivalente com a W-API.

## 2. Configurar variaveis de ambiente

No ambiente local e na Vercel, configurar:

```env
WAPI_API_KEY=token_integrador_da_wapi
WAPI_BASE_URL=https://api.w-api.app/v1
WAPI_PUBLIC_BASE_URL=https://dominio-do-sistema.vercel.app
WAPI_WEBHOOK_SECRET=um_segredo_interno
WAPI_TOKEN_ENCRYPTION_KEY=uma_chave_fixa_forte
WAPI_INSTANCE_PLAN=lite
```

Observacoes:

- `WAPI_API_KEY` deve ser o token principal/integrador com permissao para criar instancias.
- `WAPI_PUBLIC_BASE_URL` deve ser a URL publica do sistema em producao.
- `WAPI_TOKEN_ENCRYPTION_KEY` deve ser fixa e forte. Se ela mudar depois, os tokens ja salvos podem deixar de descriptografar.
- `WAPI_INSTANCE_PLAN=lite` cria instancias LITE. Use `pro` somente se a W-API liberar esse tipo de instancia para a conta.

## 3. Configurar Firebase Admin para webhooks

Para o webhook da W-API conseguir atualizar o status da instancia automaticamente, o servidor precisa ter Firebase Admin configurado.

Opcoes:

```env
FIREBASE_SERVICE_ACCOUNT_KEY={json_da_conta_de_servico}
```

ou:

```env
FIREBASE_CLIENT_EMAIL=...
FIREBASE_PRIVATE_KEY=...
FIREBASE_PROJECT_ID=...
```

Sem Firebase Admin, o webhook responde OK, mas nao consegue gravar eventos nem atualizar o status da loja em segundo plano.

## 4. Publicar as regras do Firestore

As regras do Firestore precisam ser publicadas, porque o sistema salva logs de mensagens em:

```text
whatsapp_messages
```

Sem essa permissao, a mensagem pode ate ser enviada pela W-API, mas o log pode falhar ao ser salvo.

## 5. Fluxo esperado

Depois de tudo configurado, o fluxo correto sera:

```text
1. Cliente cria uma loja.
2. Sistema cria automaticamente uma instancia W-API exclusiva.
3. Sistema salva o token da instancia criptografado.
4. Lojista abre Admin > WhatsApp.
5. Lojista escaneia o QR Code.
6. A loja fica conectada ao proprio numero de WhatsApp.
7. Pedidos passam a enviar notificacoes pelo numero correto da loja.
```

## 6. Teste final

Para confirmar que esta funcionando:

```text
1. Criar uma conta nova.
2. Abrir Admin > WhatsApp.
3. Verificar se aparece QR Code.
4. Escanear com o celular da loja.
5. Clicar em Verificar status.
6. Enviar uma mensagem de teste.
7. Criar ou alterar um pedido para Recebido.
8. Alterar um pedido para Saiu para entrega.
9. Confirmar se as mensagens sairam pelo numero correto da loja.
```

## Ponto principal

O ponto mais importante e confirmar com a W-API se a conta atual permite criar multiplas instancias automaticamente.

Se a W-API liberar apenas uma instancia no trial, a integracao multi-loja so funcionara corretamente depois de liberar um plano/token que permita criar uma instancia exclusiva para cada loja.
