import { NextResponse } from 'next/server';
import { getOptionalAdminDb } from '@/lib/firebase-admin';
import { decryptSecret } from '@/lib/wapi/crypto';
import { getWapiConnectedPhone, sendWapiTextMessage, sendWapiImageMessage, setWapiAutoRead } from '@/lib/wapi/wapi.service';
import {
  getLiveConnectedPhone,
  isConnectedEvent,
  isDisconnectedEvent,
} from '@/lib/wapi/connection-events';
import { extractIncomingMessage } from '@/lib/wapi/incoming-message';
import {
  buildStoreLink,
  formatWorkingHours,
  getStoreOpenState,
  getWhatsAppMessages,
  renderWhatsAppTemplate,
  formatNextOpeningTime,
} from '@/lib/whatsapp-messages';
import { VALIDADE_PADRAO_DIAS, adicionarMarca, extrairCodigoDaMensagem } from '@/lib/contato-link';
import { criarMarcaDeContato } from '@/lib/contato-link.server';
import { identificarVisitantePeloCodigo } from '@/lib/visitantes.server';

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

function getInstanceId(payload: any) {
  return payload?.instanceId || payload?.instance_id || payload?.instance?.id || '';
}

function getWebhookToken(url: URL) {
  const encryptedToken = url.searchParams.get('wt');
  if (!encryptedToken) return { present: false, token: '' };

  try {
    return { present: true, token: decryptSecret(encryptedToken) };
  } catch (error) {
    console.warn('[W-API webhook] Token do webhook invalido ou expirado:', error);
    return { present: true, token: '' };
  }
}

function getConnectedPhone(payload: any) {
  return getWapiConnectedPhone(payload);
}

/**
 * Acrescenta a marca de contato ao link do cardápio. Best-effort: qualquer
 * problema (servidor sem a chave, telefone estranho) devolve o link como estava
 * — mensagem de cliente não pode deixar de sair por causa disso.
 */
function marcarParaContato(link: string, empresaId: string, telefone: string): string {
  if (!link || !telefone) return link;
  try {
    return adicionarMarca(link, criarMarcaDeContato(empresaId, telefone, VALIDADE_PADRAO_DIAS));
  } catch {
    return link;
  }
}

function buildAutoReply(params: {
  storeProfile: any;
  empresaId: string;
  incoming: { phone: string; text?: string };
  requestOrigin: string;
  contactData?: { firstInboundAt?: string | number; lastInboundAt?: string | number; firstContactSentAt?: string | number; lastClosedReplyAt?: string | number };
  hasPriorContact?: boolean;
}) {
  const storeProfile = params.storeProfile || {};
  const messages = getWhatsAppMessages(storeProfile?.whatsappMessages);
  const storeName = storeProfile?.general?.name || storeProfile?.storeName || 'Minha loja';
  const storeLinkBase = buildStoreLink(storeProfile, params.empresaId, process.env.NEXT_PUBLIC_APP_URL || params.requestOrigin);
  // O link sai marcado para ESTE contato: quem clicar é reconhecido no painel
  // sem digitar nada (o site não tem como ler o telefone de quem abre a página).
  // Sem telefone — contato fora da agenda, que chega só como @lid — o link vai
  // limpo, como sempre foi.
  const storeLink = marcarParaContato(storeLinkBase, params.empresaId, params.incoming.phone);
  const openState = getStoreOpenState(storeProfile);

  let template = '';
  let type = '';
  const nowMs = Date.now();
  const lastClosedReplyAt = params.contactData?.lastClosedReplyAt
    ? new Date(params.contactData.lastClosedReplyAt).getTime()
    : 0;

  const lastInboundMs = params.contactData?.lastInboundAt
    ? new Date(params.contactData.lastInboundAt).getTime()
    : 0;

  if (!openState.isOpen) {
    if (lastClosedReplyAt && nowMs - lastClosedReplyAt <= 2 * 60 * 60 * 1000) {
      return null;
    }

    template = messages.storeClosed;
    type = 'store_closed_auto_reply';
  } else if (!params.contactData?.firstContactSentAt || (lastInboundMs > 0 && nowMs - lastInboundMs > 12 * 60 * 60 * 1000)) {
    template = messages.firstContact;
    type = 'first_contact_auto_reply';
  }

  const message = renderWhatsAppTemplate(template, {
    loja: storeName,
    link: storeLink,
    horarios: formatWorkingHours(storeProfile?.workingHours),
    proxima_abertura: formatNextOpeningTime(storeProfile?.workingHours, storeProfile?.plannedClosures, storeProfile?.general?.timezone),
    cliente: '',
    primeiro_nome: '',
    pedido: '',
    itens: '',
    total: '',
    pagamento: '',
    tempo_estimado: '',
  }).trim();

  if (!message || !type) return null;

  // A W-API envia texto puro e nao gera o cartao de preview de link (o WhatsApp
  // so monta o preview quando o proprio app faz o scrape das og tags, o que nao
  // ocorre via API). Por isso, nas respostas automaticas com link mandamos a
  // logo da loja como imagem e o texto/link na legenda — assim a marca sempre
  // aparece junto do link. Sem imagem salva, cai no texto puro.
  const imageUrl =
    storeProfile?.general?.logoUrl ||
    storeProfile?.general?.ogImageUrl ||
    storeProfile?.general?.bannerUrl ||
    '';

  return { message, type, imageUrl: imageUrl || undefined };
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
 * Em 22/08/2026 tres respostas automaticas morreram com a W-API pendurada por
 * 31 segundos: o claim voltava atras e a mensagem sumia sem deixar rastro. Erro
 * de dado (4xx) nao melhora repetindo; queda de rede, timeout e erro do
 * provedor, sim.
 */
async function enviarComSegundaChance<T>(enviar: () => Promise<T>): Promise<T> {
  try {
    return await enviar();
  } catch (error: any) {
    const status = Number(error?.status) || 0;
    const valeRepetir = status === 0 || status === 408 || status === 429 || status >= 500;
    if (!valeRepetir) throw error;

    console.warn('[W-API webhook] Envio falhou; tentando uma segunda vez:', {
      status,
      erro: String(error?.message || error),
    });
    await new Promise((resolve) => setTimeout(resolve, 2000));
    return await enviar();
  }
}

async function maybeSendAutoReply(params: {
  adminDb: any;
  adminRef: any;
  empresaId: string;
  payload: any;
  event: string;
  hook?: string;
  requestOrigin: string;
  now: string;
}) {
  const incoming = extractIncomingMessage(params.payload, params.event, params.hook);
  // `address` e o telefone quando ele veio, senao o "<lid>@lid" — contato fora
  // da agenda da loja chega so com LID, e a W-API aceita ele no lugar do numero.
  if (!incoming?.address) return false;

  // Proteção contra sincronização de histórico: 
  // Se a mensagem for mais velha que 5 minutos, ignorar para não responder mensagens antigas.
  if (incoming.timestamp) {
    const msgTimeMs = incoming.timestamp > 9999999999 ? incoming.timestamp : incoming.timestamp * 1000;
    const nowMs = Date.now();
    if (nowMs - msgTimeMs > 5 * 60 * 1000) {
      console.log('[W-API webhook] Ignorando mensagem antiga (sincronização de histórico):', { address: incoming.address, ageMs: nowMs - msgTimeMs });
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
  // (rajada de mensagens, retries da W-API) relerem o doc ja carimbado e
  // desistirem. Se o envio falhar, o claim e devolvido no catch abaixo.
  const CLAIM_FIELD: Record<string, string> = {
    first_contact_auto_reply: 'firstContactSentAt',
    store_closed_auto_reply: 'lastClosedReplyAt',
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
        ? sendWapiImageMessage(integration.wapiInstanceId, token, {
            phone: alvo.address,
            image: reply.imageUrl,
            caption: reply.message,
            delayMessage: 2,
          })
        : sendWapiTextMessage(integration.wapiInstanceId, token, {
            phone: alvo.address,
            message: reply.message,
            delayMessage: 2,
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
    providerMessageId: result?.messageId || result?.insertedId || '',
    incomingText: alvo.text || '',
    createdAt: params.now,
  });

  return true;
}

export async function POST(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Webhook nao autorizado.' }, { status: 401 });
  }

  const url = new URL(request.url);
  const payload = await request.json().catch(() => ({}));
  const instanceId = getInstanceId(payload);
  const event = payload?.event || payload?.type || 'unknown';
  const hook = url.searchParams.get('hook') || '';
  const empresaIdFromUrl = url.searchParams.get('empresaId') || '';
  const webhookAuth = getWebhookToken(url);
  const now = new Date().toISOString();
  const adminDb = getOptionalAdminDb();

  if (!adminDb) {
    console.warn('[W-API webhook] Firebase Admin indisponivel; evento ignorado sem envio automatico:', {
      event,
      instanceId,
      empresaId: empresaIdFromUrl,
    });
    return NextResponse.json({ ok: true, persisted: false, autoReplySent: false });
  }

  let empresaId = '';
  let adminRef: FirebaseFirestore.DocumentReference | null = null;
  let integration: any = null;

  // A loja indicada na URL do webhook tem prioridade, desde que ela realmente
  // use esta instancia. A busca por instanceId com `.limit(1)` escolhia sempre a
  // primeira loja na ordem do indice: com duas lojas apontando para a mesma
  // instancia (ja aconteceu em producao), a segunda ficava permanentemente muda.
  if (empresaIdFromUrl) {
    const ref = adminDb.collection('roles_admin').doc(empresaIdFromUrl);
    const data = (await ref.get()).data()?.whatsappIntegration;
    if (data && (!instanceId || data.wapiInstanceId === instanceId)) {
      adminRef = ref;
      empresaId = empresaIdFromUrl;
      integration = data;
    }
  }

  if (!adminRef && instanceId) {
    const snap = await adminDb
      .collection('roles_admin')
      .where('whatsappIntegration.wapiInstanceId', '==', instanceId)
      .limit(2)
      .get();

    if (snap.size > 1) {
      console.warn('[W-API webhook] Instancia usada por mais de uma loja; evento atribuido a primeira:', {
        instanceId,
        lojas: snap.docs.map((doc) => doc.id),
      });
    }
    if (!snap.empty) {
      adminRef = snap.docs[0].ref;
      empresaId = snap.docs[0].id;
      integration = snap.docs[0].data()?.whatsappIntegration;
    }
  }

  if (adminRef && webhookAuth.present) {
    let tokenMatches = false;

    try {
      tokenMatches = Boolean(integration?.wapiTokenEncrypted && decryptSecret(integration.wapiTokenEncrypted) === webhookAuth.token);
    } catch (error) {
      console.warn('[W-API webhook] Nao foi possivel validar o token da integracao:', { event, instanceId, empresaId, error });
    }

    if (!tokenMatches) {
      console.warn('[W-API webhook] Ignorando atualizacao por token divergente:', { event, instanceId, empresaId });
      adminRef = null;
      empresaId = '';
      integration = null;
    }
  }

  await adminDb.collection('whatsapp_webhook_events').add({
    provider: 'wapi',
    event,
    hook,
    instanceId,
    empresaId,
    payload,
    createdAt: now,
    // Basta ligar a politica de TTL neste campo (console do Firestore) para a
    // colecao parar de crescer sozinha: sao alguns milhares de documentos por
    // dia, com o payload inteiro de cada mensagem.
    expireAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
  });

  let integrationUpdated = false;
  const connected = isConnectedEvent(payload, event, hook);
  const disconnected = isDisconnectedEvent(payload, event, hook);
  const livePhone = disconnected ? '' : getLiveConnectedPhone(payload);

  console.log('[W-API webhook] processando:', { event, hook, instanceId, empresaId, connected, disconnected, livePhone: Boolean(livePhone) });

  if (adminRef && integration) {
    const patch: Record<string, unknown> = {};

    if (disconnected) {
      // So marca desconectado quem estava conectado, para nao reagir a eventos
      // transitorios repetidos.
      if (integration.connected) {
        console.log('[W-API webhook] Marcando como desconectado:', { event, instanceId, empresaId });
        patch['whatsappIntegration.connected'] = false;
        patch['whatsappIntegration.status'] = 'disconnected';
      }
    } else if (connected || livePhone) {
      const phone = livePhone || getConnectedPhone(payload) || integration.numeroWhatsapp || '';
      // `livePhone` chega junto de TODA mensagem, entao so gravamos quando algo
      // realmente mudou — senao seria uma escrita no Firestore por mensagem
      // recebida (milhares por dia).
      if (!integration.connected || (phone && integration.numeroWhatsapp !== phone)) {
        patch['whatsappIntegration.connected'] = true;
        patch['whatsappIntegration.status'] = 'connected';
        patch['whatsappIntegration.numeroWhatsapp'] = phone;
        patch['whatsappIntegration.qrCode'] = '';
        patch['whatsappIntegration.lastError'] = '';
      }
    }

    // Prova de vida do REGISTRO do webhook — coisa diferente da conexao do
    // celular. Se o evento chegou ate aqui, os PUTs de webhook estao de pe na
    // W-API. O poll de status usa este carimbo para decidir se precisa refazer o
    // registro (ver /wapi/status). Gravado no maximo a cada WEBHOOK_HEARTBEAT_MS:
    // sem a trava seria uma escrita no Firestore por mensagem recebida.
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
        console.warn('[W-API webhook] Evento persistido, mas integracao nao foi atualizada:', {
          event,
          instanceId,
          empresaId,
          error,
        });
      }
    }
  }

  // A cada conexao, reforca o desligamento da "Leitura automatica" do W-API.
  // Sem isso a instancia marca status/stories como lidos e a conta passa a
  // "visualizar" o status de todos os contatos sozinha. O `wt` do webhook ja
  // carrega o token da instancia, entao corrige lojas existentes no proximo
  // reconnect sem acao manual. Best-effort: nao afeta o restante do webhook.
  if (connected && instanceId && webhookAuth.token) {
    setWapiAutoRead(instanceId, webhookAuth.token, false).catch((error) => {
      console.warn('[W-API webhook] Falha ao desligar leitura automatica no connect:', { instanceId, empresaId, error });
    });
  }

  // A outra ponta do reconhecimento: quem saiu do cardápio para o WhatsApp leva
  // um código na mensagem. Ele volta aqui e amarra o número de quem escreveu à
  // visita que estava vendo os produtos.
  if (adminRef && empresaId) {
    try {
      const incoming = extractIncomingMessage(payload, event, hook);
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
      console.warn('[W-API webhook] Falha ao reconhecer visitante pelo codigo:', { empresaId, error });
    }
  }

  let autoReplySent = false;
  if (adminRef && empresaId) {
    try {
      autoReplySent = await maybeSendAutoReply({
        adminDb,
        adminRef,
        empresaId,
        payload,
        event,
        hook,
        requestOrigin: new URL(request.url).origin,
        now,
      });
    } catch (error) {
      console.warn('[W-API webhook] Falha ao enviar resposta automatica:', { event, empresaId, error });
    }
  }

  return NextResponse.json({ ok: true, persisted: true, empresaId, integrationUpdated, autoReplySent });
}
