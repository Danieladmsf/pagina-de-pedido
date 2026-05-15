import { NextResponse } from 'next/server';
import { ApiError, AuthenticatedFirebaseUser, jsonError, requireFirebaseUser } from '@/lib/firebase-auth-rest';
import { assertEmpresaOwner, decryptWapiToken, getWhatsAppIntegration, isBlockedSharedWapiInstance } from '@/lib/wapi/integration-store';
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

export async function requireIntegration(empresaId: string, idToken: string): Promise<{ integration: WhatsAppIntegration; token: string }> {
  const integration = await getWhatsAppIntegration(empresaId, idToken);
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

export function getWebhookUrl(request: Request, empresaId?: string) {
  const requestOrigin = new URL(request.url).origin;
  const configuredBaseUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.WAPI_PUBLIC_BASE_URL || '';
  const baseUrl = requestOrigin.includes('localhost') && configuredBaseUrl ? configuredBaseUrl : requestOrigin;
  const url = new URL('/webhooks/wapi', baseUrl);
  const secret = process.env.WAPI_WEBHOOK_SECRET;
  if (secret) url.searchParams.set('secret', secret);
  if (empresaId) url.searchParams.set('empresaId', empresaId);
  return url.toString();
}

export function ok(data: Record<string, unknown>, status = 200) {
  return NextResponse.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
}
