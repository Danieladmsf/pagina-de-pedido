export type WapiConnectionStatus = 'not_configured' | 'pending_qr' | 'connected' | 'disconnected' | 'error';

export interface WhatsAppIntegration {
  id?: string;
  ownerId: string;
  clienteId: string;
  empresaId: string;
  /**
   * O servidor de WhatsApp das lojas (WuzAPI). Os campos `wapi*` têm esse nome
   * por história: guardam o ID ("WUZ-...") e a chave da sessão da loja.
   */
  provider: 'wuzapi';
  wapiInstanceId: string;
  wapiTokenEncrypted: string;
  instanceName: string;
  status: WapiConnectionStatus;
  connected: boolean;
  numeroWhatsapp?: string;
  qrCode?: string;
  webhookUrl?: string;
  /**
   * Ultimo webhook recebido desta instancia (ISO). Prova que o REGISTRO do
   * webhook esta de pe — nao confundir com `connected`, que e o celular. O
   * handler carimba no maximo a cada 5 min; o poll de status usa para saber se
   * precisa refazer o registro do webhook no servidor.
   */
  lastWebhookAt?: string;
  lastError?: string;
  lastStatusAt?: string;
  /** Ultima vez que o vigia tentou refazer o registro dos webhooks (ISO). */
  watchdogUltimaTentativaEm?: string;
  /** Resultado dessa tentativa: o servidor aceitou o webhook ou nao. */
  watchdogUltimoResultado?: 'ok' | 'falha';
  createdAt: string;
  updatedAt: string;
}

export interface SanitizedWhatsAppIntegration {
  ownerId: string;
  clienteId: string;
  empresaId: string;
  provider: 'wuzapi';
  wapiInstanceId: string;
  instanceName: string;
  status: WapiConnectionStatus;
  connected: boolean;
  numeroWhatsapp?: string;
  qrCode?: string;
  webhookUrl?: string;
  lastWebhookAt?: string;
  lastError?: string;
  lastStatusAt?: string;
  createdAt: string;
  updatedAt: string;
  tokenConfigured: boolean;
}
