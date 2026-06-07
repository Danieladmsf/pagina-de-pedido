import { NextResponse } from 'next/server';
import { ApiError, AuthenticatedFirebaseUser, jsonError, requireFirebaseUser } from '@/lib/firebase-auth-rest';
import { assertEmpresaOwner, decryptWapiToken, getWhatsAppIntegration, getWhatsAppIntegrationAdmin, isBlockedSharedWapiInstance } from '@/lib/wapi/integration-store';
import { encryptSecret } from '@/lib/wapi/crypto';
import { WhatsAppIntegration } from '@/lib/wapi/types';

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
