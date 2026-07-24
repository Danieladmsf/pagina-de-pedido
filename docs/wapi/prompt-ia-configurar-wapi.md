# Prompt para IA navegadora configurar W-API

Use este prompt em uma IA que vai navegar pelo painel e documentação da W-API.

```text
Você vai acessar o painel e a documentação da W-API para configurar uma integração SaaS multi-loja.

Objetivo principal:
preciso que cada nova conta/loja cadastrada no meu sistema crie automaticamente uma instância W-API real, exclusiva e isolada, para que cada loja conecte seu próprio número de WhatsApp via QR Code. As notificações de pedidos de uma loja nunca podem sair pelo WhatsApp de outra loja.

O que você deve verificar/configurar:

1. Acesse o painel da W-API.
2. Verifique se minha conta atual permite criar múltiplas instâncias via API.
3. Procure por “Custom integration”, “token integrador”, “pacote de instâncias”, “gestão via API” ou algo equivalente.
4. Confirme se tenho acesso ao endpoint documentado:

   POST https://api.w-api.app/v1/integrator/create-instance

5. Se houver um token integrador/API key específico para criar instâncias, localize onde ele é gerado.
6. Não exponha o token completo em mensagens. Mostre apenas os últimos 4 caracteres para confirmação.
7. Verifique se o trial de 7 dias permite apenas 1 instância ou se permite múltiplas instâncias.
8. Se for necessário contratar/liberar plano pago ou pacote de instâncias, informe o nome do plano, preço por instância e o que preciso aprovar.
9. Não faça pagamento, assinatura ou contratação sem minha confirmação explícita.
10. Se existir chat/suporte da W-API, pergunte exatamente:

“Preciso usar a W-API em um SaaS multi-loja. Cada nova loja cadastrada no meu sistema precisa criar automaticamente uma instância W-API exclusiva via API, com QR Code próprio e token próprio. Qual plano/token preciso liberar para usar o endpoint /v1/integrator/create-instance em produção?”

Dados técnicos do meu projeto:
- Cada loja é identificada por um uid/empresaId.
- Para cada loja, o sistema precisa salvar:
  - wapiInstanceId
  - token da instância
  - instanceName
  - status de conexão
  - QR Code
- O token da instância deve ficar criptografado no banco.
- O frontend não pode ver token puro.
- O backend precisa usar a API key/token integrador para criar instâncias.

Variáveis que preciso configurar no projeto/Vercel:
- WAPI_API_KEY = token integrador ou API key principal com permissão para criar instâncias
- WAPI_BASE_URL = https://api.w-api.app/v1
- WAPI_PUBLIC_BASE_URL = URL pública do meu sistema
- WAPI_WEBHOOK_SECRET = segredo interno para webhooks
- WAPI_TOKEN_ENCRYPTION_KEY = chave fixa forte para criptografar tokens das instâncias

No final, entregue um resumo com:
1. Se minha conta permite criar múltiplas instâncias automaticamente.
2. Qual endpoint correto deve ser usado.
3. Qual token devo usar no backend.
4. Se o trial é suficiente ou se preciso plano/pacote.
5. Quais passos faltam para deixar isso funcionando em produção.
```

