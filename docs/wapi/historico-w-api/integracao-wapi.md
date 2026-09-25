# Integracao W-API no PDV

## Variaveis de ambiente

Configure no ambiente local e na Vercel:

```env
WAPI_API_KEY=SUA_API_KEY_PRINCIPAL_DA_WAPI
WAPI_BASE_URL=https://api.w-api.app/v1
WAPI_PUBLIC_BASE_URL=https://seu-dominio.vercel.app
WAPI_WEBHOOK_SECRET=um-segredo-interno
WAPI_INSTANCE_PLAN=lite
```

Em ambiente multi-loja, nao configure `WAPI_INSTANCE_ID` ou `WAPI_INSTANCE_TOKEN` como variaveis globais da Vercel. Esses dados pertencem a uma loja especifica.

Para usar uma instancia W-API ja paga, abra Admin > WhatsApp > "Usar instancia ja paga", informe o ID/token da instancia daquela loja e salve. O sistema grava esses dados criptografados em `roles_admin/{uid}.whatsappIntegration` e passa a buscar o QR Code dessa loja sempre que precisar relogar.

Opcional, para usar uma chave de criptografia separada:

```env
WAPI_TOKEN_ENCRYPTION_KEY=uma-chave-forte
```

Se `WAPI_TOKEN_ENCRYPTION_KEY` nao existir, o sistema usa `WAPI_API_KEY` para criptografar o token individual das instancias.

O endpoint padrao de criacao de instancia e:

```text
POST /integrator/create-instance
Authorization: Bearer WAPI_API_KEY
```

Variaveis opcionais para compatibilidade se a W-API alterar nomes de rotas:

```env
WAPI_CREATE_INSTANCE_PATH=/integrator/create-instance
WAPI_QR_CODE_PATH=/instance/qr-code
```

Use `WAPI_INSTANCE_PLAN=pro` para solicitar criacao PRO quando o token/plano W-API permitir. Qualquer outro valor usa LITE.

## Fluxo implementado

```text
1. Cliente cria uma conta ou acessa Admin > WhatsApp.
2. Sistema chama POST /wapi/create-instance.
3. Backend cria uma instancia exclusiva na W-API usando `POST /integrator/create-instance`.
4. Backend salva no Firestore em `roles_admin/{uid}.whatsappIntegration`:
   - ownerId
   - clienteId
   - empresaId
   - wapiInstanceId
   - wapiTokenEncrypted
   - status
   - numeroWhatsapp
   - qrCode
   - timestamps
5. Painel mostra o QR Code.
6. Cliente escaneia o QR Code.
7. Painel verifica status em GET /wapi/status/:empresaId.
8. Envio de mensagens usa POST /wapi/send-message.
```

Neste projeto, a integracao fica dentro do documento administrativo da propria empresa para aproveitar as regras de seguranca ja existentes de `roles_admin`.

## Rotas criadas

```text
POST /wapi/create-instance
GET /wapi/qrcode/:empresaId
GET /wapi/status/:empresaId
POST /wapi/send-message
POST /wapi/disconnect
POST /wapi/reconnect
POST /webhooks/wapi
```

## Seguranca

- A API key principal fica apenas no servidor.
- O token individual da instancia W-API fica criptografado no Firestore.
- O frontend nao recebe o token puro.
- As rotas do painel exigem token de login Firebase no header Authorization.
- O webhook pode usar `WAPI_WEBHOOK_SECRET`.

## Observacao sobre webhook

O handler `/webhooks/wapi` ja existe e localiza a loja por:

```text
roles_admin/{uid}.whatsappIntegration.wapiInstanceId
```

Tambem e enviado `empresaId` na URL do webhook como redundancia de isolamento.

Para persistir eventos recebidos e atualizar status automaticamente via webhook, configure tambem Firebase Admin no servidor com uma destas opcoes:

```env
FIREBASE_SERVICE_ACCOUNT_KEY={...json...}
```

ou:

```env
FIREBASE_CLIENT_EMAIL=...
FIREBASE_PRIVATE_KEY=...
FIREBASE_PROJECT_ID=studio-2243391254-75492
```

Sem Firebase Admin, o webhook responde OK e registra log no servidor, mas nao consegue persistir eventos nem atualizar o Firestore em background.

## Teste manual

1. Entre no painel admin.
2. Abra a aba WhatsApp.
3. Se a conta foi criada antes da integracao automatica, clique em "Criar instancia e gerar QR Code".
4. Escaneie o QR Code no celular da loja.
5. Clique em "Verificar status".
6. Envie uma mensagem de teste.

## Isolamento por loja

Cada loja deve ter um `wapiInstanceId` diferente salvo em `roles_admin/{uid}.whatsappIntegration`.
Registros antigos que apontam para a instancia compartilhada de testes sao bloqueados para envio e substituidos quando `/wapi/create-instance` for chamado novamente.

## Notificacoes de pedido

Ao mudar o pedido para:

```text
Recebido
Saiu para entrega
```

o painel tenta enviar uma mensagem automatica para o telefone do cliente usando a instancia da loja.
