import { jsonError } from '@/lib/firebase-auth-rest';
import {
  ok,
  requireOperationalEmpresa,
  requireOperationalIntegration,
  requireOperationalMessageAccess,
  withAuth,
} from '@/app/wapi/_lib';
import { sendWapiDocumentMessage, sendWapiImageMessage, sendWapiTextMessage } from '@/lib/wapi/wapi.service';
import { saveWhatsAppMessageLog, saveWhatsAppMessageLogAdmin } from '@/lib/wapi/integration-store';
import { getOptionalAdminDb } from '@/lib/firebase-admin';
import { normalizeWapiPhone } from '@/lib/wapi/operator-access';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Reivindica de forma ATÔMICA o envio de uma notificação de pedido, no servidor.
// A trava do cliente (runTransaction) cai num fallback com corrida quando o
// streaming do Firestore está instável, então dois PCs/abas conseguiam enviar a
// mesma mensagem. O Admin SDK não sofre disso: .create() falha se o documento já
// existir, logo só o PRIMEIRO disparo de cada (pedido + tipo) passa. Retorna o ref
// para liberar a trava se o envio falhar (permite a re-tentativa da varredura),
// ou claimRef null quando não há dedupe (mensagem sem pedido, ou Admin ausente).
async function claimOrderNotification(empresaId: string, orderId?: string, type?: string) {
  if (!orderId || !type) return { duplicate: false, claimRef: null as any };
  const adminDb = getOptionalAdminDb();
  if (!adminDb) return { duplicate: false, claimRef: null as any };
  const claimRef = adminDb.collection('whatsapp_send_claims').doc(`${empresaId}_${orderId}_${type}`);
  try {
    // expireAt é um timestamp nativo: basta ligar a política de TTL nesse campo
    // (no console do Firestore) para a trava se autolimpar e a coleção não crescer.
    await claimRef.create({
      empresaId,
      orderId,
      type,
      createdAt: new Date().toISOString(),
      expireAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    });
    return { duplicate: false, claimRef };
  } catch {
    // Documento já existe → outro disparo já reivindicou esta mensagem.
    return { duplicate: true, claimRef: null as any };
  }
}

export async function POST(request: Request) {
  return withAuth(request, async (user) => {
    try {
      const body = await request.json();
      const access = await requireOperationalEmpresa(user, body.empresaId);
      const empresaId = access.empresaId;
      const phone = normalizeWapiPhone(body.phone);

      if (!phone) return ok({ error: 'Telefone obrigatorio.' }, 400);

      const delegatedMessage = await requireOperationalMessageAccess(access, {
        type: body.type,
        orderId: body.orderId,
        phone,
        hasDocument: Boolean(body.documentUrl),
        hasImage: Boolean(body.imageUrl),
      });
      const { integration, token } = await requireOperationalIntegration(access, user);

      // Trava anti-duplicidade — só para mensagens vinculadas a um pedido
      // (as notificações automáticas). Mensagens manuais/campanhas seguem livres.
      const orderId = delegatedMessage?.orderId || (body.orderId ? String(body.orderId) : undefined);
      const type = delegatedMessage?.messageType || (body.type ? String(body.type) : undefined);
      const { duplicate, claimRef } = await claimOrderNotification(empresaId, orderId, type);
      if (duplicate) return ok({ sent: false, duplicate: true });

      let result: any;
      let messagePreview = '';

      try {
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
          if (!message) {
            if (claimRef) { try { await claimRef.delete(); } catch { /* ignore */ } }
            return ok({ error: 'Mensagem obrigatoria.' }, 400);
          }
          result = await sendWapiTextMessage(integration.wapiInstanceId, token, {
            phone,
            message,
            delayMessage: Number(body.delayMessage || 3),
            messageId: body.messageId ? String(body.messageId) : undefined,
          });
          messagePreview = message;
        }
      } catch (sendError) {
        // Envio falhou: libera a trava para a varredura poder tentar de novo.
        if (claimRef) { try { await claimRef.delete(); } catch { /* ignore */ } }
        throw sendError;
      }

      try {
        const logData = {
          ownerId: empresaId,
          empresaId,
          actorUid: user.uid,
          phone,
          message: messagePreview.slice(0, 500),
          type: String(type || 'manual'),
          orderId,
          providerMessageId: result?.messageId,
          status: 'queued',
          payload: result,
        };
        if (access.role === 'operator') {
          await saveWhatsAppMessageLogAdmin(logData);
        } else {
          await saveWhatsAppMessageLog(user.idToken, logData);
        }
      } catch (logError) {
        console.warn('[W-API] Mensagem enviada, mas o log nao foi salvo:', logError);
      }

      return ok({ sent: true, result });
    } catch (error) {
      return jsonError(error);
    }
  });
}
