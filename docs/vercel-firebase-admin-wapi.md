# Configuracao obrigatoria na Vercel para W-API

Este arquivo descreve o que precisa ser configurado na Vercel para o webhook do WhatsApp funcionar de forma correta, persistente e escalavel.

## Problema atual

O endpoint `/webhooks/wapi` esta recebendo chamadas da W-API, mas a producao ja mostrou este log:

```text
[W-API webhook] recebido sem Firebase Admin configurado
```

Sem Firebase Admin, o webhook ate responde `200 OK`, mas nao consegue gravar eventos, validar a integracao pelo Firestore nem salvar corretamente o controle de contatos ja respondidos.

## Variavel principal que falta

Adicionar na Vercel, no ambiente **Production**:

```env
FIREBASE_SERVICE_ACCOUNT_KEY={json_da_conta_de_servico_firebase}
```

O valor deve ser o JSON completo da conta de servico do Firebase, de preferencia minificado em uma unica linha.

Exemplo do formato esperado:

```json
{"type":"service_account","project_id":"studio-2243391254-75492","private_key_id":"...","private_key":"-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n","client_email":"...","client_id":"...","auth_uri":"https://accounts.google.com/o/oauth2/auth","token_uri":"https://oauth2.googleapis.com/token","auth_provider_x509_cert_url":"https://www.googleapis.com/oauth2/v1/certs","client_x509_cert_url":"...","universe_domain":"googleapis.com"}
```

Nao colocar esse JSON no GitHub.

## Como gerar a conta de servico

1. Abrir o Firebase Console.
2. Entrar no projeto `studio-2243391254-75492`.
3. Ir em **Project settings**.
4. Abrir a aba **Service accounts**.
5. Gerar uma nova chave privada.
6. Baixar o arquivo `.json`.
7. Converter para uma linha antes de colar na Vercel.

Com Node.js:

```bash
node -e "const fs=require('fs'); console.log(JSON.stringify(JSON.parse(fs.readFileSync('firebase-service-account.json','utf8'))))"
```

Depois de copiar o resultado, apagar o arquivo local da chave.

## Onde configurar na Vercel

No painel da Vercel:

```text
Project: polarispdv
Settings
Environment Variables
Add New
```

Adicionar:

```env
FIREBASE_SERVICE_ACCOUNT_KEY=...
```

Selecionar pelo menos:

```text
Production
```

Preview pode ser marcado tambem se quiser testar em previews.

## Redeploy obrigatorio

Depois de adicionar ou alterar variaveis de ambiente na Vercel, fazer um novo deploy de producao.

Pela CLI:

```bash
npx vercel --prod --yes
```

Ou pelo painel da Vercel, redeploy do ultimo deployment de producao.

## Variaveis que tambem devem estar corretas

Estas variaveis precisam existir no ambiente de producao:

```env
WAPI_API_KEY=token_integrador_da_wapi
WAPI_BASE_URL=https://api.w-api.app/v1
WAPI_PUBLIC_BASE_URL=https://polarispdv.vercel.app
NEXT_PUBLIC_APP_URL=https://polarispdv.vercel.app
WAPI_WEBHOOK_SECRET=um_segredo_forte
WAPI_INSTANCE_PLAN=lite
```

## Atencao com WAPI_TOKEN_ENCRYPTION_KEY

Nao adicionar ou trocar `WAPI_TOKEN_ENCRYPTION_KEY` sem planejar migracao.

O codigo descriptografa tokens W-API usando:

```text
WAPI_TOKEN_ENCRYPTION_KEY || WAPI_API_KEY || WAPI_INTEGRATOR_TOKEN
```

Se a integracao atual foi salva usando `WAPI_API_KEY` e depois for adicionada uma nova `WAPI_TOKEN_ENCRYPTION_KEY`, o sistema pode parar de descriptografar o token antigo.

Se quiser usar uma chave separada, o caminho seguro e:

```text
1. Definir WAPI_TOKEN_ENCRYPTION_KEY.
2. Redeploy.
3. Desconectar/revincular ou recriar a integracao W-API para salvar o token com a nova chave.
```

## Trocar o segredo do webhook

O segredo atual ja apareceu em conversa/log. Recomenda-se trocar:

```env
WAPI_WEBHOOK_SECRET=novo_segredo_forte
```

Depois:

```text
1. Redeploy na Vercel.
2. Entrar no Polaris > WhatsApp.
3. Clicar em Ativar automacoes.
4. Conferir na W-API se as URLs dos webhooks foram atualizadas.
```

## Como validar que ficou correto

Depois do redeploy:

1. Enviar uma mensagem direta para o WhatsApp da loja.
2. Ver logs da Vercel.
3. O log **nao** deve mais mostrar:

```text
Sem Firebase Admin
```

4. No Firebase Console, conferir se foram criados/atualizados documentos em:

```text
whatsapp_webhook_events
whatsapp_auto_reply_contacts
whatsapp_auto_replies
```

5. Testar tambem:

```text
Mensagem direta: deve responder conforme regra.
Status do WhatsApp: nao deve responder.
Grupo: nao deve responder.
Broadcast/canal: nao deve responder.
Mensagem enviada pelo proprio numero da loja: nao deve responder.
```

## Depois que Firebase Admin estiver ativo

Remover o fallback temporario do webhook que tenta responder sem Firebase Admin. Esse fallback foi criado para destravar a operacao, mas o caminho correto e persistir tudo via Firebase Admin.

Arquivos relacionados:

```text
src/lib/firebase-admin.ts
src/app/webhooks/wapi/route.ts
```

## Referencias oficiais

- Vercel Environment Variables: https://vercel.com/docs/environment-variables
- Vercel Deploy CLI: https://vercel.com/docs/cli/deploy
- Firebase Admin SDK setup: https://firebase.google.com/docs/admin/setup
