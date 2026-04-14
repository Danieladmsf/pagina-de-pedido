# Pronto Pedido - Cardápio Digital

Este é um sistema de cardápio digital completo com painel administrativo e pedidos em tempo real.

## Configurações do Firebase
- **Project ID:** studio-2243391254-75492
- **Serviços Ativos:** Authentication (Login), Firestore (Banco de Dados).

## Estrutura do Banco de Dados (Firestore)
- `/categories`: Categorias do cardápio.
- `/menuItems`: Produtos, preços e URLs das imagens.
- `/orders`: Pedidos dos clientes (contém nome, endereço e contato).
- `/roles_admin`: Permissões de acesso ao painel.

## Acessos
- **Cliente:** Página Inicial (`/`)
- **Administrador:** Painel de Controle (`/admin`) - Requer login em `/login`.

## Como usar as imagens
No painel Admin, você deve inserir o link (URL) da imagem. Você pode usar imagens hospedadas em serviços como Unsplash ou Picsum para testes.
