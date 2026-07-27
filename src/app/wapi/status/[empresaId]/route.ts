import { jsonError } from '@/lib/firebase-auth-rest';
import { getWebhookUrl, ok, requireEmpresa, requireIntegration, withAuth } from '@/app/wapi/_lib';
import { configureWapiWebhooks, getWapiConnectedPhone, getWapiStatus, hasExplicitWapiConnectionState, isWapiConnectedStatus } from '@/lib/wapi/wapi.service';
import { patchWhatsAppIntegration, sanitizeIntegration, statusFromWapi } from '@/lib/wapi/integration-store';

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

      let rawStatus: any = null;
      let connected = integration.connected;
      let connectedPhone = integration.numeroWhatsapp || '';

      try {
        rawStatus = await getWapiStatus(integration.wapiInstanceId, token);
        const livePhone = getWapiConnectedPhone(rawStatus);

        // Só rebaixa para "desconectado" quando a W-API AFIRMA isso. Se a
        // resposta vier num formato que não reconhecemos, mantemos o que já
        // sabíamos (os webhooks de mensagem provam a conexão o tempo todo) —
        // antes, um formato inesperado zerava o estado a cada 15s e jogava a
        // tela no laço de QR Code, que é o que derrubava o WhatsApp.
        if (isWapiConnectedStatus(rawStatus) || livePhone) connected = true;
        else if (hasExplicitWapiConnectionState(rawStatus)) connected = false;
        else connected = integration.connected;

        connectedPhone = livePhone || integration.numeroWhatsapp || '';
      } catch (wapiError: any) {
        // Se a W-API nao respondeu, mantemos o status salvo em vez de marcar como desconectado
        console.warn('[W-API status] Falha ao consultar status ao vivo, mantendo estado salvo:', wapiError?.message);
        const updated = await patchWhatsAppIntegration(empresaId, {
          lastError: `Falha ao consultar W-API: ${wapiError?.message || 'timeout'}`,
          lastStatusAt: new Date().toISOString(),
        }, user.idToken);
        return ok({ integration: sanitizeIntegration(updated), raw: null, wapiError: wapiError?.message });
      }

      // Reconfigurar os 5 webhooks a CADA consulta de status significava ~24
      // chamadas por minuto na W-API para cada aba aberta, sem nenhum motivo: a
      // URL so muda quando o dominio ou o token mudam. So refaz quando mudou —
      // ou quando o registro parece ter caido (silencio abaixo).
      const agora = Date.now();
      const ultimoEvento = Date.parse(integration.lastWebhookAt || '') || 0;

      // Loja CONECTADA que passou do limite sem receber um unico webhook: ou o
      // registro caiu do lado da W-API, ou nunca chegou a existir. Refazer os 5
      // PUTs e barato; ficar mudo sem ninguem perceber nao e. Desconectada nao
      // conta — silencio ali e esperado, re-registrar seria ruido puro.
      const mudaDemais = connected && agora - ultimoEvento > WEBHOOK_SILENCE_MS;
      const precisaRegistrar = integration.webhookUrl !== webhookUrl || mudaDemais;

      // Registro OK de verdade = os 5 endpoints aceitos. `configureWapiWebhooks`
      // usa Promise.allSettled e nao lanca em falha parcial, entao sem esta
      // distincao um 429 da W-API deixava o registro pela metade e ainda assim
      // gravava a URL como boa — e a condicao acima nunca mais tentava de novo.
      let registroConfirmado = !precisaRegistrar;

      if (precisaRegistrar) {
        try {
          const webhookResult = await configureWapiWebhooks(integration.wapiInstanceId, token, webhookUrl);
          registroConfirmado = webhookResult.failed.length === 0;
          webhookConfigured = !webhookResult.failed.some((item) => item.endpoint === 'update-webhook-received');
        } catch (webhookError: any) {
          console.warn('[W-API status] Falha ao reconfigurar webhooks:', webhookError?.message || webhookError);
        }
      } else {
        webhookConfigured = true;
      }

      const updated = await patchWhatsAppIntegration(empresaId, {
        connected,
        status: statusFromWapi(connected),
        numeroWhatsapp: connectedPhone,
        // So grava a URL como registrada quando ela FOI registrada: em falha
        // parcial o campo segue diferente e o proximo poll tenta de novo.
        ...(registroConfirmado ? { webhookUrl } : {}),
        // Carimbo novo depois de TENTAR re-registrar por silencio (deu certo ou
        // nao): reinicia o relogio e serve de backoff — a retentativa volta em
        // 30 min, em vez de a cada 15s enquanto o silencio durar.
        ...(mudaDemais ? { lastWebhookAt: new Date().toISOString() } : {}),
        lastError: '',
        lastStatusAt: new Date().toISOString(),
      }, user.idToken);

      return ok({ integration: sanitizeIntegration(updated), raw: rawStatus, webhookConfigured });
    } catch (error) {
      return jsonError(error);
    }
  });
}
