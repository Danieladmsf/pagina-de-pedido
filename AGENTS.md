# Convenções do projeto

> Este texto tem cópias idênticas em `CLAUDE.md`, `AGENTS.md`, `GEMINI.md` e
> `.idx/airules.md`, uma para cada assistente de IA. Mude os quatro juntos.

## Integridade de dados

- Todo vínculo entre coleções é persistido pelo ID completo do documento de destino. Texto, nome, telefone, título e prefixo servem apenas para busca ou exibição humana.
- Escritas novas podem manter o texto ao lado do ID para preservar contexto, mas nunca devem depender dele como chave.
- Fallback por texto existe somente para leitura de legado. Ele precisa ser explícito, testado e não pode escolher um destino quando houver zero ou mais de um candidato.
- Migrações não corrigem entrada humana por aproximação e não fundem registros automaticamente. Somente relações inequívocas podem receber backfill; conflitos ficam para decisão do dono.
- Exclusões precisam verificar histórico e referências de entrada. Registros com histórico são arquivados; referências existentes são mostradas e tratadas antes da exclusão.

Antes de alterar um contrato de vínculo, rode `npm run audit:integridade` e os testes relacionados.

## WhatsApp das lojas

- O WhatsApp das lojas roda no **servidor próprio**: WuzAPI na máquina `whatsapp-lojas` do Google Cloud (`https://35-237-85-231.sslip.io`). É o único provedor desde 25/09/2026. Manual completo: `docs/wapi/servidor-proprio-wuzapi.md`.
- **Não integre, reative nem tente "consertar" W-API ou Z-API.** As duas foram removidas do código em 25/09/2026; o que sobrou delas é só documento histórico em `docs/wapi/historico-w-api/`.
- O cliente do servidor está em `src/lib/wuzapi/` (`wuzapi.service.ts` fala com o servidor, `incoming.ts` lê o webhook). A sessão de cada loja é criada pelo sistema (`/wapi/create-instance`, ID `WUZ-<empresaId>`): a dona só lê o QR Code, não há ID nem chave para digitar.
- Nomes com "wapi" (pasta `src/lib/wapi`, rotas `/wapi/*` e `/webhooks/wapi`, campos `wapiInstanceId` e `wapiTokenEncrypted`, variáveis `WAPI_*`) são nomes históricos: hoje atendem o servidor próprio. Não renomeie sem migrar junto o webhook registrado no servidor e os campos gravados no Firestore.
- Chaves nunca vão para o git. Ficam no `.env.local` da máquina de desenvolvimento e no `.env` do servidor (`/opt/wuzapi/.env`); a produção lê o endereço e a chave de admin do servidor em `app_config/wuzapi` (a chave de admin, cifrada).
- **Não apague variáveis `WAPI_*` da Vercel achando que são da W-API.** `WAPI_WEBHOOK_SECRET`, `WAPI_TOKEN_ENCRYPTION_KEY` e `WAPI_PUBLIC_BASE_URL` estão em uso (webhook, cifra das chaves das lojas, link de contato do cardápio, campanhas e vigia). Lista completa em `docs/wapi/servidor-proprio-wuzapi.md`.
