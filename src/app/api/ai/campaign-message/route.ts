import Anthropic from '@anthropic-ai/sdk';
import { requireFirebaseUser, jsonError } from '@/lib/firebase-auth-rest';

/**
 * Geração/ajuste de texto de campanha com Claude (claude-opus-4-8).
 *
 * O dono da loja escreve um rascunho/ideia e a IA devolve UMA mensagem de
 * WhatsApp pronta. A chave fica só no servidor (env ANTHROPIC_API_KEY) e a rota
 * exige usuário autenticado para não expor crédito da API.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    await requireFirebaseUser(request); // garante login (evita abuso do crédito)

    const body = await request.json().catch(() => ({}));
    const draft = String(body?.prompt || '').trim();
    const loja = String(body?.loja || 'a loja').trim();
    const tokens: string[] = Array.isArray(body?.tokens) ? body.tokens.map((t: any) => String(t)) : [];

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return new Response(JSON.stringify({ error: 'IA não configurada (ANTHROPIC_API_KEY ausente).' }), {
        status: 503,
        headers: { 'content-type': 'application/json' },
      });
    }

    const client = new Anthropic({ apiKey });

    const varsLine = tokens.length
      ? `Você PODE usar APENAS estas variáveis no texto (serão substituídas automaticamente no envio): ${tokens.join(', ')}. NÃO use NENHUMA outra variável além dessas.`
      : `NÃO use nenhuma variável de personalização (não escreva {primeiro_nome}, {nome}, {loja} nem {link}); escreva um texto genérico.`;

    const system =
      `Você é um redator de marketing para restaurantes e delivery no Brasil. ` +
      `Receberá um rascunho ou ideia do dono da loja e deve transformá-lo em UMA mensagem de WhatsApp pronta para enviar aos clientes.\n` +
      `Regras:\n` +
      `- Tom caloroso, próximo e persuasivo, em português do Brasil.\n` +
      `- Curta: 2 a 5 linhas. No máximo 1 ou 2 emojis.\n` +
      `- ${varsLine}\n` +
      `- Não use markdown, títulos, aspas ou listas. Apenas o texto da mensagem.\n` +
      `- Responda SOMENTE com a mensagem final, sem explicações nem comentários.\n` +
      `Nome da loja: "${loja}".`;

    const userContent = draft
      ? `Rascunho/ideia do lojista:\n${draft}`
      : `Crie uma mensagem promocional atrativa e genérica para reativar clientes.`;

    const res = await client.messages.create({
      model: 'claude-opus-4-8',
      max_tokens: 600,
      system,
      messages: [{ role: 'user', content: userContent }],
    });

    const message = (res.content || [])
      .filter((b: any) => b.type === 'text')
      .map((b: any) => b.text)
      .join('')
      .trim();

    return new Response(JSON.stringify({ message }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  } catch (err) {
    return jsonError(err);
  }
}
