// Marcador local de "esta máquina já entrou com uma conta de verdade".
//
// Existe por causa da página inicial: ela é a vitrine do produto (precisa sair
// pronta do servidor, para o Google), mas quem já trabalha na loja não pode ver
// a vitrine piscando toda vez que abre o site. O Firebase só diz se há sessão
// depois de ler o IndexedDB, o que leva alguns instantes; este marcador é a
// resposta síncrona que evita esse piscar.
//
// Não é credencial nem controle de acesso: quem tem o marcador sem sessão real
// é mandado ao login pelo guard de sempre.
export const CHAVE_SESSAO_LOCAL = 'polaris:sessao';

export function marcarSessaoLocal(existe: boolean) {
  try {
    if (existe) localStorage.setItem(CHAVE_SESSAO_LOCAL, '1');
    else localStorage.removeItem(CHAVE_SESSAO_LOCAL);
  } catch {
    // navegador com armazenamento bloqueado: só perde o atalho, nada quebra
  }
}

export function temSessaoLocal() {
  try {
    return localStorage.getItem(CHAVE_SESSAO_LOCAL) === '1';
  } catch {
    return false;
  }
}
