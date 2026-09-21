/**
 * A resposta automática do WhatsApp: qual texto sai, quando sai, e quando é
 * melhor ficar calado.
 *
 * Mora fora da rota do webhook para poder ser testada sozinha. É o código que
 * fala com CLIENTE de verdade — um erro aqui não aparece em tela nenhuma: ou a
 * loja manda mensagem repetida, ou deixa alguém falando sozinho.
 *
 * As decisões, na ordem em que são tomadas:
 *
 * 1. A LOJA falou com esta pessoa nas últimas 2 horas: cala. Atendimento humano
 *    em andamento não quer robô por cima — só o pedido explícito de cardápio
 *    (item 2) passa por essa porta.
 * 2. A pessoa PEDIU o cardápio (a mensagem traz o código da visita, gerado pelo
 *    botão do próprio cardápio). Responde sempre — só segura repetição em
 *    rajada. É pedido explícito: as janelas de silêncio abaixo não valem.
 * 3. Reação no story (o coraçãozinho): manda a saudação que a loja escreveu, no
 *    máximo uma por semana. Nunca o horário de funcionamento inteiro.
 * 4. Loja fechada: manda o aviso, no máximo um a cada 2 horas.
 * 5. Primeiro contato do número (ou depois de 12h de silêncio): manda a
 *    saudação com o link.
 * 6. Fora disso, cala: quem já está conversando com a loja não quer robô no
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

  // A W-API envia texto puro e nao gera o cartao de preview de link (o WhatsApp
  // so monta o preview quando o proprio app faz o scrape das og tags, o que nao
  // ocorre via API). Por isso TODA resposta automatica daqui sai como a logo da
  // loja + o texto na legenda: e o formato que o cliente reconhece como sendo da
  // loja. Sem imagem salva, cai no texto puro.
  const imageUrl =
    storeProfile?.general?.logoUrl ||
    storeProfile?.general?.ogImageUrl ||
    storeProfile?.general?.bannerUrl ||
    '';

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

  // A loja está atendendo esta pessoa agora: o robô não entra por cima. Vale
  // para a saudação, para o aviso de fechado e para o agradecimento de story —
  // só o pedido explícito de cardápio passa, porque aí a pessoa apertou um
  // botão esperando o link de volta.
  const lastOutboundMs = emMillis(params.contactData?.lastOutboundAt);
  const lojaFalouAgora = lastOutboundMs > 0 && nowMs - lastOutboundMs <= JANELA_DA_CONVERSA_HUMANA_MS;
  if (lojaFalouAgora && !pediuLink) return null;

  // Reação no story não é pergunta: o que sai é a SAUDAÇÃO que a dona escreveu
  // na tela de mensagens automáticas — a mesma de quem chega pela primeira vez,
  // curta e com o link. Nunca o horário de funcionamento inteiro, e nunca um
  // texto inventado aqui no código: o cliente tem que reconhecer a loja no que
  // recebe. Fora da janela, o silêncio é a resposta certa, e ela não gasta o
  // "primeiro contato" de quem ainda vai escrever de verdade.
  if (params.incoming.isStoryReaction) {
    const ultimo = emMillis(params.contactData?.lastStoryReactionReplyAt);
    if (ultimo && nowMs - ultimo <= JANELA_DA_REACAO_NO_STORY_MS) return null;

    const texto = renderWhatsAppTemplate(messages.firstContact, {
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
    if (!texto) return null;
    // Com a logo, como todas as outras. Este ramo saia daqui antes da linha que
    // monta a imagem, entao o agradecimento chegava como texto pelado com o link
    // cru — a unica resposta da loja com cara diferente das demais.
    return { message: texto, type: 'story_reaction_auto_reply', imageUrl: imageUrl || undefined };
  }

  if (pediuLink && (!lastLinkReplyAt || nowMs - lastLinkReplyAt > JANELA_DO_PEDIDO_DE_LINK_MS)) {
    // Fechada, a pessoa recebe o aviso E o link: quem pede o cardápio às 23h
    // quer olhar agora e pedir amanhã. Quando o aviso que a loja escreveu não
    // traz o {link}, o que vai junto é a SAUDAÇÃO dela — que traz —, nunca uma
    // linha de endereço inventada aqui no código.
    const aviso = openState.isOpen ? '' : messages.storeClosed;
    template = !aviso
      ? messages.firstContact
      : aviso.includes('{link}')
        ? aviso
        : `${aviso}\n\n${messages.firstContact}`;
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

  return { message, type, imageUrl: imageUrl || undefined };
}
