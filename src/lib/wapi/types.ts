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
  lastError?: string;
  lastStatusAt?: string;
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
  lastError?: string;
  lastStatusAt?: string;
  createdAt: string;
  updatedAt: string;
  tokenConfigured: boolean;
}
