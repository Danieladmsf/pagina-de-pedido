import { createFirestoreDocument, getFirestoreDocument, patchFirestoreDocumentFields } from '@/lib/firestore-rest';
import { decryptSecret, encryptSecret } from '@/lib/wapi/crypto';
import { SanitizedWhatsAppIntegration, WhatsAppIntegration, WapiConnectionStatus } from '@/lib/wapi/types';

const ADMIN_COLLECTION = 'roles_admin';
const INTEGRATION_FIELD = 'whatsappIntegration';
const LEGACY_SHARED_INSTANCE_IDS = new Set([
  ...(process.env.WAPI_BLOCKED_INSTANCE_IDS || '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean),
]);

export function assertEmpresaOwner(uid: string, empresaId?: string) {
  const targetEmpresaId = empresaId || uid;
  if (targetEmpresaId !== uid) {
    throw new Error('Voce nao tem permissao para gerenciar o WhatsApp desta empresa.');
  }
  return targetEmpresaId;
}

export function encryptWapiToken(token: string) {
  return encryptSecret(token);
}

export function decryptWapiToken(integration: WhatsAppIntegration) {
  return decryptSecret(integration.wapiTokenEncrypted);
}

export function isBlockedSharedWapiInstance(instanceId?: string) {
  return Boolean(instanceId && LEGACY_SHARED_INSTANCE_IDS.has(instanceId));
}

export function sanitizeIntegration(integration: WhatsAppIntegration): SanitizedWhatsAppIntegration {
  return {
    ownerId: integration.ownerId,
    clienteId: integration.clienteId,
    empresaId: integration.empresaId,
    provider: integration.provider,
    wapiInstanceId: integration.wapiInstanceId,
    instanceName: integration.instanceName,
    status: integration.status,
    connected: integration.connected,
    numeroWhatsapp: integration.numeroWhatsapp,
    qrCode: integration.qrCode,
    webhookUrl: integration.webhookUrl,
    lastError: integration.lastError,
    lastStatusAt: integration.lastStatusAt,
    createdAt: integration.createdAt,
    updatedAt: integration.updatedAt,
    tokenConfigured: Boolean(integration.wapiTokenEncrypted),
  };
}

export async function getWhatsAppIntegration(empresaId: string, idToken: string) {
  const adminDoc = await getFirestoreDocument<Record<string, any>>(`${ADMIN_COLLECTION}/${empresaId}`, idToken);
  return (adminDoc?.[INTEGRATION_FIELD] || null) as WhatsAppIntegration | null;
}

export async function saveWhatsAppIntegration(empresaId: string, data: WhatsAppIntegration, idToken: string) {
  await patchFirestoreDocumentFields(
    `${ADMIN_COLLECTION}/${empresaId}`,
    { [INTEGRATION_FIELD]: data },
    [INTEGRATION_FIELD],
    idToken,
  );
  return data;
}

export async function patchWhatsAppIntegration(
  empresaId: string,
  patch: Partial<WhatsAppIntegration>,
  idToken: string,
) {
  const current = await getWhatsAppIntegration(empresaId, idToken);
  if (!current) throw new Error('WhatsApp ainda nao configurado para esta empresa.');
  const next = { ...current, ...patch, updatedAt: new Date().toISOString() } as WhatsAppIntegration;
  await saveWhatsAppIntegration(empresaId, next, idToken);
  return next;
}

export async function saveWhatsAppMessageLog(
  idToken: string,
  data: {
    ownerId: string;
    empresaId: string;
    phone: string;
    message?: string;
    type: string;
    orderId?: string;
    providerMessageId?: string;
    status: string;
    payload?: Record<string, unknown>;
    errorMessage?: string;
  },
) {
  return createFirestoreDocument('whatsapp_messages', {
    ...data,
    provider: 'wapi',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }, idToken);
}

export async function deleteWhatsAppIntegration(empresaId: string, idToken: string) {
  await patchFirestoreDocumentFields(
    `${ADMIN_COLLECTION}/${empresaId}`,
    { [INTEGRATION_FIELD]: null },
    [INTEGRATION_FIELD],
    idToken,
  );
}

export function statusFromWapi(connected: boolean): WapiConnectionStatus {
  return connected ? 'connected' : 'pending_qr';
}
