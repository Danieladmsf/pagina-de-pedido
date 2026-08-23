/**
 * A resposta automática do WhatsApp: qual texto sai, quando sai, e quando é
 * melhor ficar calado.
 *
 * Mora fora da rota do webhook para poder ser testada sozinha. É o código que
 * fala com CLIENTE de verdade — um erro aqui não aparece em tela nenhuma: ou a
 * loja manda mensagem repetida, ou deixa alguém falando sozinho.
 *
 * As quatro decisões, na ordem em que são tomadas:
 *
 * 1. A pessoa PEDIU o cardápio (a mensagem traz o código da visita, gerado pelo
 *    botão do próprio cardápio). Responde sempre — só segura repetição em
 *    rajada. É pedido explícito: as janelas de silêncio abaixo não valem.
 * 2. Loja fechada: manda o aviso, no máximo um a cada 2 horas.
 * 3. Primeiro contato do número (ou depois de 12h de silêncio): manda a
 *    saudação com o link.
 * 4. Fora disso, cala: quem já está conversando com a loja não quer robô no
 *    meio da conversa.
 */
import {
  buildStoreLink,
  formatNextOpeningTime,
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

export interface ContatoDoAutoReply {
  firstInboundAt?: string | number;
  lastInboundAt?: string | number;
  firstContactSentAt?: string | number;
  lastClosedReplyAt?: string | number;
  lastLinkReplyAt?: string | number;
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

export function buildAutoReply(params: {
  storeProfile: any;
  empresaId: string;
  incoming: { phone: string; text?: string };
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

  let template = '';
  let type = '';
  const nowMs = params.agora ?? Date.now();
  const lastClosedReplyAt = emMillis(params.contactData?.lastClosedReplyAt);
  const lastInboundMs = emMillis(params.contactData?.lastInboundAt);
  const lastLinkReplyAt = emMillis(params.contactData?.lastLinkReplyAt);

  // Pedido explícito de cardápio: a mensagem veio do botão do cardápio e traz o
  // código da visita. Responde SEMPRE, fora da janela de 12h da saudação —
  // cliente que já falou com a loja de manhã pediria o link à tarde e ficaria
  // esperando uma resposta que nunca sairia.
  const pediuLink = Boolean(extrairCodigoDaMensagem(params.incoming.text || ''));

  if (pediuLink && (!lastLinkReplyAt || nowMs - lastLinkReplyAt > JANELA_DO_PEDIDO_DE_LINK_MS)) {
    // Fechada, a pessoa recebe o aviso E o link: quem pede o cardápio às 23h
    // quer olhar agora e pedir amanhã. Só acrescenta o endereço se o texto do
    // aviso não trouxer o {link} por conta própria.
    const aviso = openState.isOpen ? '' : messages.storeClosed;
    template = !aviso
      ? messages.firstContact
      : aviso.includes('{link}')
        ? aviso
        : `${aviso}\n\n🍽️ Cardápio: {link}`;
    type = 'link_request_auto_reply';
  } else if (!openState.isOpen) {
    if (lastClosedReplyAt && nowMs - lastClosedReplyAt <= JANELA_DA_LOJA_FECHADA_MS) {
      return null;
    }

    template = messages.storeClosed;
    type = 'store_closed_auto_reply';
  } else if (
    !params.contactData?.firstContactSentAt ||
    (lastInboundMs > 0 && nowMs - lastInboundMs > JANELA_DA_SAUDACAO_MS)
  ) {
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
