import { jsonError } from '@/lib/firebase-auth-rest';
import { getWebhookUrl, ok, requireEmpresa, requireIntegration, withAuth } from '@/app/wapi/_lib';
import { configurarWebhook, getWuzStatus } from '@/lib/wuzapi/wuzapi.service';
import { patchWhatsAppIntegration, sanitizeIntegration, statusDaConexao } from '@/lib/wapi/integration-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Tempo que uma loja CONECTADA pode passar sem nenhum webhook antes de o
 * registro virar suspeito. O carimbo vem do proprio handler do webhook
 * (`lastWebhookAt`), que ja le o documento da integracao — nao custa consulta
 * extra nem indice novo.
 */
const WEBHOOK_SILENCE_MS = 30 * 60 * 1000;

export async function GET(request: Request, { params }: { params: Promise<{ empresaId: string }> }) {
  return withAuth(request, async (user) => {
    try {
      const { empresaId: rawEmpresaId } = await params;
      const empresaId = requireEmpresa(user, rawEmpresaId);
      const { integration, token } = await requireIntegration(empresaId, user.idToken);
      const webhookUrl = getWebhookUrl(request, empresaId, token, integration.webhookUrl);
      let webhookConfigured = false;

      let aoVivo: Awaited<ReturnType<typeof getWuzStatus>>;
      try {
        aoVivo = await getWuzStatus(integration.wapiInstanceId, token);
      } catch (statusError: any) {
        // Servidor sem resposta não é loja desconectada: mantém o estado salvo.
        console.warn('[WhatsApp status] Falha ao consultar o servidor, mantendo estado salvo:', statusError?.message);
        const updated = await patchWhatsAppIntegration(empresaId, {
          lastError: `Falha ao consultar o servidor de WhatsApp: ${statusError?.message || 'sem resposta'}`,
          lastStatusAt: new Date().toISOString(),
        }, user.idToken);
        return ok({ integration: sanitizeIntegration(updated), raw: null, statusError: statusError?.message });
      }

      // Só a sessão logada conta. O número NÃO prova conexão: o servidor guarda
      // o do último pareamento e continua devolvendo depois do logout.
      const connected = aoVivo.connected;
      const connectedPhone = connected ? aoVivo.phone || integration.numeroWhatsapp || '' : '';

      // Registrar o webhook a cada consulta seria uma chamada inútil a cada 15 s
      // por aba aberta: a URL só muda quando o domínio ou a chave mudam. Refaz
      // quando mudou ou quando o registro parece ter caído (silêncio abaixo).
      const agora = Date.now();
      const ultimoEvento = Date.parse(integration.lastWebhookAt || '') || 0;

      // Loja CONECTADA que passou do limite sem receber um único webhook: o
      // registro caiu ou nunca chegou a existir. Registrar de novo é barato;
      // ficar mudo sem ninguém perceber não é. Desconectada não conta: silêncio
      // ali é esperado.
      const mudaDemais = connected && agora - ultimoEvento > WEBHOOK_SILENCE_MS;
      const precisaRegistrar = integration.webhookUrl !== webhookUrl || mudaDemais;
      let registroConfirmado = !precisaRegistrar;

      if (precisaRegistrar) {
        try {
          await configurarWebhook(token, webhookUrl);
          registroConfirmado = true;
          webhookConfigured = true;
        } catch (webhookError: any) {
          console.warn('[WhatsApp status] Falha ao registrar o webhook:', webhookError?.message || webhookError);
        }
      } else {
        webhookConfigured = true;
      }

      const updated = await patchWhatsAppIntegration(empresaId, {
        connected,
        status: statusDaConexao(connected),
        numeroWhatsapp: connectedPhone,
        // Só grava a URL como registrada quando ela FOI registrada: em falha o
        // campo segue diferente e o próximo poll tenta de novo.
        ...(registroConfirmado ? { webhookUrl } : {}),
        // Carimbo novo depois de TENTAR registrar por silêncio (deu certo ou
        // não): reinicia o relógio e serve de backoff — a retentativa volta em
        // 30 min, em vez de a cada 15 s enquanto o silêncio durar.
        ...(mudaDemais ? { lastWebhookAt: new Date().toISOString() } : {}),
        lastError: '',
        lastStatusAt: new Date().toISOString(),
      }, user.idToken);

      return ok({ integration: sanitizeIntegration(updated), raw: aoVivo, webhookConfigured });
    } catch (error) {
      return jsonError(error);
    }
  });
}
