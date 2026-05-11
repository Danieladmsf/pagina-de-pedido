import { NextResponse } from 'next/server';
import { ApiError, AuthenticatedFirebaseUser, jsonError, requireFirebaseUser } from '@/lib/firebase-auth-rest';
import { assertEmpresaOwner, decryptWapiToken, getWhatsAppIntegration } from '@/lib/wapi/integration-store';
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

// TEMPORÁRIO: Token da instância trial para fallback se a descriptografia falhar
const TRIAL_INSTANCE_ID = 'LITE-JMDANG-I3824S';
const TRIAL_INSTANCE_TOKEN = 'OrO1JglDjZBmsgQk2C8fnYQ4soclm228O';

export async function requireIntegration(empresaId: string, idToken: string): Promise<{ integration: WhatsAppIntegration; token: string }> {
  const integration = await getWhatsAppIntegration(empresaId, idToken);
  if (!integration?.wapiInstanceId || !integration?.wapiTokenEncrypted) {
    throw new ApiError(404, 'WhatsApp ainda nao configurado para esta empresa.');
  }

  let token: string;
  try {
    token = decryptWapiToken(integration);
  } catch (err) {
    // Se a descriptografia falhar e for a instância trial, usa o token hardcoded
    if (integration.wapiInstanceId === TRIAL_INSTANCE_ID) {
      console.warn('[W-API] Fallback: usando token trial hardcoded (chave de criptografia pode ter mudado entre ambientes).');
      token = TRIAL_INSTANCE_TOKEN;
    } else {
      throw new ApiError(500, 'Erro ao descriptografar o token da instancia. Tente desconectar e reconectar.');
    }
  }

  return { integration, token };
}

export function getWebhookUrl(request: Request) {
  const baseUrl = process.env.WAPI_PUBLIC_BASE_URL || process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin;
  const url = new URL('/webhooks/wapi', baseUrl);
  const secret = process.env.WAPI_WEBHOOK_SECRET;
  if (secret) url.searchParams.set('secret', secret);
  return url.toString();
}

export function ok(data: Record<string, unknown>, status = 200) {
  return NextResponse.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
}
