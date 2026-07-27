import { ApiError, jsonError } from '@/lib/firebase-auth-rest';
import { getWebhookUrl, ok, requireEmpresa, withAuth } from '@/app/wapi/_lib';
import {
  configureWapiWebhooks,
  extractWapiQrCode,
  getWapiConnectedPhone,
  getWapiQrCode,
  getWapiStatus,
  isWapiConnectedStatus,
} from '@/lib/wapi/wapi.service';
import {
  encryptWapiToken,
  findStoreUsingWapiInstance,
  getWhatsAppIntegration,
  sanitizeIntegration,
  saveWhatsAppIntegration,
  statusFromWapi,
} from '@/lib/wapi/integration-store';
import { WhatsAppIntegration } from '@/lib/wapi/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  return withAuth(request, async (user) => {
    try {
      const body = await request.json().catch(() => ({}));
      const empresaId = requireEmpresa(user, body.empresaId);
      
      const { wapiInstanceId, token, instanceName } = body;
      
      if (!wapiInstanceId || !token) {
        throw new ApiError(400, 'ID e Token da instancia sao obrigatorios.');
      }

      const outraLoja = await findStoreUsingWapiInstance(wapiInstanceId, empresaId);
      if (outraLoja) {
        throw new ApiError(409, 'Esta conexao de WhatsApp ja esta em uso por outra loja. Cada loja precisa da sua propria instancia — se duas dividirem a mesma, as mensagens de uma param de chegar.');
      }

      const existing = await getWhatsAppIntegration(empresaId, user.idToken);
      const now = new Date().toISOString();
      const webhookUrl = getWebhookUrl(request, empresaId, token);

      // VALIDA o par (ID, chave) antes de salvar qualquer coisa. A W-API responde
      // 404 quando o ID nao existe e 403 quando a chave nao e daquela instancia.
      // Antes so se conferia se os campos estavam preenchidos e a configuracao de
      // webhook (que engole todas as falhas) fazia as vezes de validacao — dava
      // para salvar um e-mail no campo "ID da instancia" e a tela dizia
      // "WhatsApp vinculado com sucesso".
      let statusResponse: any;
      try {
        statusResponse = await getWapiStatus(wapiInstanceId, token);
      } catch (error: any) {
        throw new ApiError(400, `Nao consegui acessar esta conexao na W-API. Confira o ID da instancia e a chave (os dois aparecem no painel da W-API). Detalhe: ${error?.message || 'sem resposta'}`);
      }

      const connected = isWapiConnectedStatus(statusResponse) || Boolean(getWapiConnectedPhone(statusResponse));
      const status = statusFromWapi(connected);
      const numeroWhatsapp = getWapiConnectedPhone(statusResponse);

      await configureWapiWebhooks(wapiInstanceId, token, webhookUrl);

      // O QR so e pedido quando a loja ainda nao esta conectada: /instance/qr-code
      // e a acao de PAREAR do W-API, e chama-la numa instancia ja conectada
      // derruba a sessao do celular.
      let qrCode = '';
      if (!connected) {
        try {
          qrCode = extractWapiQrCode(await getWapiQrCode(wapiInstanceId, token));
        } catch (error) {
          console.warn('[W-API] Link manual: QR inicial falhou:', error);
        }
      }

      const finalInstanceName = instanceName || `Loja vinculada - ${empresaId.slice(0, 10)}`;

      const integration: WhatsAppIntegration = {
        ownerId: user.uid,
        clienteId: user.uid,
        empresaId,
        provider: 'wapi',
        wapiInstanceId,
        wapiTokenEncrypted: encryptWapiToken(token),
        instanceName: finalInstanceName,
        status,
        connected,
        numeroWhatsapp,
        qrCode,
        webhookUrl,
        lastStatusAt: now,
        createdAt: existing?.createdAt || now,
        updatedAt: now,
      };

      await saveWhatsAppIntegration(empresaId, integration, user.idToken);

      return ok({
        integration: sanitizeIntegration(integration),
        qrCode,
      }, 201);
    } catch (error) {
      return jsonError(error);
    }
  });
}
