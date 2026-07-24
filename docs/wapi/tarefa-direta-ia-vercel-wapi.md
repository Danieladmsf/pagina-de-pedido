# Tarefa direta para IA: corrigir W-API na Vercel

Nao resuma este arquivo. Execute a tarefa.

## Objetivo

Fazer o webhook da W-API funcionar de forma correta em producao no projeto Vercel `polarispdv`, removendo a dependencia do fallback temporario.

O problema principal e que a producao esta sem Firebase Admin configurado.

## Resultado esperado

Ao final:

1. A Vercel deve ter `FIREBASE_SERVICE_ACCOUNT_KEY` configurada em **Production**.
2. Deve ter sido feito um novo deploy de producao.
3. Os logs da Vercel nao devem mais mostrar:

```text
Sem Firebase Admin
recebido sem Firebase Admin configurado
```

4. Ao receber mensagem direta no WhatsApp da loja, o sistema deve conseguir gravar eventos no Firestore.
5. O bot nao deve responder status, grupo, broadcast ou canal.

## Projeto

```text
Vercel project: polarispdv
Production URL: https://polarispdv.vercel.app
Firebase project: studio-2243391254-75492
```

## Passo 1: verificar variaveis na Vercel

No painel da Vercel:

```text
Project polarispdv
Settings
Environment Variables
Production
```

Verifique se existe:

```env
FIREBASE_SERVICE_ACCOUNT_KEY
```

Se nao existir, crie.

## Passo 2: se faltar FIREBASE_SERVICE_ACCOUNT_KEY

Peca ao usuario o JSON da conta de servico Firebase.

Mensagem direta para o usuario:

```text
Preciso do JSON da conta de servico do Firebase para configurar a Vercel.

Gere assim:
Firebase Console > projeto studio-2243391254-75492 > Project settings > Service accounts > Generate new private key.

Depois me envie o conteudo do arquivo JSON. Nao cole isso no GitHub.
```

Quando receber o JSON, adicionar na Vercel:

```env
FIREBASE_SERVICE_ACCOUNT_KEY=<JSON completo da conta de servico>
```

Ambiente:

```text
Production
```

Importante: o JSON pode ficar em uma unica linha. Se a Vercel aceitar multi-linha, tambem pode colar direto. O codigo faz `JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY)`.

## Passo 3: conferir variaveis essenciais

Estas variaveis precisam estar configuradas em **Production**:

```env
FIREBASE_SERVICE_ACCOUNT_KEY=<json_firebase_admin>
WAPI_API_KEY=<token_wapi>
WAPI_BASE_URL=https://api.w-api.app/v1
WAPI_PUBLIC_BASE_URL=https://polarispdv.vercel.app
NEXT_PUBLIC_APP_URL=https://polarispdv.vercel.app
WAPI_WEBHOOK_SECRET=<segredo_forte>
WAPI_INSTANCE_PLAN=lite
```

Se `WAPI_WEBHOOK_SECRET` ainda for `wapi-local-secret-2026`, trocar por um valor forte.

## Passo 4: nao mexer nesta variavel sem plano

Nao adicionar, remover ou trocar:

```env
WAPI_TOKEN_ENCRYPTION_KEY
```

Motivo: os tokens W-API salvos podem ter sido criptografados usando `WAPI_API_KEY`. Trocar a chave sem migracao pode quebrar a descriptografia.

## Passo 5: redeploy obrigatorio

Depois de criar ou alterar variaveis na Vercel, fazer deploy novo de producao.

Pelo terminal, se estiver autenticado:

```bash
npx vercel --prod --yes
```

Ou pelo painel:

```text
Vercel > Deployments > ultimo deployment > Redeploy
```

## Passo 6: reconfigurar webhooks da W-API

Depois do deploy:

1. Entrar no Polaris.
2. Ir em Admin > WhatsApp.
3. Clicar em **Ativar automacoes**.
4. Conferir no painel da W-API se as URLs dos webhooks estao assim:

```text
https://polarispdv.vercel.app/webhooks/wapi?secret=...&empresaId=...&wt=...
```

Se trocou `WAPI_WEBHOOK_SECRET`, as URLs precisam mostrar o novo `secret`.

## Passo 7: validar logs

Rodar:

```bash
npx vercel logs https://polarispdv.vercel.app --since 30m --expand --limit 100
```

Enviar uma mensagem direta para o WhatsApp da loja.

Nos logs, nao pode aparecer:

```text
Sem Firebase Admin
recebido sem Firebase Admin configurado
```

## Passo 8: validar Firestore

No Firebase Console, conferir se documentos estao sendo criados/atualizados em:

```text
whatsapp_webhook_events
whatsapp_auto_reply_contacts
whatsapp_auto_replies
```

Se essas colecoes aparecerem apos mensagem recebida, o Firebase Admin esta funcionando.

## Passo 9: testes obrigatorios

Teste 1:

```text
Enviar mensagem direta para o numero da loja.
Resultado esperado: bot responde conforme automacao.
```

Teste 2:

```text
Interagir com status do WhatsApp.
Resultado esperado: bot nao responde.
```

Teste 3:

```text
Enviar mensagem em grupo.
Resultado esperado: bot nao responde.
```

Teste 4:

```text
Enviar mensagem pelo proprio numero conectado.
Resultado esperado: bot nao responde.
```

## Passo 10: depois que Firebase Admin funcionar

Abrir PR/commit removendo o fallback temporario do arquivo:

```text
src/app/webhooks/wapi/route.ts
```

O webhook deve passar a depender de Firebase Admin para persistencia e controle de deduplicacao.

## Se ficar em duvida

Nao invente outro fallback.

O caminho correto e:

```text
Firebase Admin na Vercel + webhook W-API com wt + persistencia no Firestore
```
