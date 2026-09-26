# Servidor próprio de WhatsApp (WuzAPI)

No ar desde 25/09/2026 e único provedor do sistema: o código da W-API e da
Z-API foi removido no mesmo dia. Motivo da troca: naquele dia a W-API derrubou
as duas lojas às 10:25 e não conseguia gerar QR nem pelo próprio painel ("Erro
ao conectar cliente"), enquanto a Z-API gerava na hora; a Z-API custa R$ 99,99
por loja. O servidor próprio roda na máquina gratuita do Google Cloud e atende
várias lojas.

## Onde está

| Item | Valor |
|---|---|
| Nuvem | Google Cloud, projeto `studio-2243391254-75492` (o mesmo do Firebase) |
| Máquina | `whatsapp-lojas`, e2-micro (plano gratuito), zona `us-east1-b`, Ubuntu 24.04, disco pd-standard 30 GB, 2 GB de swap |
| IP | 35.237.85.231 |
| Endereço | `https://35-237-85-231.sslip.io` (Caddy com certificado Let's Encrypt; o sslip.io resolve o IP escrito no nome) |
| Firewall | regra `whatsapp-lojas-web` (80 e 443) + SSH padrão |
| Motor | WuzAPI (`asternic/wuzapi`), Go sobre whatsmeow, sem navegador |
| Custo | R$ 0 (uma e2-micro por conta de cobrança; tráfego pequeno) |

No celular da loja o aparelho aparece como **"Polaris PDV"** em Aparelhos
conectados.

## Acesso

```bash
ssh -i ~/.ssh/cardapio_whatsapp whatsapp@35.237.85.231
cd /opt/wuzapi
sudo docker compose ps
sudo docker compose logs --tail=50 wuzapi
```

Arquivos em `/opt/wuzapi`: `docker-compose.yml`, `Caddyfile`, `.env` (chaves,
permissão 600), `data/` (banco SQLite e sessões do WhatsApp), `backups/`.

**Chaves:** nunca no git. Ficam no `.env` do servidor e numa cópia no
`.env.local` da máquina de desenvolvimento: `WUZAPI_URL`, `WUZAPI_ADMIN_TOKEN`,
`WUZAPI_GLOBAL_ENCRYPTION_KEY` (sem ela o banco não abre num servidor novo),
`WUZAPI_GLOBAL_HMAC_KEY` e um `WUZAPI_TOKEN_<LOJA>` para as sessões criadas à
mão (TESTE, GOSTINHO, LIMA). A produção lê em `app_config/wuzapi` o endereço
do servidor (`baseUrl`) e a chave de admin cifrada com a
`WAPI_TOKEN_ENCRYPTION_KEY` (`adminTokenEncrypted`, gravada por
`scratch/wuzapi-guardar-admin.mjs`); as variáveis `WUZAPI_URL` e
`WUZAPI_ADMIN_TOKEN`, se um dia forem criadas na Vercel, têm prioridade. A
chave de cada loja fica cifrada no cadastro dela (`wapiTokenEncrypted`).

## Variáveis na Vercel

Os nomes começam com `WAPI_` por história, mas a maioria segue em uso com o
servidor próprio. **Não apague achando que são da W-API.**

| Variável | Uso hoje | Pode sair? |
|---|---|---|
| `WAPI_WEBHOOK_SECRET` | senha na URL do webhook que o servidor próprio chama | não |
| `WAPI_TOKEN_ENCRYPTION_KEY` | cifra a chave de cada loja no Firestore, o `wt` do webhook, a chave de admin em `app_config/wuzapi` e o código do link de contato | não (sem ela as lojas param) |
| `WAPI_PUBLIC_BASE_URL` | endereço público para o vigia e para as campanhas agendadas | não |
| `QSTASH_TOKEN`, `QSTASH_CURRENT_SIGNING_KEY`, `QSTASH_NEXT_SIGNING_KEY` | agenda do vigia e das campanhas | não |
| `FIREBASE_SERVICE_ACCOUNT_KEY` | acesso do servidor ao Firestore | não |
| `WAPI_BASE_URL`, `WAPI_API_KEY` | eram da W-API; nenhum código lê desde 25/09/2026 | sim |

`WAPI_API_KEY` também servia de chave reserva para decifrar. Antes de tirar,
foi conferido nos dados que tudo o que está cifrado (chave das duas lojas, `wt`
do webhook e chave de admin) abre só com a `WAPI_TOKEN_ENCRYPTION_KEY`. Para
trocar essa chave um dia, a antiga vai para `WAPI_TOKEN_ENCRYPTION_KEY_LEGACY`
(ver `src/lib/wapi/crypto.ts`).

O endereço do servidor próprio não precisa de variável: vem de
`app_config/wuzapi.baseUrl` (a variável `WUZAPI_URL`, se criada, tem prioridade).
Renomear uma variável exige criar a nova, publicar o código que lê as duas,
registrar de novo o webhook das lojas e só então apagar a antiga.

## No código

A integração da loja fica em `roles_admin/{loja}.whatsappIntegration`, com
`provider: 'wuzapi'`, o ID da sessão (`wapiInstanceId`, "WUZ-...") e a chave
cifrada (`wapiTokenEncrypted`). O ID é só rótulo nosso: o servidor reconhece a
loja pela chave.

- `src/lib/wuzapi/wuzapi.service.ts`: tudo o que fala com o servidor (status,
  QR, logout, webhook, envios, foto de perfil e `criarSessaoDaLoja`).
- `src/lib/wuzapi/incoming.ts`: lê o webhook (`{ type, event }`) e decide
  conexão, mensagem de cliente, reação no story e o que a dona digitou.
- Rotas `/wapi/*` (tela, PDV, campanhas) e `/webhooks/wapi` (o servidor chama);
  o vigia do recebimento em `src/lib/wapi/webhook-watchdog.ts`.

A W-API foi o provedor até 25/09/2026 e a Z-API foi integrada e removida no
mesmo dia; o código das duas saiu do sistema.

Particularidades do servidor que o código já trata:

- imagem e documento vão em base64 (o link do logo é baixado); imagem fora de
  PNG/JPEG vai só como texto;
- o QR só existe com a sessão aberta, e pedir QR abre a sessão (sessão já
  pareada devolve QR vazio: pedir QR não derruba celular conectado);
- queda do socket (`Disconnected`) não derruba a loja, só `LoggedOut`;
- depois do logout o servidor continua devolvendo o número do último
  pareamento: conectado é só `loggedIn`, nunca "tem número";
- o servidor reenvia o webhook que falhou (5 vezes, a cada 30 s).

## Como uma loja ganha o WhatsApp

Sozinha. O cadastro de loja nova chama `/wapi/create-instance`, que cria a
sessão da loja no servidor (nome `WUZ-<empresaId>`, com a chave de admin),
registra o webhook e grava o cadastro em "aguardando conexão". Se isso falhar,
a aba WhatsApp mostra o botão **Conectar WhatsApp**, que faz o mesmo. Pedir de
novo não cria outra sessão: a existente é achada pelo nome.

Na aba WhatsApp a dona só lê o QR Code, que abre sozinho quando não há celular
conectado. Não há ID nem chave para digitar, e não existe "Remover integração":
**Desconectar celular** desloga o aparelho e mantém a sessão, e religar é ler o
QR de novo.

Lima Limão e Gostinho de Céu foram migradas da W-API por script em 25/09/2026
(`scratch/trocar-*-servidor-proprio.mjs`); as sessões delas foram criadas à mão
(`scratch/wuzapi-configurar.mjs`) e têm nome `WUZ-LIMA` e `WUZ-GOSTINHO`.

## Manutenção

- **Atualizar a WuzAPI:** `sudo docker compose pull && sudo docker compose up -d`.
  As sessões ficam em `data/`, ninguém precisa ler o QR de novo.
- **Cópia:** `/etc/cron.d/wuzapi-backup` roda `/opt/wuzapi/backup.sh` às 04:30
  UTC e guarda 7 dias em `backups/` (`data/` + `.env`). É no mesmo disco:
  protege de banco corrompido, não de perder a máquina. Próximo passo: agenda
  de snapshot do disco no Google Cloud.
- **Loja parou de receber:** conferir `docker compose ps` e os logs; depois
  `GET /session/status` com a chave da loja (cabeçalho `token`). A tela da
  loja mostra o QR sozinha se a sessão tiver caído.
- **Memória em repouso:** WuzAPI ~40 MB, Caddy ~17 MB.
