/**
 * Os dois jeitos de tirar o WhatsApp da loja do ar, e por que são dois.
 *
 * Até 23/09/2026 havia um só: o botão "Desconectar" deslogava o celular E
 * apagava do sistema o ID da instância e a chave. Para religar, a loja
 * precisava desses dados de novo, e quem os tem é o suporte. Na véspera, alguém
 * desconectou a Gostinho para "consertar" um silêncio que já tinha passado
 * sozinho, e a loja ficou mais de 5h fora do ar.
 *
 * - `desconectarCelular`: só o logout do celular. O cadastro fica, e religar é
 *   ler o QR Code de novo, sem suporte.
 * - `removerIntegracao`: logout + apaga o cadastro. Religar exige pedir ao
 *   suporte o ID e a chave da instância. É o botão separado, com aviso.
 */
import { disconnectWapiInstance } from '@/lib/wapi/wapi.service';
import {
  decryptWapiToken,
  deleteWhatsAppIntegration,
  getWhatsAppIntegration,
  isBlockedSharedWapiInstance,
  patchWhatsAppIntegration,
  statusFromWapi,
} from '@/lib/wapi/integration-store';
import type { WhatsAppIntegration } from '@/lib/wapi/types';

/**
 * Desloga o celular da loja e mantém o cadastro — ID, chave e endereço do
 * webhook continuam salvos.
 *
 * Sem `try` em volta do logout, de propósito: se a W-API não confirmou, o
 * celular continua conectado, e gravar "desconectado" mentiria para a tela.
 */
export async function desconectarCelular(params: {
  empresaId: string;
  integration: WhatsAppIntegration;
  token: string;
  idToken: string;
}) {
  await disconnectWapiInstance(params.integration.wapiInstanceId, params.token);

  return patchWhatsAppIntegration(
    params.empresaId,
    {
      connected: false,
      // O mesmo status que o poll de /wapi/status grava para quem não está
      // conectado; outro valor faria o selo da tela trocar sozinho segundos
      // depois.
      status: statusFromWapi(false),
      numeroWhatsapp: '',
      qrCode: '',
      lastError: '',
      lastStatusAt: new Date().toISOString(),
    },
    params.idToken,
  );
}

/**
 * Desloga o celular (se der) e apaga o cadastro do WhatsApp da loja.
 *
 * O logout é tentativa: remover precisa funcionar justamente quando a
 * instância está quebrada — chave que não abre, instância apagada na W-API.
 * Instância de teste compartilhada nunca é deslogada daqui, para não derrubar
 * as outras lojas que apontam para ela.
 */
export async function removerIntegracao(empresaId: string, idToken: string) {
  const integration = await getWhatsAppIntegration(empresaId, idToken);

  if (integration?.wapiInstanceId && !isBlockedSharedWapiInstance(integration.wapiInstanceId)) {
    try {
      await disconnectWapiInstance(integration.wapiInstanceId, decryptWapiToken(integration));
    } catch (error) {
      console.warn('[W-API] Falha ao desconectar da W-API antes de remover (a instância pode estar inativa ou a chave pode ter mudado):', error);
    }
  }

  await deleteWhatsAppIntegration(empresaId, idToken);
}
