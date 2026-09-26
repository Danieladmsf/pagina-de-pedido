import { jsonError } from '@/lib/firebase-auth-rest';
import { getWebhookUrl, ok, requireEmpresa, withAuth } from '@/app/wapi/_lib';
import { configurarWebhook, criarSessaoDaLoja } from '@/lib/wuzapi/wuzapi.service';
import {
  encryptWapiToken,
  getWhatsAppIntegration,
  sanitizeIntegration,
  saveWhatsAppIntegration,
  statusDaConexao,
} from '@/lib/wapi/integration-store';
import type { WhatsAppIntegration } from '@/lib/wapi/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Prepara o WhatsApp da loja no servidor próprio: cria a sessão dela (ou acha a
 * que já existe) e grava o cadastro em "aguardando conexão". Chamada pelo
 * cadastro de loja nova e pelo botão "Conectar WhatsApp" da aba; depois disso a
 * dona só lê o QR Code.
 *
 * Idempotente: loja com cadastro recebe o que está salvo, e a sessão no servidor
 * é achada pelo nome ("WUZ-<empresaId>") em vez de criada de novo.
 */
export async function POST(request: Request) {
  return withAuth(request, async (user) => {
    try {
      const body = await request.json().catch(() => ({}));
      const empresaId = requireEmpresa(user, body.empresaId);

      const existing = await getWhatsAppIntegration(empresaId, user.idToken);
      if (existing?.wapiInstanceId && existing?.wapiTokenEncrypted) {
        return ok({ integration: sanitizeIntegration(existing), alreadyConfigured: true });
      }

      const instanceId = `WUZ-${empresaId}`;
      const { token } = await criarSessaoDaLoja(instanceId);
      const webhookUrl = getWebhookUrl(request, empresaId, token);

      // O webhook é tentativa aqui: se falhar, o cadastro sai sem `webhookUrl` e
      // o poll de status da aba registra de novo (ele compara com a URL salva).
      let webhookRegistrado = false;
      try {
        await configurarWebhook(token, webhookUrl);
        webhookRegistrado = true;
      } catch (error) {
        console.warn('[WhatsApp] Sessao criada, mas o webhook nao foi registrado:', { empresaId, error });
      }

      const now = new Date().toISOString();
      const instanceName = String(body.instanceName || body.storeName || '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 80);

      const integration: WhatsAppIntegration = {
        ownerId: user.uid,
        clienteId: user.uid,
        empresaId,
        provider: 'wuzapi',
        wapiInstanceId: instanceId,
        wapiTokenEncrypted: encryptWapiToken(token),
        instanceName: instanceName || 'Loja',
        status: statusDaConexao(false),
        connected: false,
        numeroWhatsapp: '',
        qrCode: '',
        ...(webhookRegistrado ? { webhookUrl } : {}),
        lastStatusAt: now,
        createdAt: existing?.createdAt || now,
        updatedAt: now,
      };

      await saveWhatsAppIntegration(empresaId, integration, user.idToken);

      return ok({ integration: sanitizeIntegration(integration) }, 201);
    } catch (error) {
      return jsonError(error);
    }
  });
}
