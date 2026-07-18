import { redirect } from 'next/navigation';

// A antiga página única do painel foi dividida em duas rotas:
//   /pdv    → frente de caixa (Caixa, Delivery, Balcão, Mesa, Encomendas)
//   /gestao → retaguarda (Dashboard, Produtos, Clientes, Campanhas, Perfil...)
// A raiz manda para o PDV, que é a tela do dia a dia; links antigos seguem
// funcionando. O guard de autenticação mora em (sistema)/layout.tsx.
export default function Home() {
  redirect('/pdv');
}
