

# Pronto Pedido - Cardápio Digital (Multi-Lojista)

Este é um sistema de cardápio digital completo com painel administrativo, suporte a múltiplas lojas (multi-tenancy) e pedidos em tempo real.

## 🌐 Links do Projeto (Vercel)
- **Cardápio Público:** [https://pagina-de-pedido.vercel.app/](https://pagina-de-pedido.vercel.app/)
- **Painel Administrativo:** [https://pagina-de-pedido.vercel.app/admin](https://pagina-de-pedido.vercel.app/admin)

## 🚀 Como enviar atualizações para o GitHub
Sempre que você fizer uma alteração e quiser que ela apareça no site do Vercel, rode estes comandos no seu terminal:

```bash
git add .
git commit -m "Minha atualização"
git push origin main
```

## 🛠️ Configurações do Firebase
- **Project ID:** studio-2243391254-75492
- **Serviços:** Authentication e Firestore.

## 🏢 Sistema Multi-Lojista
1. **Cadastro:** O lojista se cadastra em `/register`.
2. **Link da Loja:** O link que ele divulga para os clientes é `https://pagina-de-pedido.vercel.app/?s=ID_DA_LOJA`.
3. **Isolamento:** Cada lojista gerencia apenas seus produtos e vê apenas seus pedidos.

## 📂 Estrutura do Banco
- `/roles_admin/{userId}`: Define o lojista e o nome da sua loja.
- `/categories`: Filtradas por `ownerId`.
- `/menuItems`: Filtrados por `ownerId`.
- `/orders`: Filtrados por `ownerId`.
