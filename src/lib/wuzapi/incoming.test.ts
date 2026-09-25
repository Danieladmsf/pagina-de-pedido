import { describe, expect, it } from 'vitest';
import { ehEventoWuzapi, lerEventoWuzapi } from './incoming';
import { ehInstanciaWuzapi } from './wuzapi.service';

// Formato da WuzAPI: { type, event } com o evento cru do whatsmeow (Info + Message).
const mensagem = (info: Record<string, unknown> = {}, message: Record<string, unknown> = { conversation: 'oi, tem bolo hoje?' }) => ({
  type: 'Message',
  event: {
    Info: {
      Chat: '5516999998877@s.whatsapp.net',
      Sender: '5516999998877@s.whatsapp.net',
      SenderAlt: '81896604192873@lid',
      IsFromMe: false,
      IsGroup: false,
      AddressingMode: 'pn',
      ID: '3EB0ABC',
      Type: 'text',
      PushName: 'Maria',
      Timestamp: '2026-09-25T15:00:00-03:00',
      Edit: '',
      ...info,
    },
    Message: message,
  },
});

describe('qual provedor', () => {
  it('ID "WUZ-..." é o servidor próprio', () => {
    expect(ehInstanciaWuzapi('WUZ-GOSTINHO')).toBe(true);
    expect(ehInstanciaWuzapi('LITE-8NDQT1-UWX43P')).toBe(false);
    expect(ehInstanciaWuzapi('3F9B1E3257CB713CA2E05E00F85CEB2F')).toBe(false);
  });

  it('evento da WuzAPI tem `event` em objeto; o da W-API tem `event` em texto', () => {
    expect(ehEventoWuzapi(mensagem())).toBe(true);
    expect(ehEventoWuzapi({ event: 'webhookReceived', type: 'Message' })).toBe(false);
    expect(ehEventoWuzapi({ type: 'ReceivedCallback', phone: '55' })).toBe(false);
  });
});

describe('mensagem de cliente', () => {
  it('texto vira mensagem com telefone, nome, LID e horário', () => {
    expect(lerEventoWuzapi(mensagem()).incoming).toEqual({
      phone: '5516999998877',
      address: '5516999998877',
      text: 'oi, tem bolo hoje?',
      timestamp: Date.parse('2026-09-25T15:00:00-03:00'),
      pushName: 'Maria',
      senderLid: '81896604192873@lid',
    });
  });

  it('endereçamento por LID com o telefone no SenderAlt', () => {
    const incoming = lerEventoWuzapi(mensagem({
      Chat: '81896604192873@lid', Sender: '81896604192873@lid', SenderAlt: '5516999998877@s.whatsapp.net', AddressingMode: 'lid',
    })).incoming;
    expect(incoming).toMatchObject({ phone: '5516999998877', address: '5516999998877', senderLid: '81896604192873@lid' });
  });

  it('contato só com LID é respondido pelo LID', () => {
    const incoming = lerEventoWuzapi(mensagem({ Chat: '81896604192873@lid', Sender: '81896604192873@lid', SenderAlt: '' })).incoming;
    expect(incoming).toMatchObject({ phone: '', address: '81896604192873@lid' });
  });

  it('JID com aparelho ("...:12@") vira só o número', () => {
    const incoming = lerEventoWuzapi(mensagem({ Sender: '5516999998877:12@s.whatsapp.net' })).incoming;
    expect(incoming?.phone).toBe('5516999998877');
  });

  it('texto longo, legenda de imagem e áudio sem texto são conversa', () => {
    expect(lerEventoWuzapi(mensagem({}, { extendedTextMessage: { text: 'link do cardápio?' } })).incoming?.text).toBe('link do cardápio?');
    expect(lerEventoWuzapi(mensagem({}, { imageMessage: { caption: 'esse aqui' } })).incoming?.text).toBe('esse aqui');
    expect(lerEventoWuzapi(mensagem({}, { audioMessage: { seconds: 4 } })).incoming).toMatchObject({ text: '' });
  });
});

describe('o que nunca responde', () => {
  it.each([
    ['grupo', { Chat: '120363019502650977@g.us', IsGroup: true }],
    ['story de contato', { Chat: 'status@broadcast' }],
    ['canal', { Chat: '120363@newsletter' }],
    ['mensagem editada', { Edit: '1' }],
  ])('%s', (_nome, info) => {
    expect(lerEventoWuzapi(mensagem(info)).incoming).toBeNull();
  });

  it('protocolo (apagar, editar) e mensagem sem conteúdo', () => {
    expect(lerEventoWuzapi(mensagem({}, { protocolMessage: { type: 0 } })).incoming).toBeNull();
    expect(lerEventoWuzapi(mensagem({}, { senderKeyDistributionMessage: {} })).incoming).toBeNull();
  });

  it('reação a mensagem comum fica sem resposta', () => {
    const evento = lerEventoWuzapi(mensagem({}, {
      reactionMessage: { key: { remoteJID: '5516999998877@s.whatsapp.net', fromMe: true, ID: 'X' }, text: '👍' },
    }));
    expect(evento.incoming).toBeNull();
  });
});

describe('reação no story da loja', () => {
  it('coraçãozinho no story da loja vira agradecimento', () => {
    const incoming = lerEventoWuzapi(mensagem({ Chat: 'status@broadcast', Sender: '81896604192873@lid', SenderAlt: '' }, {
      reactionMessage: { key: { remoteJID: 'status@broadcast', fromMe: true, ID: 'X', participant: '5516993638485@s.whatsapp.net' }, text: '❤️' },
    })).incoming;
    expect(incoming).toMatchObject({ address: '81896604192873@lid', text: '❤️', isStoryReaction: true });
  });

  it('reação ao story de outra pessoa não é com a loja', () => {
    const incoming = lerEventoWuzapi(mensagem({ Chat: 'status@broadcast' }, {
      reactionMessage: { key: { remoteJID: 'status@broadcast', fromMe: false, ID: 'X' }, text: '❤️' },
    })).incoming;
    expect(incoming).toBeNull();
  });
});

describe('mensagem da própria loja', () => {
  it('o que a dona digitou no celular cala o robô naquele contato', () => {
    const evento = lerEventoWuzapi(mensagem({ IsFromMe: true }));
    expect(evento.incoming).toBeNull();
    expect(evento.saidaDaLoja).toEqual({ chatId: '5516999998877' });
  });

  it('conversa com contato só-LID guarda o LID', () => {
    expect(lerEventoWuzapi(mensagem({ IsFromMe: true, Chat: '81896604192873@lid' })).saidaDaLoja)
      .toEqual({ chatId: '81896604192873@lid' });
  });
});

describe('conexão', () => {
  it('pareou: conectado, com o telefone da loja', () => {
    expect(lerEventoWuzapi({ type: 'PairSuccess', event: { ID: '5516993638485:21@s.whatsapp.net', Platform: 'android' } }))
      .toMatchObject({ connected: true, disconnected: false, livePhone: '5516993638485' });
  });

  it('conectou (socket de volta): conectado', () => {
    expect(lerEventoWuzapi({ type: 'Connected', event: {} })).toMatchObject({ connected: true, disconnected: false });
  });

  it('deslogado no celular: desconectado; queda de socket não derruba a loja', () => {
    expect(lerEventoWuzapi({ type: 'LoggedOut', event: { Reason: 401 } })).toMatchObject({ connected: false, disconnected: true });
    expect(lerEventoWuzapi({ type: 'Disconnected', event: {} })).toMatchObject({ connected: false, disconnected: false });
  });
});
