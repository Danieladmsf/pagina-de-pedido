# Convenções do projeto

## Integridade de dados

- Todo vínculo entre coleções é persistido pelo ID completo do documento de destino. Texto, nome, telefone, título e prefixo servem apenas para busca ou exibição humana.
- Escritas novas podem manter o texto ao lado do ID para preservar contexto, mas nunca devem depender dele como chave.
- Fallback por texto existe somente para leitura de legado. Ele precisa ser explícito, testado e não pode escolher um destino quando houver zero ou mais de um candidato.
- Migrações não corrigem entrada humana por aproximação e não fundem registros automaticamente. Somente relações inequívocas podem receber backfill; conflitos ficam para decisão do dono.
- Exclusões precisam verificar histórico e referências de entrada. Registros com histórico são arquivados; referências existentes são mostradas e tratadas antes da exclusão.

Antes de alterar um contrato de vínculo, rode `npm run audit:integridade` e os testes relacionados.

