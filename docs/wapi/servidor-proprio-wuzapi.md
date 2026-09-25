# Servidor próprio de WhatsApp (WuzAPI)

No ar desde 25/09/2026. Substitui a W-API nas lojas migradas (Lima Limão e
Gostinho de Céu). Motivo: naquele dia a W-API derrubou as duas lojas às 10:25 e
não conseguia gerar QR nem pelo próprio painel ("Erro ao conectar cliente"),
enquanto a Z-API gerava na hora; a Z-API custa R$ 99,99 por loja. O servidor
próprio roda na máquina gratuita do Google Cloud e atende várias lojas.

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
`WUZAPI_GLOBAL_HMAC_KEY` e um `WUZAPI_TOKEN_<LOJA>` por loja. A produção lê o
endereço do servidor em `app_config/wuzapi.baseUrl` (ou da variável
`WUZAPI_URL`, se um dia for criada na Vercel).

## Como o sistema escolhe o provedor

A integração da loja (`roles_admin/{loja}.whatsappIntegration`) guarda um ID de
instância, e o formato dele escolhe o provedor:

| ID | Provedor | Código |
|---|---|---|
| `LITE-...` / `PRO-...` | W-API | `lib/wapi` |
| 32 caracteres hexadecimais | Z-API | `lib/zapi` |
| `WUZ-<LOJA>` | servidor próprio | `lib/wuzapi` |

As funções de rede de `lib/wapi/wapi.service.ts` desviam no começo para o
provedor certo e devolvem o mesmo formato, então rotas, vigia, campanhas e telas
não mudam. A rota `/webhooks/wapi` reconhece o evento de cada provedor pelo
formato e usa o leitor dele (`lib/wuzapi/incoming.ts` para o servidor próprio).

Diferenças do servidor próprio que o código já trata:

- imagem e documento vão em base64 (o link do logo é baixado); imagem fora de
  PNG/JPEG vai só como texto;
- o QR só existe com a sessão aberta, e pedir QR abre a sessão;
- queda do socket (`Disconnected`) não derruba a loja, só `LoggedOut`;
- o servidor reenvia o webhook que falhou (5 vezes, a cada 30 s).

Na aba WhatsApp, loja do servidor próprio não mostra ID, "Trocar ID e chave"
nem "Remover integração", e o QR abre sozinho quando não há celular conectado.

## Passar uma loja para o servidor próprio

1. Criar a sessão da loja no servidor: `node scratch/wuzapi-configurar.mjs`
   (acrescente a loja na lista; é idempotente e grava a chave no `.env.local`).
2. Ligar a loja, de um destes jeitos:
   - pela aba WhatsApp da loja: "Trocar ID e chave" com `WUZ-<LOJA>` e a chave;
   - por script, como foi feito com Lima e Gostinho
     (`scratch/trocar-*-servidor-proprio.mjs`): guarda cópia do cadastro, sai
     da W-API, registra o webhook com o mesmo endereço e segredo que a produção
     já usa e grava a integração em `pending_qr`.
3. A dona abre a aba WhatsApp e lê o QR, que aparece sozinho.

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
