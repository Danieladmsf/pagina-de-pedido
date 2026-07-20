import { NextResponse } from 'next/server';
import { ApiError, AuthenticatedFirebaseUser, jsonError, requireFirebaseUser } from '@/lib/firebase-auth-rest';
import { assertEmpresaOwner, decryptWapiToken, getWhatsAppIntegration, getWhatsAppIntegrationAdmin, isBlockedSharedWapiInstance } from '@/lib/wapi/integration-store';
import { encryptSecret } from '@/lib/wapi/crypto';
import { WhatsAppIntegration } from '@/lib/wapi/types';
import { getOptionalAdminDb } from '@/lib/firebase-admin';
import type { OperatorPermissions } from '@/lib/user-permissions';
import {
  canOperatorFetchProfilePicture,
  canOperatorSendOperationalMessage,
  normalizeWapiPhone,
  sanitizeOperatorDelegation,
  sanitizeOperationalMessageType,
  sanitizeOperationalOrderType,
  sanitizeWapiDocumentId,
  type OperationalWapiMessageType,
} from '@/lib/wapi/operator-access';

export async function withAuth(
  request: Request,
  handler: (user: AuthenticatedFirebaseUser) => Promise<Response>,
) {
  try {
    const user = await requireFirebaseUser(request);
    return handler(user);
  } catch (error) {
    return jsonError(error);
  }
}

export function requireEmpresa(user: AuthenticatedFirebaseUser, empresaId?: string) {
  try {
    return assertEmpresaOwner(user.uid, empresaId);
  } catch (error) {
    throw new ApiError(403, error instanceof Error ? error.message : 'Empresa invalida.');
  }
}

export interface WapiOperationalAccess {
  empresaId: string;
  role: 'owner' | 'operator';
  permissions: OperatorPermissions | null;
}

/**
 * Resolve delegação sem afrouxar requireEmpresa(), que continua sendo usado por
 * todos os endpoints de gestão da integração. Só rotas operacionais devem usar
 * este helper.
 */
export async function requireOperationalEmpresa(
  user: AuthenticatedFirebaseUser,
  rawEmpresaId: unknown,
): Promise<WapiOperationalAccess> {
  const empresaId = sanitizeWapiDocumentId(rawEmpresaId ?? user.uid);
  if (!empresaId) throw new ApiError(400, 'Empresa invalida.');

  if (empresaId === user.uid) {
    return { empresaId, role: 'owner', permissions: null };
  }

  const adminDb = getOptionalAdminDb();
  if (!adminDb) {
    throw new ApiError(503, 'Autorizacao de operador indisponivel no momento.');
  }

  const roleSnapshot = await adminDb.collection('roles_operador').doc(user.uid).get();
  const permissions = sanitizeOperatorDelegation(
    roleSnapshot.exists ? roleSnapshot.data() : null,
    empresaId,
  );

  if (!permissions) {
    throw new ApiError(403, 'Voce nao tem permissao para operar o WhatsApp desta empresa.');
  }

  return {
    empresaId,
    role: 'operator',
    permissions,
  };
}

export function requireOperationalProfilePictureAccess(access: WapiOperationalAccess): void {
  if (access.role === 'operator' && (
    !access.permissions || !canOperatorFetchProfilePicture(access.permissions)
  )) {
    throw new ApiError(403, 'Sem permissao para consultar contatos desta operacao.');
  }
}

export interface AuthorizedOperationalMessage {
  messageType: OperationalWapiMessageType;
  orderId: string;
}

/**
 * Operador só envia notificações vinculadas a um pedido real da própria loja.
 * Tipo, telefone, tenant e capacidade são todos revalidados no servidor.
 */
export async function requireOperationalMessageAccess(
  access: WapiOperationalAccess,
  input: {
    type: unknown;
    orderId: unknown;
    phone: unknown;
    hasDocument?: boolean;
    hasImage?: boolean;
  },
): Promise<AuthorizedOperationalMessage | null> {
  if (access.role === 'owner') return null;

  const messageType = sanitizeOperationalMessageType(input.type);
  const orderId = sanitizeWapiDocumentId(input.orderId, 256);
  const requestedPhone = normalizeWapiPhone(input.phone);
  if (!messageType || !orderId || !requestedPhone || input.hasDocument || input.hasImage) {
    throw new ApiError(403, 'Esta conta só pode enviar notificações operacionais de pedidos.');
  }

  const adminDb = getOptionalAdminDb();
  if (!adminDb) {
    throw new ApiError(503, 'Autorizacao de operador indisponivel no momento.');
  }

  const orderSnapshot = await adminDb.collection('orders').doc(orderId).get();
  const order = orderSnapshot.exists ? orderSnapshot.data() : null;
  const orderType = sanitizeOperationalOrderType(order?.orderType);
  const orderOwnerId = sanitizeWapiDocumentId(order?.ownerId);
  const orderPhone = normalizeWapiPhone(order?.customerPhone);

  if (
    !order
    || orderOwnerId !== access.empresaId
    || !orderType
    || !orderPhone
    || orderPhone !== requestedPhone
    || !access.permissions
    || !canOperatorSendOperationalMessage(access.permissions, messageType, orderType)
  ) {
    throw new ApiError(403, 'Sem permissao para enviar esta notificacao de pedido.');
  }

  return { messageType, orderId };
}

export async function requireOperationalIntegration(
  access: WapiOperationalAccess,
  user: AuthenticatedFirebaseUser,
): Promise<{ integration: WhatsAppIntegration; token: string }> {
  return access.role === 'owner'
    ? requireIntegration(access.empresaId, user.idToken)
    : requireIntegrationService(access.empresaId);
}

function resolveIntegration(integration: WhatsAppIntegration | null): { integration: WhatsAppIntegration; token: string } {
  if (!integration?.wapiInstanceId || !integration?.wapiTokenEncrypted) {
    throw new ApiError(404, 'WhatsApp ainda nao configurado para esta empresa.');
  }

  if (isBlockedSharedWapiInstance(integration.wapiInstanceId)) {
    throw new ApiError(409, 'Esta empresa ainda aponta para uma instancia W-API compartilhada de testes. Crie uma nova instancia para isolar o WhatsApp da loja.');
  }

  let token: string;
  try {
    token = decryptWapiToken(integration);
  } catch (err) {
    throw new ApiError(500, 'Erro ao descriptografar o token da instancia. Tente desconectar e reconectar.');
  }

  return { integration, token };
}

/** Resolve a instância w-api da empresa a partir do token do usuário (REST). */
export async function requireIntegration(empresaId: string, idToken: string): Promise<{ integration: WhatsAppIntegration; token: string }> {
  return resolveIntegration(await getWhatsAppIntegration(empresaId, idToken));
}

/**
 * Mesma resolução, porém via Firebase Admin (sem token de usuário) — para o
 * disparo agendado de campanhas (cron/QStash), que roda sem sessão.
 */
export async function requireIntegrationService(empresaId: string): Promise<{ integration: WhatsAppIntegration; token: string }> {
  return resolveIntegration(await getWhatsAppIntegrationAdmin(empresaId));
}

function getExistingWebhookToken(webhookUrl?: string) {
  if (!webhookUrl) return '';

  try {
    return new URL(webhookUrl).searchParams.get('wt') || '';
  } catch {
    return '';
  }
}

export function getWebhookUrl(request: Request, empresaId?: string, instanceToken?: string, existingWebhookUrl?: string) {
  const requestOrigin = new URL(request.url).origin;
  const configuredBaseUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.WAPI_PUBLIC_BASE_URL || '';
  const baseUrl = requestOrigin.includes('localhost') && configuredBaseUrl ? configuredBaseUrl : requestOrigin;
  const url = new URL('/webhooks/wapi', baseUrl);
  const secret = process.env.WAPI_WEBHOOK_SECRET;
  const webhookToken = getExistingWebhookToken(existingWebhookUrl);
  if (secret) url.searchParams.set('secret', secret);
  if (empresaId) url.searchParams.set('empresaId', empresaId);
  if (webhookToken) url.searchParams.set('wt', webhookToken);
  else if (instanceToken) url.searchParams.set('wt', encryptSecret(instanceToken));
  return url.toString();
}

export function ok(data: Record<string, unknown>, status = 200) {
  return NextResponse.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
}
