
# Pronto Pedido - Cardápio Digital (Multi-Lojista)

Este é um sistema de cardápio digital completo com painel administrativo, suporte a múltiplas lojas (multi-tenancy) e pedidos em tempo real.

## 🚀 Como enviar para o GitHub (Passo a Passo)

Siga estes passos no seu terminal dentro da pasta do projeto:

1. **Crie um repositório vazio** no seu [GitHub](https://github.com/new). Não adicione README ou licença lá (deixe-o vazio).
2. **Copie o link do repositório** (ex: `https://github.com/SEU_USUARIO/NOME_DO_REPOSITORIO.git`).
3. **Abra o terminal** na pasta deste projeto e cole estes comandos:

```bash
# Inicializa o git localmente
git init

# Adiciona todos os arquivos (o .gitignore vai filtrar o lixo)
git add .

# Cria o primeiro registro das suas mudanças
git commit -m "Primeiro commit: Sistema Multi-loja Pronto Pedido"

# Define o nome da sua branch principal
git branch -M main

# CONECTA AO SEU LINK (Substitua o link abaixo pelo SEU link do GitHub)
git remote add origin https://github.com/SEU_USUARIO/NOME_DO_REPOSITORIO.git

# ENVIA OS ARQUIVOS
git push -u origin main
```

## 🛠️ Configurações do Firebase
- **Project ID:** studio-2243391254-75492
- **Serviços:** Authentication (Login/Cadastro) e Firestore (Banco de Dados).

## 🏢 Sistema Multi-Lojista (Como usar)

Agora o sistema permite que você tenha vários clientes (donos de lojas) usando a mesma plataforma:

1. **Cadastro de Novo Lojista:** Envie o link `/register` para o seu cliente.
2. **Painel Admin:** Ao se cadastrar, ele terá acesso ao `/admin` para gerenciar apenas os produtos **dele**.
3. **Link do Cardápio:** No painel dele, haverá um link como `?s=ID_DA_LOJA`. Esse é o link que ele deve divulgar.
4. **Isolamento:** Os pedidos feitos no cardápio dele aparecerão apenas no painel dele.

## 📂 Estrutura do Banco (Firestore)
- `/roles_admin/{userId}`: Define quem é administrador e o nome da loja.
- `/categories`: Categorias filtradas por `ownerId`.
- `/menuItems`: Produtos filtrados por `ownerId`.
- `/orders`: Pedidos filtrados por `ownerId`.

## 🔐 Segurança
As regras do Firestore já estão configuradas para que:
- Lojistas só vejam seus próprios dados.
- Clientes só vejam seus próprios pedidos.
- O acesso ao `/admin` seja bloqueado para quem não é lojista cadastrado.
