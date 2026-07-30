import { describe, expect, it } from 'vitest';
import { extractIncomingMessage } from './incoming-message';

/**
 * Payloads REAIS colhidos de `whatsapp_webhook_events` em producao
 * (2026-07-29/30), com thumbnails e chaves de criptografia recortados.
 *
 * Este arquivo existe porque o filtro ja engoliu conversa de verdade duas
 * vezes: primeiro bloqueando `@lid` (matou TODA resposta automatica por 16h) e
 * depois lendo `contextInfo.remoteJID = status@broadcast` como "isso e um
 * status" — justamente o comentario que o cliente deixa no story da loja.
 *
 * Regra ao mexer aqui: bloqueio olha o DESTINO (chat.id/remoteJid). O que a
 * mensagem CITA (contextInfo/quotedMessage) nunca decide bloqueio.
 */

/** Cliente respondendo ao story da loja: DM real, com o status citado. */
const RESPOSTA_A_STORY = {
  event: 'webhookReceived',
  instanceId: 'LITE-8NDQT1-UWX43P',
  connectedPhone: '5516993638485',
  isGroup: false,
  messageId: 'B1F4A0C2D3E4F5A6',
  fromMe: false,
  chat: { id: '193351022338136@lid' },
  sender: {
    id: '5516992070241',
    senderLid: '193351022338136@lid',
    pushName: 'Aline 💙❤️🙏🏼',
  },
  moment: 1785406743,
  msgContent: {
    extendedTextMessage: {
      text: 'Quero meu copo da gostinho do céu 🤨🤭',
      contextInfo: {
        participant: '62169752330325@lid',
        remoteJID: 'status@broadcast',
        stanzaId: '3AF1C9B8E7D6',
        quotedMessage: { imageMessage: { mimetype: 'image/jpeg' } },
      },
    },
  },
};

/** Mesma coisa, com o marcador de origem que a W-API manda junto. */
const RESPOSTA_A_STORY_COM_ENTRYPOINT = {
  event: 'webhookReceived',
  instanceId: 'LITE-8NDQT1-UWX43P',
  isGroup: false,
  fromMe: false,
  chat: { id: '18824925560848@lid' },
  sender: { id: '5516991864790', senderLid: '18824925560848@lid', pushName: 'Vanessa Cristina 💞' },
  moment: 1785353053,
  msgContent: {
    extendedTextMessage: {
      text: 'Oiii, ainda tem??',
      contextInfo: {
        entryPointConversionApp: 'whatsapp',
        entryPointConversionSource: 'status',
        entryPointConversionDelaySeconds: 0,
        participant: '62169752330325@lid',
        remoteJID: 'status@broadcast',
        quotedMessage: { videoMessage: { mimetype: 'video/mp4' } },
      },
    },
  },
};

/** Story de um contato chegando na instancia: chat.id = "status". */
const STORY_DE_CONTATO = {
  event: 'webhookReceived',
  instanceId: 'LITE-JMDANG-I3824S',
  isGroup: false,
  fromMe: false,
  chat: { id: 'status' },
  sender: { id: '90821495885900', senderLid: '90821495885900@lid', pushName: 'Letícia' },
  moment: 1785448286,
  msgContent: {
    videoMessage: {
      caption: 'Amoooo vcc❤😍',
      contextInfo: { posterStatusID: 'M7uWErFTpRIOt4TKtuv8TTvfLANnHLNsVCwLH66ADjE=', statusSourceType: 'VIDEO' },
    },
  },
};

/** Story so de texto — mesma forma, chat.id = "status". */
const STORY_DE_TEXTO = {
  event: 'webhookReceived',
  instanceId: 'LITE-JMDANG-I3824S',
  isGroup: false,
  fromMe: false,
  chat: { id: 'status' },
  sender: { id: '206197202411654', senderLid: '206197202411654@lid' },
  moment: 1785443987,
  msgContent: { conversation: 'Hoje estaremos atendendo até as 18:00 hrs,desde já agradeço a compreensão 🥰' },
};

const MENSAGEM_DE_GRUPO = {
  event: 'webhookReceived',
  instanceId: 'LITE-8NDQT1-UWX43P',
  isGroup: true,
  fromMe: false,
  chat: { id: '120363208662219926@g.us' },
  sender: { id: '5516992153611', pushName: 'Marcia' },
  moment: 1785447668,
  msgContent: { conversation: 'churrus e a melhor chama ela' },
};

/** Conversa 1:1 comum, sem citacao nenhuma. */
const DM_NORMAL = {
  event: 'webhookReceived',
  instanceId: 'LITE-8NDQT1-UWX43P',
  isGroup: false,
  fromMe: false,
  chat: { id: '16956547674162@lid' },
  sender: { id: '5516991017726', senderLid: '16956547674162@lid' },
  moment: 1785400000,
  msgContent: {
    extendedTextMessage: {
      text: 'caso ainda fique bom pra vc me avise que ue ja faturo amanha',
      contextInfo: { expiration: 604800 },
    },
  },
};

const RESPOSTA_DA_LOJA = { ...DM_NORMAL, fromMe: true };

/**
 * Contato NOVO, fora da agenda da loja: a W-API nao entrega telefone nenhum,
 * so o @lid, e `pushName` vem vazio. Era o "oi" que ficava sem resposta.
 */
const CONTATO_NOVO_SO_LID = {
  event: 'webhookReceived',
  instanceId: 'LITE-8NDQT1-UWX43P',
  connectedPhone: '5516993638485',
  isGroup: false,
  fromMe: false,
  chat: { id: '14113715548383@lid' },
  sender: { id: '14113715548383', senderLid: '14113715548383@lid', pushName: '' },
  moment: 1785362270,
  msgContent: { conversation: 'Oi' },
};

/** Mesmo caso, vindo de quem clicou no link wa.me da loja. */
const CONTATO_NOVO_DO_LINK = {
  event: 'webhookReceived',
  instanceId: 'LITE-8NDQT1-UWX43P',
  isGroup: false,
  fromMe: false,
  chat: { id: '172842436059186@lid' },
  sender: { id: '172842436059186', senderLid: '172842436059186@lid', pushName: '' },
  moment: 1785434899,
  msgContent: {
    extendedTextMessage: {
      text: 'Boa tarde',
      contextInfo: { entryPointConversionSource: 'click_to_chat_link', entryPointConversionDelaySeconds: 5 },
    },
  },
};

describe('extractIncomingMessage', () => {
  describe('responde a quem comenta o status da loja', () => {
    it('aceita a DM que cita um status (contextInfo.remoteJID = status@broadcast)', () => {
      const incoming = extractIncomingMessage(RESPOSTA_A_STORY, 'webhookReceived', 'received');

      expect(incoming).not.toBeNull();
      expect(incoming?.phone).toBe('5516992070241');
      expect(incoming?.text).toBe('Quero meu copo da gostinho do céu 🤨🤭');
    });

    it('aceita mesmo com entryPointConversionSource = "status"', () => {
      const incoming = extractIncomingMessage(RESPOSTA_A_STORY_COM_ENTRYPOINT, 'webhookReceived', 'received');

      expect(incoming?.phone).toBe('5516991864790');
      expect(incoming?.text).toBe('Oiii, ainda tem??');
    });

    it('nao deixa a citacao de um grupo bloquear uma DM', () => {
      const encaminhadaDeGrupo = {
        ...DM_NORMAL,
        msgContent: {
          extendedTextMessage: {
            text: 'olha o que mandaram no grupo',
            contextInfo: { remoteJID: '120363208662219926@g.us', quotedMessage: { conversation: 'oi' } },
          },
        },
      };

      expect(extractIncomingMessage(encaminhadaDeGrupo, 'webhookReceived', 'received')).not.toBeNull();
    });
  });

  describe('continua mudo onde tem que ficar mudo', () => {
    it('ignora story de contato (chat.id = "status")', () => {
      expect(extractIncomingMessage(STORY_DE_CONTATO, 'webhookReceived', 'received')).toBeNull();
    });

    it('ignora story de texto', () => {
      expect(extractIncomingMessage(STORY_DE_TEXTO, 'webhookReceived', 'received')).toBeNull();
    });

    it('ignora grupo', () => {
      expect(extractIncomingMessage(MENSAGEM_DE_GRUPO, 'webhookReceived', 'received')).toBeNull();
    });

    it('ignora status@broadcast quando ele e o DESTINO, nao a citacao', () => {
      const paraOBroadcast = { ...DM_NORMAL, chat: { id: 'status@broadcast' } };

      expect(extractIncomingMessage(paraOBroadcast, 'webhookReceived', 'received')).toBeNull();
    });

    it('ignora mensagem enviada pela propria loja', () => {
      expect(extractIncomingMessage(RESPOSTA_DA_LOJA, 'webhookReceived', 'received')).toBeNull();
    });

    it('ignora evento que nao e de mensagem recebida', () => {
      expect(extractIncomingMessage(DM_NORMAL, 'webhookDelivery', 'delivery')).toBeNull();
      expect(extractIncomingMessage(DM_NORMAL, 'webhookStatus', 'message-status')).toBeNull();
    });

    it('ignora quem nao tem nem telefone nem LID', () => {
      const semNada = { ...DM_NORMAL, chat: { id: '' }, sender: { id: '172842436059186' } };

      expect(extractIncomingMessage(semNada, 'webhookReceived', 'received')).toBeNull();
    });
  });

  describe('contato novo, fora da agenda (so @lid)', () => {
    it('responde pelo @lid quando a W-API nao entrega telefone', () => {
      const incoming = extractIncomingMessage(CONTATO_NOVO_SO_LID, 'webhookReceived', 'received');

      expect(incoming).not.toBeNull();
      expect(incoming?.text).toBe('Oi');
      expect(incoming?.address).toBe('14113715548383@lid');
      // Sem telefone de verdade: LID nao converte em numero (privacidade do
      // WhatsApp). Fingir que 55+LID e um telefone mandaria a mensagem pra um
      // estranho qualquer.
      expect(incoming?.phone).toBe('');
    });

    it('responde quem chegou pelo link wa.me da loja', () => {
      const incoming = extractIncomingMessage(CONTATO_NOVO_DO_LINK, 'webhookReceived', 'received');

      expect(incoming?.address).toBe('172842436059186@lid');
      expect(incoming?.text).toBe('Boa tarde');
    });

    it('nunca troca um telefone conhecido pelo LID', () => {
      const incoming = extractIncomingMessage(DM_NORMAL, 'webhookReceived', 'received');

      // chat.id de DM_NORMAL e "16956547674162@lid", mas sender.id tem o numero
      expect(incoming?.address).toBe('5516991017726');
      expect(incoming?.phone).toBe('5516991017726');
    });

    it('nao usa o LID de um story como endereco', () => {
      expect(extractIncomingMessage(STORY_DE_CONTATO, 'webhookReceived', 'received')).toBeNull();
      expect(extractIncomingMessage(STORY_DE_TEXTO, 'webhookReceived', 'received')).toBeNull();
    });

    it('nao usa o LID de participante de grupo como endereco', () => {
      expect(extractIncomingMessage(MENSAGEM_DE_GRUPO, 'webhookReceived', 'received')).toBeNull();
    });
  });

  describe('DM comum', () => {
    it('aceita e devolve telefone e texto', () => {
      const incoming = extractIncomingMessage(DM_NORMAL, 'webhookReceived', 'received');

      expect(incoming?.phone).toBe('5516991017726');
      expect(incoming?.text).toContain('me avise');
    });

    it('lê o horario de messageTimestamp/timestamp', () => {
      const comTimestamp = { ...DM_NORMAL, messageTimestamp: '1785400000' };

      expect(extractIncomingMessage(comTimestamp, 'webhookReceived', 'received')?.timestamp).toBe(1785400000);
    });

    // O formato atual da W-API manda o horario em `moment`, que NAO esta na
    // lista lida acima — entao timestamp sai 0 e a trava de "mensagem velha"
    // (5 min, em maybeSendAutoReply) nunca dispara. Fica registrado: ligar essa
    // trava e mudanca de comportamento, nao conserto de teste.
    it('nao le `moment` — a trava de mensagem antiga fica inerte no formato atual', () => {
      expect(extractIncomingMessage(DM_NORMAL, 'webhookReceived', 'received')?.timestamp).toBe(0);
    });
  });
});
