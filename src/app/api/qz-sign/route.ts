import crypto from 'crypto';

/**
 * Assinatura das requisições do QZ Tray.
 *
 * O QZ Tray, no PC do cliente, só imprime SEM o aviso de permissão quando a
 * requisição vem assinada por um certificado em que ele confia (o nosso
 * override.crt). A chave privada NUNCA vai para o navegador: o cliente manda o
 * texto a assinar para cá, assinamos com a chave guardada na env var e
 * devolvemos a assinatura em base64.
 *
 * Algoritmo SHA512 para casar com o default do QZ Tray 2.1+ (o cliente também
 * chama qz.security.setSignatureAlgorithm('SHA512')).
 *
 * Configurar a env var `QZ_PRIVATE_KEY` (Vercel e .env.local) com o conteúdo de
 * qz/private-key.pem. Quebras de linha podem vir como literais "\n".
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    const toSign = await req.text();

    const rawKey = process.env.QZ_PRIVATE_KEY;
    if (!rawKey) {
      // Sem chave configurada: não dá pra assinar. 503 faz o cliente cair no
      // fallback (window.print) sem quebrar nada.
      return new Response('QZ_PRIVATE_KEY não configurada', { status: 503 });
    }

    const privateKey = rawKey.includes('\\n') ? rawKey.replace(/\\n/g, '\n') : rawKey;

    const signer = crypto.createSign('SHA512');
    signer.update(toSign);
    signer.end();
    const signature = signer.sign(privateKey, 'base64');

    return new Response(signature, {
      status: 200,
      headers: { 'content-type': 'text/plain' },
    });
  } catch (err) {
    return new Response('Falha ao assinar', { status: 500 });
  }
}
