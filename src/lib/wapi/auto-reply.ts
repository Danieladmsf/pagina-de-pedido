/**
 * A resposta automática do WhatsApp: qual texto sai, quando sai, e quando é
 * melhor ficar calado.
 *
 * Mora fora da rota do webhook para poder ser testada sozinha. É o código que
 * fala com CLIENTE de verdade — um erro aqui não aparece em tela nenhuma: ou a
 * loja manda mensagem repetida, ou deixa alguém falando sozinho.
 *
 * O QUE sai tem uma regra só: loja aberta manda a saudação (firstContact),
 * loja fechada manda o aviso de fechado (storeClosed). Vale para qualquer
 * interação — mensagem, pedido de cardápio, reação no story. Os textos são os
 * que a loja escreveu; nunca se misturam numa mesma resposta.
 *
 * O resto só decide SE responde, para o robô não repetir nem atropelar:
 *
 * 1. A LOJA falou com esta pessoa nas últimas 2 horas: cala. Só o pedido
 *    explícito de cardápio passa por essa porta.
 * 2. Pedido de cardápio (mensagem com o código da visita, do botão do próprio
 *    cardápio): responde sempre, só segura a repetição em 2 minutos.
 * 3. Reação no story: no máximo uma resposta por semana.
 * 4. Loja fechada: no máximo um aviso a cada 2 horas.
 * 5. Loja aberta: saudação no primeiro contato ou depois de 12h de silêncio.
 * 6. Uma resposta automática por vez: depois do link ou da resposta ao story,
 *    a próxima mensagem da pessoa não ganha outra resposta em seguida.
 */
import {
  buildStoreLink,
  formatNextOpeningTime,
  formatTodayClosingTime,
  formatWorkingHours,
  getStoreOpenState,
  getWhatsAppMessages,
  renderWhatsAppTemplate,
} from '@/lib/whatsapp-messages';
import { VALIDADE_PADRAO_DIAS, adicionarMarca, extrairCodigoDaMensagem } from '@/lib/contato-link';
import { criarMarcaDeContato } from '@/lib/contato-link.server';
import { adicionarOrigem } from '@/lib/origem';

/** Quanto tempo depois de mandar o link a loja se recusa a mandar de novo. */
export const JANELA_DO_PEDIDO_DE_LINK_MS = 2 * 60 * 1000;
/** Silêncio mínimo entre dois avisos de "estamos fechados". */
export const JANELA_DA_LOJA_FECHADA_MS = 2 * 60 * 60 * 1000;
/** Depois disso, a conversa é considerada nova e a saudação volta a valer. */
export const JANELA_DA_SAUDACAO_MS = 12 * 60 * 60 * 1000;
/**
 * Quanto tempo o robô fica calado depois que a LOJA falou com a pessoa.
 *
 * Em 18/09/2026 a dona respondeu uma cliente por áudio às 16:34 e mandou três
 * documentos às 16:35; às 16:36 o robô soltou "seja bem-vindo, veja o cardápio"
 * na mesma conversa. Duas horas cobrem um atendimento em andamento sem segurar
 * a saudação de quem volta no dia seguinte.
 */
export const JANELA_DA_CONVERSA_HUMANA_MS = 2 * 60 * 60 * 1000;
/**
 * Silêncio mínimo entre dois agradecimentos por reação no story.
 *
 * Quem acompanha a loja reage quase todo dia: uma cliente recebeu 16 respostas
 * automáticas em 6 semanas, 7 delas só por mandar um coração verde. Uma por
 * semana mantém o carinho sem virar perseguição.
 */
export const JANELA_DA_REACAO_NO_STORY_MS = 7 * 24 * 60 * 60 * 1000;

export interface ContatoDoAutoReply {
  firstInboundAt?: string | number;
  lastInboundAt?: string | number;
  firstContactSentAt?: string | number;
  lastClosedReplyAt?: string | number;
  lastLinkReplyAt?: string | number;
  /** Última vez que a LOJA (pessoa, não robô) mandou mensagem para este contato. */
  lastOutboundAt?: string | number;
  lastStoryReactionReplyAt?: string | number;
}

export interface AutoReply {
  message: string;
  type: string;
  imageUrl?: string;
}

/**
 * Acrescenta a marca de contato ao link do cardápio. Best-effort: qualquer
 * problema (servidor sem a chave, telefone estranho) devolve o link como estava
 * — mensagem de cliente não pode deixar de sair por causa disso.
 */
export function marcarParaContato(link: string, empresaId: string, telefone: string): string {
  if (!link || !telefone) return link;
  try {
    return adicionarMarca(link, criarMarcaDeContato(empresaId, telefone, VALIDADE_PADRAO_DIAS));
  } catch {
    return link;
  }
}

const emMillis = (valor?: string | number) => (valor ? new Date(valor).getTime() : 0);

/**
 * O que a mensagem recebida grava no contato, além do carimbo da resposta.
 *
 * A reação no story não conta como conversa. Em 03/10/2026 uma cliente da
 * Gostinho mandou um coração no story (sem resposta: já tinha ganhado o
 * agradecimento da semana) e, 27 segundos depois, comentou o mesmo story. O
 * coração tinha virado `lastInboundAt` e o comentário caiu como "no meio da
 * conversa": ficou sem a saudação, depois de dias sem falar com a loja.
 */
export function carimboDaMensagemRecebida(
  incoming: { isStoryReaction?: boolean },
  agora: string,
): { lastInboundAt?: string } {
  return incoming.isStoryReaction ? {} : { lastInboundAt: agora };
}

export function buildAutoReply(params: {
  storeProfile: any;
  empresaId: string;
  incoming: { phone: string; text?: string; isStoryReaction?: boolean };
  requestOrigin: string;
  contactData?: ContatoDoAutoReply;
  hasPriorContact?: boolean;
  /** Só para teste: o relógio de agora. */
  agora?: number;
}): AutoReply | null {
  const storeProfile = params.storeProfile || {};
  const messages = getWhatsAppMessages(storeProfile?.whatsappMessages);
  const storeName = storeProfile?.general?.name || storeProfile?.storeName || 'Minha loja';
  // Todo link que sai daqui nasce com a origem `whatsapp`: quem entrar por ele
  // entrou pela conversa, e a tela de visitantes consegue separar isso de quem
  // veio do Instagram ou do panfleto.
  const storeLinkBase = adicionarOrigem(
    buildStoreLink(storeProfile, params.empresaId, process.env.NEXT_PUBLIC_APP_URL || params.requestOrigin),
    'whatsapp'
  );
  // O link sai marcado para ESTE contato: quem clicar é reconhecido no painel
  // sem digitar nada (o site não tem como ler o telefone de quem abre a página).
  // Sem telefone — contato fora da agenda, que chega só como @lid — o link vai
  // limpo, como sempre foi.
  const storeLink = marcarParaContato(storeLinkBase, params.empresaId, params.incoming.phone);
  const openState = getStoreOpenState(storeProfile);

  // Mensagem enviada pela API sai como texto puro, sem o cartao de preview de
  // link (o WhatsApp so monta o preview quando o proprio app faz o scrape das og
  // tags). Por isso TODA resposta automatica daqui sai como a logo da loja + o
  // texto na legenda: e o formato que o cliente reconhece como sendo da loja.
  // Sem imagem salva, cai no texto puro.
  const imageUrl =
    storeProfile?.general?.logoUrl ||
    storeProfile?.general?.ogImageUrl ||
    storeProfile?.general?.bannerUrl ||
    '';

  let type = '';
  const nowMs = params.agora ?? Date.now();
  const lastClosedReplyAt = emMillis(params.contactData?.lastClosedReplyAt);
  const lastInboundMs = emMillis(params.contactData?.lastInboundAt);
  const lastLinkReplyAt = emMillis(params.contactData?.lastLinkReplyAt);
  const lastStoryReplyAt = emMillis(params.contactData?.lastStoryReactionReplyAt);
  const dentro = (quando: number, janela: number) => quando > 0 && nowMs - quando <= janela;

  // O TEXTO só depende de a loja estar aberta ou fechada — seja mensagem,
  // pedido de cardápio ou reação no story. Regra da dona (27/09/2026): "são só
  // duas, aberta ou fechada". Antes a reação no story mandava "faça seu pedido"
  // com a loja fechada, e o pedido de cardápio colava as duas mensagens.
  const template = openState.isOpen ? messages.firstContact : messages.storeClosed;

  // Pedido explícito de cardápio: a mensagem veio do botão do cardápio e traz o
  // código da visita. Responde SEMPRE, fora da janela de 12h da saudação —
  // cliente que já falou com a loja de manhã pediria o link à tarde e ficaria
  // esperando uma resposta que nunca sairia.
  const pediuLink = Boolean(extrairCodigoDaMensagem(params.incoming.text || ''));

  // A loja está atendendo esta pessoa agora: o robô não entra por cima. Vale
  // para a saudação, para o aviso de fechado e para a reação no story — só o
  // pedido explícito de cardápio passa, porque aí a pessoa apertou um botão
  // esperando o link de volta.
  const lastOutboundMs = emMillis(params.contactData?.lastOutboundAt);
  const lojaFalouAgora = lastOutboundMs > 0 && nowMs - lastOutboundMs <= JANELA_DA_CONVERSA_HUMANA_MS;
  if (lojaFalouAgora && !pediuLink) return null;

  // Daqui para baixo só se decide SE responde — nunca o quê. É uma resposta
  // automática por vez: a mensagem que chega logo atrás (o mesmo evento
  // entregue de novo, ou o "oi bom dia" 5 segundos depois do link) não ganha
  // uma segunda mensagem repetindo a que acabou de sair. Entre 14 e 26/09
  // foram 9 conversas com duas respostas automáticas no mesmo minuto.
  const avisouFechadoAgora =
    dentro(lastClosedReplyAt, JANELA_DA_LOJA_FECHADA_MS) ||
    dentro(lastLinkReplyAt, JANELA_DA_LOJA_FECHADA_MS) ||
    dentro(lastStoryReplyAt, JANELA_DA_LOJA_FECHADA_MS);
  const saudouAgora =
    dentro(lastLinkReplyAt, JANELA_DA_SAUDACAO_MS) || dentro(lastStoryReplyAt, JANELA_DA_SAUDACAO_MS);

  if (params.incoming.isStoryReaction) {
    // Quem reage quase todo dia não recebe resposta todo dia. E a reação não
    // gasta o "primeiro contato" de quem ainda vai escrever de verdade.
    if (dentro(lastStoryReplyAt, JANELA_DA_REACAO_NO_STORY_MS)) return null;
    if (!openState.isOpen && avisouFechadoAgora) return null;
    type = 'story_reaction_auto_reply';
  } else if (pediuLink) {
    if (dentro(lastLinkReplyAt, JANELA_DO_PEDIDO_DE_LINK_MS)) return null;
    type = 'link_request_auto_reply';
  } else if (!openState.isOpen) {
    if (avisouFechadoAgora) return null;
    type = 'store_closed_auto_reply';
  } else if (
    (!params.contactData?.firstContactSentAt ||
      (lastInboundMs > 0 && nowMs - lastInboundMs > JANELA_DA_SAUDACAO_MS)) &&
    !saudouAgora
  ) {
    type = 'first_contact_auto_reply';
  }

  const message = renderWhatsAppTemplate(template, {
    loja: storeName,
    link: storeLink,
    horarios: formatWorkingHours(storeProfile?.workingHours),
    proxima_abertura: formatNextOpeningTime(storeProfile?.workingHours, storeProfile?.plannedClosures, storeProfile?.general?.timezone),
    fechamento_hoje: formatTodayClosingTime(storeProfile?.workingHours, storeProfile?.plannedClosures, storeProfile?.general?.timezone),
    cliente: '',
    primeiro_nome: '',
    pedido: '',
    itens: '',
    total: '',
    pagamento: '',
    tempo_estimado: '',
  }).trim();

  if (!message || !type) return null;

  return { message, type, imageUrl: imageUrl || undefined };
}
