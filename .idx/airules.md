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

- O WhatsApp das lojas roda no **servidor próprio**: WuzAPI na máquina `whatsapp-lojas` do Google Cloud (`https://35-237-85-231.sslip.io`). É o único provedor oficial desde 25/09/2026. Manual completo: `docs/wapi/servidor-proprio-wuzapi.md`.
- **Não integre, reative nem tente "consertar" W-API ou Z-API.** A Z-API foi removida do código. A W-API ainda aparece no código só como caminho de volta da migração e vai ser removida; não escreva código novo em cima dela.
- O código do servidor próprio está em `src/lib/wuzapi/`. Loja ligada nele tem ID de instância `WUZ-<LOJA>`.
- Nomes com "wapi" (pasta `src/lib/wapi`, rotas `/wapi/*` e `/webhooks/wapi`, campos `wapiInstanceId` e `wapiTokenEncrypted`) são nomes históricos: hoje atendem o servidor próprio. Não renomeie sem migrar junto o webhook registrado no servidor e os campos gravados no Firestore.
- Chaves nunca vão para o git. Ficam no `.env.local` da máquina de desenvolvimento e no `.env` do servidor (`/opt/wuzapi/.env`).
