# W-API: criação automática de várias instâncias

Sim. A documentação/material público da W-API indica que é possível criar várias instâncias via API para conectar números diferentes, mas isso depende do tipo de conta/token liberado pela W-API.

## O que a documentação diz

A W-API descreve uma instância como um canal exclusivo que conecta um número de telefone ao WhatsApp. Se você precisa gerenciar vários números, o modelo correto é criar múltiplas instâncias, cada uma responsável por um número diferente.

Para um SaaS como este projeto:

```text
1 loja / conta cadastrada = 1 instância W-API exclusiva
```

Não é uma instância por cliente final do cardápio. A instância pertence à loja, porque é ela que representa o WhatsApp remetente das mensagens.

## Endpoint documentado para criar instância

Na coleção Postman da W-API, o endpoint de criação automática aparece como:

```http
POST https://api.w-api.app/v1/integrator/create-instance
Authorization: Bearer SEU_TOKEN_INTEGRADOR
Content-Type: application/json
```

Exemplo de corpo:

```json
{
  "instanceName": "Minha Instância",
  "rejectCalls": true,
  "callMessage": "Não estamos disponíveis no momento."
}
```

Exemplo de resposta:

```json
{
  "error": false,
  "message": "Instância criada e inicializada com sucesso.",
  "instanceId": "B6XYDH-N8QW4K-GJNFVU",
  "token": "ikfgrxlbIm234rrYZ7DPw5TLqiNjPnvlQ"
}
```

Esse `instanceId` e esse `token` precisam ser salvos separados para cada loja.

## Ponto importante sobre o trial de 7 dias

O site da W-API informa que o teste grátis dá 7 dias em uma instância gratuita. Então, no trial comum, provavelmente você consegue testar uma instância real, mas não criar várias instâncias automaticamente para várias lojas.

Para o seu caso de produção, você precisa pedir/liberar com a W-API um modelo de:

```text
token integrador
pacote de instâncias
criação e gestão de instâncias via API
```

Esse é o modelo correto para um SaaS onde cada nova loja cadastrada cria uma instância automaticamente.

## Como isso deve funcionar no projeto

Fluxo esperado:

```text
1. Lojista cria conta no sistema.
2. Backend chama a W-API para criar uma nova instância.
3. W-API retorna instanceId e token.
4. Sistema salva os dados da instância em roles_admin/{uid}.whatsappIntegration.
5. Lojista abre a aba WhatsApp e escaneia o QR Code daquela instância.
6. Pedidos dessa loja enviam notificações usando apenas essa instância.
```

## Ajuste técnico no projeto

A documentação atual encontrada aponta para:

```text
/v1/integrator/create-instance
```

O projeto foi ajustado para usar esse endpoint por padrão com autenticação:

```text
Authorization: Bearer WAPI_API_KEY
```

Caso a W-API altere a rota, use `WAPI_CREATE_INSTANCE_PATH` no ambiente.

## Fontes

- Criar instância na coleção Postman da W-API:
  https://www.postman.com/w-api/w-api-api-do-whatsapp/request/9vfbdnx/criar-instncia

- Custom integration W-API:
  https://www.postman.com/w-api/w-api-api-do-whatsapp/folder/x9w6u0y/custom-integration

- Site W-API com planos, instâncias e trial:
  https://www.w-api.app/
