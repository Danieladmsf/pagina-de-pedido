import { jsonError } from '@/lib/firebase-auth-rest';
import { getWebhookUrl, ok, requireOperationalEmpresa, withAuth } from '@/app/wapi/_lib';
import { getOptionalAdminDb } from '@/lib/firebase-admin';
import { getWhatsAppIntegrationAdmin } from '@/lib/wapi/integration-store';
import { getStoreOpenState } from '@/lib/whatsapp-messages';
import { avaliarSaudeDoWebhook, descreverSilencio } from '@/lib/wapi/webhook-health';
import { vigiarRecebimentoDaLoja } from '@/lib/wapi/webhook-watchdog';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Estado do RECEBIMENTO para quem está com o sistema aberto — e, de quebra, o
 * segundo gatilho do vigia.
 *
 * Existe separada de `/wapi/status` porque aquela consulta a W-API a cada
 * chamada (caro demais para um heartbeat de poucos minutos). Esta só lê o
 * Firestore; a W-API só é acionada quando a instância está realmente muda.
 *
 * Vale para operador também, de propósito: quem está atendendo é justamente
 * quem precisa saber que parou de entrar mensagem — e a maioria das lojas opera
 * o dia inteiro sem o dono logado.
 */
export async function GET(request: Request, { params }: { params: Promise<{ empresaId: string }> }) {
  return withAuth(request, async (user) => {
    try {
      const { empresaId: bruto } = await params;
      const { empresaId } = await requireOperationalEmpresa(user, bruto);

      const integration = await getWhatsAppIntegrationAdmin(empresaId);
      if (!integration) {
        return ok({ estado: 'nao_se_aplica', silencioMs: 0, precisaAlertar: false, descricao: '' });
      }

      // Loja fechada não recebe alarme: silêncio de madrugada é o esperado, e
      // aviso vermelho que aparece sem motivo é aviso que se aprende a ignorar.
      const adminDb = getOptionalAdminDb();
      const perfil = adminDb ? (await adminDb.collection('store_profiles').doc(empresaId).get()).data() : null;
      const lojaAberta = getStoreOpenState(perfil).isOpen;

      const saude = avaliarSaudeDoWebhook({
        connected: integration.connected,
        lastWebhookAt: integration.lastWebhookAt,
        ultimaTentativaEm: (integration as any).watchdogUltimaTentativaEm,
        lojaAberta,
      });

      // Muda e sem tentativa recente: cura antes de responder. É o caminho que
      // faz a loja voltar sozinha mesmo se o agendamento do QStash falhar.
      if (saude.precisaReRegistrar) {
        await vigiarRecebimentoDaLoja(
          { empresaId, integration },
          (integ, token) => getWebhookUrl(request, integ.empresaId, token, integ.webhookUrl),
        ).catch(() => {});
      }

      return ok({
        estado: saude.estado,
        silencioMs: Number.isFinite(saude.silencioMs) ? saude.silencioMs : null,
        precisaAlertar: saude.precisaAlertar,
        descricao: descreverSilencio(saude.silencioMs),
        lojaAberta,
        numeroWhatsapp: integration.numeroWhatsapp || '',
      });
    } catch (error) {
      return jsonError(error);
    }
  });
}
