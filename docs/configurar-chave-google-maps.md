# Configurar chave server-side do Google Maps

Use estas orientacoes para resolver o erro do Google Places:

```text
Requests to this API places.googleapis.com method google.maps.places.v1.Places.AutocompletePlaces are blocked.
```

## Projeto correto

```text
studio-2243391254-75492
```

## 1. Abrir o Cloud Shell

Acesse:

```text
https://console.cloud.google.com/home/dashboard?project=studio-2243391254-75492
```

Clique no icone de terminal no canto superior direito do Google Cloud Console.

## 2. Executar os comandos

Cole no Cloud Shell:

```bash
PROJECT_ID=studio-2243391254-75492

gcloud config set project $PROJECT_ID

gcloud services enable \
  apikeys.googleapis.com \
  places.googleapis.com \
  distance-matrix-backend.googleapis.com \
  --project=$PROJECT_ID

gcloud services api-keys create \
  --project=$PROJECT_ID \
  --display-name="Server key - Maps" \
  --api-target=service=places.googleapis.com \
  --api-target=service=distance-matrix-backend.googleapis.com
```

## 3. Se a chave nao aparecer

Execute:

```bash
KEY_NAME=$(gcloud services api-keys list \
  --project=$PROJECT_ID \
  --filter='displayName="Server key - Maps"' \
  --format='value(name)' \
  --limit=1)

gcloud services api-keys get-key-string "$KEY_NAME" --project=$PROJECT_ID
```

## 4. Configurar no projeto local

No arquivo `.env.local`, adicione:

```env
GOOGLE_MAPS_SERVER_API_KEY=SUA_CHAVE_AQUI
```

Depois reinicie o servidor local do Next.js.

Importante: nunca cole a chave real em arquivos versionados. Use somente `.env.local`, que deve ficar fora do Git.

## 5. Configurar na Vercel

Na Vercel, adicione a mesma variavel de ambiente:

```env
GOOGLE_MAPS_SERVER_API_KEY=SUA_CHAVE_AQUI
```

Depois faca um novo deploy.

## Observacoes importantes

- Nao envie essa chave em chat, print ou mensagem.
- Se a chave for exposta em chat, print, commit ou historico publico, exclua a chave no Google Cloud e crie outra.
- Essa chave deve ser usada no servidor, nao diretamente no navegador.
- A chave antiga criada automaticamente pelo Firebase pode continuar existindo, mas nao e ideal para chamadas server-side do Places.
