/**
 * Tirar o celular da loja do ar sem perder o cadastro.
 *
 * Até 23/09/2026 o botão "Desconectar" deslogava o celular E apagava do
 * sistema o ID da instância e a chave. Para religar, a loja precisava desses
 * dados de novo, e quem os tem é o suporte. Na véspera, alguém desconectou a
 * Gostinho para "consertar" um silêncio que já tinha passado sozinho, e a loja
 * ficou mais de 5h fora do ar.
 *
 * Hoje desconectar é só o logout do celular: a sessão da loja continua no
 * servidor, e religar é ler o QR Code de novo. Não existe "remover" na tela: a
 * sessão é criada por nós, e apagá-la não resolve nada que ler o QR não resolva.
 */
import { logoutWuz } from '@/lib/wuzapi/wuzapi.service';
import { patchWhatsAppIntegration, statusDaConexao } from '@/lib/wapi/integration-store';
import type { WhatsAppIntegration } from '@/lib/wapi/types';

/**
 * Desloga o celular da loja e mantém o cadastro — ID, chave e endereço do
 * webhook continuam salvos.
 *
 * Sem `try` em volta do logout, de propósito: se o servidor não confirmou, o
 * celular continua conectado, e gravar "desconectado" mentiria para a tela.
 */
export async function desconectarCelular(params: {
  empresaId: string;
  integration: WhatsAppIntegration;
  token: string;
  idToken: string;
}) {
  await logoutWuz(params.integration.wapiInstanceId, params.token);

  return patchWhatsAppIntegration(
    params.empresaId,
    {
      connected: false,
      // O mesmo status que o poll de /wapi/status grava para quem não está
      // conectado; outro valor faria o selo da tela trocar sozinho segundos
      // depois.
      status: statusDaConexao(false),
      numeroWhatsapp: '',
      qrCode: '',
      lastError: '',
      lastStatusAt: new Date().toISOString(),
    },
    params.idToken,
  );
}
