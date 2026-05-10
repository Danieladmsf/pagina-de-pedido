import { jsonError } from '@/lib/firebase-auth-rest';
import { ok, requireEmpresa, requireIntegration, withAuth } from '@/app/wapi/_lib';
import { sendWapiDocumentMessage, sendWapiImageMessage, sendWapiTextMessage } from '@/lib/wapi/wapi.service';
import { saveWhatsAppMessageLog } from '@/lib/wapi/integration-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function normalizePhone(phone: string) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('55')) return digits;
  return `55${digits}`;
}

export async function POST(request: Request) {
  return withAuth(request, async (user) => {
    try {
      const body = await request.json();
      const empresaId = requireEmpresa(user, body.empresaId);
      const phone = normalizePhone(body.phone);

      if (!phone) return ok({ error: 'Telefone obrigatorio.' }, 400);

      const { integration, token } = await requireIntegration(empresaId, user.idToken);
      let result: any;
      let messagePreview = '';

      if (body.documentUrl) {
        result = await sendWapiDocumentMessage(integration.wapiInstanceId, token, {
          phone,
          document: String(body.documentUrl),
          extension: String(body.extension || 'pdf'),
          fileName: body.fileName ? String(body.fileName) : undefined,
          caption: body.caption ? String(body.caption) : undefined,
          delayMessage: Number(body.delayMessage || 3),
        });
        messagePreview = body.caption || body.fileName || 'Documento enviado';
      } else if (body.imageUrl) {
        result = await sendWapiImageMessage(integration.wapiInstanceId, token, {
          phone,
          image: String(body.imageUrl),
          caption: body.caption ? String(body.caption) : undefined,
          delayMessage: Number(body.delayMessage || 3),
        });
        messagePreview = body.caption || 'Imagem enviada';
      } else {
        const message = String(body.message || '').trim();
        if (!message) return ok({ error: 'Mensagem obrigatoria.' }, 400);
        result = await sendWapiTextMessage(integration.wapiInstanceId, token, {
          phone,
          message,
          delayMessage: Number(body.delayMessage || 3),
          messageId: body.messageId ? String(body.messageId) : undefined,
        });
        messagePreview = message;
      }

      try {
        await saveWhatsAppMessageLog(user.idToken, {
          ownerId: user.uid,
          empresaId,
          phone,
          message: messagePreview.slice(0, 500),
          type: String(body.type || 'manual'),
          orderId: body.orderId ? String(body.orderId) : undefined,
          providerMessageId: result?.messageId,
          status: 'queued',
          payload: result,
        });
      } catch (logError) {
        console.warn('[W-API] Mensagem enviada, mas o log nao foi salvo:', logError);
      }

      return ok({ sent: true, result });
    } catch (error) {
      return jsonError(error);
    }
  });
}
