export type WapiConnectionStatus = 'not_configured' | 'pending_qr' | 'connected' | 'disconnected' | 'error';

export interface WhatsAppIntegration {
  id?: string;
  ownerId: string;
  clienteId: string;
  empresaId: string;
  provider: 'wapi';
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
   * precisa refazer o registro na W-API.
   */
  lastWebhookAt?: string;
  lastError?: string;
  lastStatusAt?: string;
  /** Ultima vez que o vigia tentou refazer o registro dos webhooks (ISO). */
  watchdogUltimaTentativaEm?: string;
  /** Resultado dessa tentativa: os 5 endpoints aceitos ou nao. */
  watchdogUltimoResultado?: 'ok' | 'falha';
  createdAt: string;
  updatedAt: string;
}

export interface SanitizedWhatsAppIntegration {
  ownerId: string;
  clienteId: string;
  empresaId: string;
  provider: 'wapi';
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
