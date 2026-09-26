import { NextResponse, after } from 'next/server';
import { getOptionalAdminDb } from '@/lib/firebase-admin';
import { decryptSecret } from '@/lib/wapi/crypto';
import { sendWuzImage, sendWuzText } from '@/lib/wuzapi/wuzapi.service';
import { ehEventoWuzapi, lerEventoWuzapi, type IncomingMessage } from '@/lib/wuzapi/incoming';
import { extrairCodigoDaMensagem } from '@/lib/contato-link';
import { identificarVisitantePeloCodigo } from '@/lib/visitantes.server';
import { buildAutoReply } from '@/lib/wapi/auto-reply';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Intervalo minimo entre dois carimbos de `lastWebhookAt` (12 escritas/hora). */
const WEBHOOK_HEARTBEAT_MS = 5 * 60 * 1000;

function isAuthorized(request: Request) {
  const expected = process.env.WAPI_WEBHOOK_SECRET;
  if (!expected) return true;

  const url = new URL(request.url);
  const received = url.searchParams.get('secret') || request.headers.get('x-wapi-secret');
  return received === expected;
}

function getWebhookToken(url: URL) {
  const encryptedToken = url.searchParams.get('wt');
  if (!encryptedToken) return { present: false, token: '' };

  try {
    return { present: true, token: decryptSecret(encryptedToken) };
  } catch (error) {
    console.warn('[WhatsApp webhook] Token do webhook invalido ou expirado:', error);
    return { present: true, token: '' };
  }
}

/**
 * Costura o `@lid` ao telefone da mesma pessoa.
 *
 * A reacao no story chega so com o LID e a DM dela chega com o numero. Sem esta
 * ponte, quem reage e escreve na sequencia recebe a saudacao duas vezes com
 * segundos de diferenca — foi o que aconteceria em 22/08, quando uma cliente
 * reagiu as 09:14:28 e comentou as 09:14:47.
 *
 * O ponteiro mora no proprio doc de contato do LID: nao ha colecao nova nem
 * consulta com indice, e um `get` direto por id.
 */
async function resolverDestino(
  adminDb: any,
  empresaId: string,
  incoming: { phone: string; address: string; senderLid: string },
) {
  if (!incoming.senderLid) return { address: incoming.address, phone: incoming.phone };

  const lidRef = adminDb.collection('whatsapp_auto_reply_contacts').doc(`${empresaId}_${incoming.senderLid}`);

  if (incoming.phone) {
    // Best-effort: guardar o numero e util, mas nunca vale segurar a resposta.
    await lidRef
      .set({ empresaId, telefoneConhecido: incoming.phone, updatedAt: new Date().toISOString() }, { merge: true })
      .catch(() => {});
    return { address: incoming.address, phone: incoming.phone };
  }

  const conhecido = await lidRef
    .get()
    .then((snap: any) => snap.data()?.telefoneConhecido || '')
    .catch(() => '');
  if (!conhecido) return { address: incoming.address, phone: incoming.phone };
  return { address: String(conhecido), phone: String(conhecido) };
}

/**
 * Uma segunda chance para o envio.
 *
 * Em 22/08/2026 tres respostas automaticas morreram com o provedor da epoca
 * pendurado por 31 segundos: o claim voltava atras e a mensagem sumia sem
 * deixar rastro. Erro de dado (4xx) nao melhora repetindo; queda de rede,
 * timeout e erro do servidor, sim.
 */
async function enviarComSegundaChance<T>(enviar: () => Promise<T>): Promise<T> {
  try {
    return await enviar();
  } catch (error: any) {
    const status = Number(error?.status) || 0;
    const valeRepetir = status === 0 || status === 408 || status === 429 || status >= 500;
    if (!valeRepetir) throw error;

    console.warn('[WhatsApp webhook] Envio falhou; tentando uma segunda vez:', {
      status,
      erro: String(error?.message || error),
    });
    await new Promise((resolve) => setTimeout(resolve, 2000));
    return await enviar();
  }
}

/**
 * Carimba no contato a ultima vez que a LOJA falou com esta pessoa.
 *
 * So entra aqui o que a dona digitou ou gravou no celular: o que o proprio robo
 * envia pelo servidor nao volta como evento (ver `lib/wuzapi/incoming`). Se
 * voltasse, a resposta automatica carimbaria a si mesma e a trava de
 * `JANELA_DA_CONVERSA_HUMANA_MS` nunca soltaria — a loja ficaria muda para
 * sempre com quem ja foi saudado uma vez.
 *
 * O destino chega como telefone ou como `<lid>@lid`. Os dois precisam cair no
 * MESMO doc que `maybeSendAutoReply` vai ler depois, entao a ponte pelo
 * `telefoneConhecido` e a mesma de `resolverDestino`.
 */
async function registrarSaidaDaLoja(
  adminDb: any,
  empresaId: string,
  saida: { chatId: string } | null,
  now: string,
) {
  if (!saida) return;

  const chatId = String(saida.chatId || '').trim();
  const alvo = chatId.toLowerCase();
  if (!chatId || alvo === 'status' || alvo.includes('@g.us') || alvo.includes('broadcast')) return;

  const contatos = adminDb.collection('whatsapp_auto_reply_contacts');
  let address = chatId;

  if (alvo.endsWith('@lid')) {
    const conhecido = await contatos
      .doc(`${empresaId}_${chatId}`)
      .get()
      .then((snap: any) => snap.data()?.telefoneConhecido || '')
      .catch(() => '');
    if (conhecido) address = String(conhecido);
  }

  await contatos
    .doc(`${empresaId}_${address}`)
    .set({ empresaId, address, lastOutboundAt: now, updatedAt: now }, { merge: true });
}

async function maybeSendAutoReply(params: {
  adminDb: any;
  adminRef: any;
  empresaId: string;
  /** A mensagem já lida pelo leitor do servidor (`lib/wuzapi/incoming`). */
  incoming: IncomingMessage | null;
  requestOrigin: string;
  now: string;
}) {
  const incoming = params.incoming;
  // `address` e o telefone quando ele veio, senao o "<lid>@lid" — contato fora
  // da agenda da loja chega so com LID, e o envio aceita ele no lugar do numero.
  if (!incoming?.address) return false;

  // Proteção contra sincronização de histórico: 
  // Se a mensagem for mais velha que 5 minutos, ignorar para não responder mensagens antigas.
  if (incoming.timestamp) {
    const msgTimeMs = incoming.timestamp > 9999999999 ? incoming.timestamp : incoming.timestamp * 1000;
    const nowMs = Date.now();
    if (nowMs - msgTimeMs > 5 * 60 * 1000) {
      console.log('[WhatsApp webhook] Ignorando mensagem antiga (sincronização de histórico):', { address: incoming.address, ageMs: nowMs - msgTimeMs });
      return false;
    }
  }

  const adminSnap = await params.adminRef.get();
  const integration = adminSnap.data()?.whatsappIntegration;
  if (!integration?.connected || !integration?.wapiInstanceId || !integration?.wapiTokenEncrypted) return false;

  const storeSnap = await params.adminDb.collection('store_profiles').doc(params.empresaId).get();
  const storeProfile = storeSnap.exists ? storeSnap.data() : {};

  // Quem chega so com LID pode ja ser conhecido pelo numero; nesse caso a
  // conversa toda (reacao no story e DM) cai num contato so.
  const destino = await resolverDestino(params.adminDb, params.empresaId, incoming);
  const alvo = { ...incoming, phone: destino.phone, address: destino.address };

  // Chaveado por `address`: para quem tem telefone o id do doc continua
  // exatamente o mesmo de antes, entao o historico de quem ja foi saudado
  // segue valendo. Contato so-LID ganha doc proprio.
  const contactRef = params.adminDb.collection('whatsapp_auto_reply_contacts').doc(`${params.empresaId}_${alvo.address}`);

  // Claim atomico ANTES do envio (mesmo padrao do whatsapp_send_claims):
  // decidir e gravar o carimbo na mesma transacao faz webhooks concorrentes
  // (rajada de mensagens, reenvio do servidor) relerem o doc ja carimbado e
  // desistirem. Se o envio falhar, o claim e devolvido no catch abaixo.
  const CLAIM_FIELD: Record<string, string> = {
    first_contact_auto_reply: 'firstContactSentAt',
    store_closed_auto_reply: 'lastClosedReplyAt',
    // O pedido de cardápio tem carimbo próprio: ele não gasta o "primeiro
    // contato" (que é a saudação) e ainda segura a rajada — reenvio do servidor
    // e dois toques seguidos no botão não viram duas respostas.
    link_request_auto_reply: 'lastLinkReplyAt',
    // O agradecimento por reacao no story tem carimbo proprio pelo mesmo
    // motivo: nao gasta o "primeiro contato" de quem ainda vai escrever, e
    // segura a rajada de quem reage em varios stories seguidos.
    story_reaction_auto_reply: 'lastStoryReactionReplyAt',
  };

  const claimed = await params.adminDb.runTransaction(async (txn: any) => {
    const contactSnap = await txn.get(contactRef);
    const contactData = contactSnap.exists ? contactSnap.data() || {} : {};
    const hasPriorContact = Boolean(
      contactData.firstInboundAt ||
      contactData.firstContactSentAt ||
      contactData.lastClosedReplyAt,
    );

    const reply = buildAutoReply({
      storeProfile,
      empresaId: params.empresaId,
      incoming: alvo,
      requestOrigin: params.requestOrigin,
      contactData,
      hasPriorContact,
    });

    const claimField = reply ? CLAIM_FIELD[reply.type] || '' : '';
    txn.set(contactRef, {
      empresaId: params.empresaId,
      phone: alvo.phone,
      address: alvo.address,
      ...(alvo.senderLid ? { senderLid: alvo.senderLid } : {}),
      ...(!hasPriorContact ? { firstInboundAt: params.now } : {}),
      lastInboundAt: params.now,
      updatedAt: params.now,
      ...(claimField ? { [claimField]: params.now } : {}),
    }, { merge: true });

    if (!reply || !claimField) return null;
    return { reply, claimField, previousClaim: contactData[claimField] ?? null };
  });

  if (!claimed) return false;
  const { reply, claimField, previousClaim } = claimed;

  const token = decryptSecret(integration.wapiTokenEncrypted);
  let result: any;
  try {
    result = await enviarComSegundaChance(() =>
      reply.imageUrl
        ? sendWuzImage(integration.wapiInstanceId, token, {
            phone: alvo.address,
            image: reply.imageUrl,
            caption: reply.message,
          })
        : sendWuzText(integration.wapiInstanceId, token, {
            phone: alvo.address,
            message: reply.message,
          }),
    );
  } catch (error) {
    // O carimbo volta atras para a proxima mensagem da pessoa ter nova chance, e
    // o motivo fica gravado: sem ele uma resposta perdida nao deixa rastro
    // nenhum e o dono so descobre pelo cliente reclamando.
    await contactRef
      .set(
        {
          [claimField]: previousClaim,
          lastSendError: String((error as any)?.message || error).slice(0, 300),
          lastSendErrorAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        { merge: true },
      )
      .catch(() => {});
    throw error;
  }

  await params.adminDb.collection('whatsapp_auto_replies').add({
    empresaId: params.empresaId,
    phone: alvo.phone,
    address: alvo.address,
    type: reply.type,
    message: reply.message.slice(0, 500),
    providerMessageId: result?.messageId || '',
    incomingText: alvo.text || '',
    createdAt: params.now,
  });

  return true;
}

/**
 * Recibo imediato, trabalho depois.
 *
 * O envio da resposta automatica tem teto de 20s e uma segunda chance — pior
 * caso ~42s com a conexao do webhook presa. Por isso o 200 sai na hora e o
 * processamento corre em `after()`. Nasceu com a W-API (19/09/2026), que
 * entregava cada webhook UMA vez e perdia calada a mensagem de um endpoint
 * lento; o servidor proprio reenvia (5 vezes, a cada 30 s), mas recibo rapido
 * continua sendo o que evita reenvio a toa.
 *
 * O que se perde se a funcao morrer no meio do `after()` e exatamente o que se
 * perderia se o webhook nao chegasse. Nada aqui dispensa o claim atomico de
 * `maybeSendAutoReply`: continua sendo ele que impede resposta dupla, inclusive
 * quando o servidor reenvia o mesmo evento.
 */
export async function POST(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Webhook nao autorizado.' }, { status: 401 });
  }

  const url = new URL(request.url);
  const payload = await request.json().catch(() => ({}));

  after(async () => {
    try {
      await processarEvento(url, payload);
    } catch (error) {
      console.error('[WhatsApp webhook] Falha ao processar o evento depois da resposta:', error);
    }
  });

  return NextResponse.json({ ok: true, queued: true });
}

async function processarEvento(url: URL, payload: any) {
  // Só o servidor de WhatsApp (WuzAPI) chama aqui: `type` + `event` em objeto,
  // e o leitor dele decide conexão, mensagem e saída da loja. Qualquer outro
  // formato é ignorado sem gravar nada.
  if (!ehEventoWuzapi(payload)) {
    console.warn('[WhatsApp webhook] Evento fora do formato do servidor; ignorado:', {
      chaves: Object.keys(payload || {}).slice(0, 10),
    });
    return;
  }

  const lido = lerEventoWuzapi(payload);
  // `event` no payload é o objeto do whatsmeow; o nome do evento é o `type`,
  // que o leitor já separou.
  const event = lido.event;
  const empresaIdFromUrl = url.searchParams.get('empresaId') || '';
  const webhookAuth = getWebhookToken(url);
  const now = new Date().toISOString();
  const adminDb = getOptionalAdminDb();

  if (!adminDb) {
    console.warn('[WhatsApp webhook] Firebase Admin indisponivel; evento ignorado sem envio automatico:', {
      event,
      empresaId: empresaIdFromUrl,
    });
    return;
  }

  let empresaId = '';
  let adminRef: FirebaseFirestore.DocumentReference | null = null;
  let integration: any = null;

  // Cada loja registra o webhook com o id dela na URL; a chave cifrada no `wt`
  // prova que o evento veio da sessão dessa loja (conferida logo abaixo).
  if (empresaIdFromUrl) {
    const ref = adminDb.collection('roles_admin').doc(empresaIdFromUrl);
    const data = (await ref.get()).data()?.whatsappIntegration;
    if (data) {
      adminRef = ref;
      empresaId = empresaIdFromUrl;
      integration = data;
    }
  }

  const instanceId = String(integration?.wapiInstanceId || '');

  if (adminRef && webhookAuth.present) {
    let tokenMatches = false;

    try {
      tokenMatches = Boolean(integration?.wapiTokenEncrypted && decryptSecret(integration.wapiTokenEncrypted) === webhookAuth.token);
    } catch (error) {
      console.warn('[WhatsApp webhook] Nao foi possivel validar o token da integracao:', { event, instanceId, empresaId, error });
    }

    if (!tokenMatches) {
      console.warn('[WhatsApp webhook] Ignorando atualizacao por token divergente:', { event, instanceId, empresaId });
      adminRef = null;
      empresaId = '';
      integration = null;
    }
  }

  await adminDb.collection('whatsapp_webhook_events').add({
    provider: 'wuzapi',
    event,
    instanceId: empresaId ? instanceId : '',
    empresaId,
    payload,
    createdAt: now,
    // Basta ligar a politica de TTL neste campo (console do Firestore) para a
    // colecao parar de crescer sozinha: sao alguns milhares de documentos por
    // dia, com o payload inteiro de cada mensagem.
    expireAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
  });

  let integrationUpdated = false;
  const { connected, disconnected, incoming } = lido;
  const livePhone = disconnected ? '' : lido.livePhone;

  console.log('[WhatsApp webhook] processando:', { event, instanceId, empresaId, connected, disconnected, livePhone: Boolean(livePhone) });

  if (adminRef && integration) {
    const patch: Record<string, unknown> = {};

    if (disconnected) {
      // So marca desconectado quem estava conectado, para nao reagir a eventos
      // transitorios repetidos.
      if (integration.connected) {
        console.log('[WhatsApp webhook] Marcando como desconectado:', { event, instanceId, empresaId });
        patch['whatsappIntegration.connected'] = false;
        patch['whatsappIntegration.status'] = 'disconnected';
      }
    } else if (connected || livePhone) {
      // O telefone de uma mensagem é o do CLIENTE: o da loja só vem no
      // `livePhone` que o leitor separou (no pareamento).
      const phone = livePhone || integration.numeroWhatsapp || '';
      // So grava quando algo realmente mudou — senao seria uma escrita no
      // Firestore a cada reconexao do socket.
      if (!integration.connected || (phone && integration.numeroWhatsapp !== phone)) {
        patch['whatsappIntegration.connected'] = true;
        patch['whatsappIntegration.status'] = 'connected';
        patch['whatsappIntegration.numeroWhatsapp'] = phone;
        patch['whatsappIntegration.qrCode'] = '';
        patch['whatsappIntegration.lastError'] = '';
      }
    }

    // Prova de vida do REGISTRO do webhook — coisa diferente da conexao do
    // celular. Se o evento chegou ate aqui, o webhook esta registrado no
    // servidor. O poll de status e o vigia usam este carimbo para decidir se
    // precisam refazer o registro. Gravado no maximo a cada
    // WEBHOOK_HEARTBEAT_MS: sem a trava seria uma escrita por mensagem recebida.
    const ultimoCarimbo = Date.parse(integration.lastWebhookAt || '') || 0;
    if (Date.now() - ultimoCarimbo > WEBHOOK_HEARTBEAT_MS) {
      patch['whatsappIntegration.lastWebhookAt'] = now;
    }

    if (Object.keys(patch).length > 0) {
      patch['whatsappIntegration.updatedAt'] = now;
      patch['whatsappIntegration.lastStatusAt'] = now;

      try {
        await adminRef.update(patch);
        integrationUpdated = true;
      } catch (error) {
        console.warn('[WhatsApp webhook] Evento persistido, mas integracao nao foi atualizada:', {
          event,
          instanceId,
          empresaId,
          error,
        });
      }
    }
  }

  // A outra ponta do reconhecimento: quem saiu do cardápio para o WhatsApp leva
  // um código na mensagem. Ele volta aqui e amarra o número de quem escreveu à
  // visita que estava vendo os produtos.
  if (adminRef && empresaId) {
    try {
      const codigo = extrairCodigoDaMensagem(incoming?.text || '');
      if (codigo) {
        await identificarVisitantePeloCodigo(adminDb, {
          storeId: empresaId,
          codigo,
          telefone: incoming?.phone || '',
          nome: incoming?.pushName || '',
        });
      }
    } catch (error) {
      console.warn('[WhatsApp webhook] Falha ao reconhecer visitante pelo codigo:', { empresaId, error });
    }
  }

  if (adminRef && empresaId) {
    try {
      await registrarSaidaDaLoja(adminDb, empresaId, lido.saidaDaLoja, now);
    } catch (error) {
      console.warn('[WhatsApp webhook] Falha ao carimbar saida da loja:', { empresaId, error });
    }
  }

  let autoReplySent = false;
  if (adminRef && empresaId) {
    try {
      autoReplySent = await maybeSendAutoReply({
        adminDb,
        adminRef,
        empresaId,
        incoming,
        requestOrigin: url.origin,
        now,
      });
    } catch (error) {
      console.warn('[WhatsApp webhook] Falha ao enviar resposta automatica:', { event, empresaId, error });
    }
  }

  console.log('[WhatsApp webhook] concluido:', { event, empresaId, integrationUpdated, autoReplySent });
}
