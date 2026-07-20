import {
  normalizeOperatorPermissions,
  type OperatorPermissions,
} from '@/lib/user-permissions';

export const OPERATIONAL_WAPI_MESSAGE_TYPES = [
  'order_created',
  'pix_proof_request',
  'order_ready_pickup',
  'order_ready_dine_in',
  'order_ready',
  'pickup_ready',
  'dine_in_ready',
  'delivery_out',
  'order_canceled',
] as const;

export type OperationalWapiMessageType = (typeof OPERATIONAL_WAPI_MESSAGE_TYPES)[number];
export type OperationalOrderType = 'delivery' | 'pickup' | 'dine_in';

const OPERATIONAL_MESSAGE_TYPE_SET = new Set<string>(OPERATIONAL_WAPI_MESSAGE_TYPES);

/**
 * Sanitiza IDs usados como segmentos de documento. Firebase Auth aceita UIDs
 * de até 128 caracteres; espaços, controles e `/` nunca são válidos aqui.
 */
export function sanitizeWapiDocumentId(value: unknown, maxLength = 128): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength || /[\s/\u0000-\u001f\u007f]/.test(normalized)) {
    return null;
  }
  return normalized;
}

export function sanitizeOperationalMessageType(value: unknown): OperationalWapiMessageType | null {
  if (typeof value !== 'string' || !OPERATIONAL_MESSAGE_TYPE_SET.has(value)) return null;
  return value as OperationalWapiMessageType;
}

export function sanitizeOperationalOrderType(value: unknown): OperationalOrderType | null {
  return value === 'delivery' || value === 'pickup' || value === 'dine_in' ? value : null;
}

export function normalizeWapiPhone(value: unknown): string {
  const digits = String(value || '').replace(/\D/g, '');
  if (!digits) return '';
  return digits.startsWith('55') ? digits : `55${digits}`;
}

/** Valida vínculo ativo + tenant e normaliza o perfil sempre em fail-closed. */
export function sanitizeOperatorDelegation(
  value: unknown,
  expectedOwnerId: string,
): OperatorPermissions | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const role = value as Record<string, unknown>;
  if (role.active !== true || sanitizeWapiDocumentId(role.ownerId) !== expectedOwnerId) return null;
  return normalizeOperatorPermissions(role.permissions);
}

export function canOperatorFetchProfilePicture(permissions: OperatorPermissions): boolean {
  return permissions.pdv.tabs.delivery === true || permissions.pdv.tabs.mesas === true;
}

function messageMatchesOrderType(
  messageType: OperationalWapiMessageType,
  orderType: OperationalOrderType,
): boolean {
  if (messageType === 'order_created' || messageType === 'pix_proof_request' || messageType === 'order_canceled') {
    return true;
  }

  if (orderType === 'delivery') {
    return messageType === 'order_ready' || messageType === 'delivery_out';
  }
  if (orderType === 'pickup') {
    return messageType === 'order_ready_pickup' || messageType === 'pickup_ready';
  }
  return messageType === 'order_ready_dine_in' || messageType === 'dine_in_ready';
}

/**
 * Fine-grained gate do uso operacional da WAPI. As permissões recebidas já
 * devem ter passado por normalizeOperatorPermissions (fail-closed).
 */
export function canOperatorSendOperationalMessage(
  permissions: OperatorPermissions,
  messageType: OperationalWapiMessageType,
  orderType: OperationalOrderType,
): boolean {
  if (!messageMatchesOrderType(messageType, orderType)) return false;

  const isMesa = orderType === 'dine_in';
  const hasRelevantTab = isMesa
    ? permissions.pdv.tabs.mesas === true
    : permissions.pdv.tabs.delivery === true;
  const canCancelFromCaixa = permissions.pdv.tabs.caixa === true
    && permissions.pdv.actions.caixa.cancelarVenda === true;

  if (messageType === 'order_canceled') {
    if (canCancelFromCaixa) return true;
    return isMesa
      ? hasRelevantTab && (
          permissions.pdv.actions.mesas.gerenciarMesa === true
          || permissions.pdv.actions.mesas.aceitarPedidoOnline === true
        )
      : hasRelevantTab && permissions.pdv.actions.delivery.cancelarPedido === true;
  }

  // Recebimento e lembrete PIX são notificações automáticas de leitura da fila;
  // enxergar a aba correspondente é a capacidade mínima necessária.
  if (messageType === 'order_created' || messageType === 'pix_proof_request') {
    return hasRelevantTab;
  }

  // As demais mensagens decorrem de uma mudança de estado operacional.
  return isMesa
    ? hasRelevantTab && (
        permissions.pdv.actions.mesas.aceitarPedidoOnline === true
        || permissions.pdv.actions.mesas.gerenciarMesa === true
      )
    : hasRelevantTab && permissions.pdv.actions.delivery.mudarStatus === true;
}
