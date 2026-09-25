import { describe, expect, it } from 'vitest';
import { ehEventoZapi, lerEventoZapi } from './incoming';
import { ehInstanciaZapi } from './zapi.service';

// Base: o exemplo "mensagem de texto" de developer.z-api.io/webhooks/on-message-received-examples
const recebida = (over: Record<string, unknown> = {}) => ({
  isStatusReply: false,
  senderLid: '81896604192873@lid',
  connectedPhone: '554499999999',
  waitingMessage: false,
  isEdit: false,
  isGroup: false,
  isNewsletter: false,
  instanceId: 'A20DA9C0183A2D35A260F53F5D2B9244',
  messageId: 'A20DA9C0183A2D35A260F53F5D2B9244',
  phone: '5544999999999',
  fromMe: false,
  momment: 1632228638000,
  status: 'RECEIVED',
  chatName: 'name',
  senderName: 'Maria',
  participantPhone: null,
  participantLid: null,
  broadcast: false,
  type: 'ReceivedCallback',
  text: { message: 'oi, tem bolo hoje?' },
  ...over,
});

describe('qual provedor', () => {
  it('ID de 32 hexadecimais é Z-API; "LITE-..." é W-API', () => {
    expect(ehInstanciaZapi('3F9B1E3257CB713CA2E05E00F85CEB2F')).toBe(true);
    expect(ehInstanciaZapi('LITE-8NDQT1-UWX43P')).toBe(false);
    expect(ehInstanciaZapi('')).toBe(false);
  });

  it('evento da Z-API tem `type` terminado em Callback; o da W-API tem `event`', () => {
    expect(ehEventoZapi(recebida())).toBe(true);
    expect(ehEventoZapi({ event: 'webhookReceived', instanceId: 'LITE-8NDQT1-UWX43P' })).toBe(false);
  });
});

describe('mensagem de cliente', () => {
  it('texto de contato vira mensagem para o robô, com telefone, nome e LID', () => {
    expect(lerEventoZapi(recebida()).incoming).toEqual({
      phone: '5544999999999',
      address: '5544999999999',
      text: 'oi, tem bolo hoje?',
      timestamp: 1632228638000,
      pushName: 'Maria',
      senderLid: '81896604192873@lid',
    });
  });

  it('contato fora da agenda chega só com @lid e é respondido por ele', () => {
    const incoming = lerEventoZapi(recebida({ phone: '65998849469@lid', chatLid: '65998849469@lid', senderLid: undefined })).incoming;
    expect(incoming).toMatchObject({ phone: '', address: '65998849469@lid', senderLid: '65998849469@lid' });
  });

  it('imagem sem legenda ainda é conversa (a saudação não depende do texto)', () => {
    const incoming = lerEventoZapi(recebida({ text: undefined, image: { caption: '', imageUrl: 'https://' } })).incoming;
    expect(incoming).toMatchObject({ address: '5544999999999', text: '' });
  });

  it('comentário no story da loja é conversa de verdade', () => {
    const incoming = lerEventoZapi(recebida({ isStatusReply: true, chatLid: '81896604192873@lid', text: { message: 'que lindo!' } })).incoming;
    expect(incoming).toMatchObject({ address: '5544999999999', text: 'que lindo!' });
  });
});

describe('o que nunca responde', () => {
  it.each([
    ['grupo', { isGroup: true, phone: '120363019502650977-group' }],
    ['canal', { isNewsletter: true }],
    ['lista de transmissão', { broadcast: true }],
    ['story de contato', { phone: 'status@broadcast' }],
    ['aviso de ligação', { notification: 'CALL_VOICE' }],
    ['mensagem editada', { isEdit: true }],
  ])('%s', (_nome, over) => {
    expect(lerEventoZapi(recebida(over)).incoming).toBeNull();
  });

  it('reação a mensagem comum fica sem resposta', () => {
    const evento = lerEventoZapi(recebida({
      text: undefined,
      reaction: { value: '👍', referencedMessage: { messageId: 'X', fromMe: true, phone: '5544999999999', participant: null } },
    }));
    expect(evento.incoming).toBeNull();
  });
});

describe('reação no story da loja', () => {
  it('coraçãozinho no story da loja vira agradecimento', () => {
    const incoming = lerEventoZapi(recebida({
      text: undefined,
      reaction: { value: '❤️', referencedMessage: { messageId: 'X', fromMe: true, phone: 'status@broadcast', participant: null } },
    })).incoming;
    expect(incoming).toMatchObject({ address: '5544999999999', text: '❤️', isStoryReaction: true });
  });

  it('tirar a reação (sem emoji) não é levantar a mão', () => {
    const incoming = lerEventoZapi(recebida({
      text: undefined,
      reaction: { value: '', referencedMessage: { messageId: 'X', fromMe: true, phone: 'status@broadcast' } },
    })).incoming;
    expect(incoming).toBeNull();
  });
});

describe('mensagem da própria loja', () => {
  it('o que a dona digitou no celular cala o robô naquele contato', () => {
    const evento = lerEventoZapi(recebida({ fromMe: true, fromApi: false }));
    expect(evento.incoming).toBeNull();
    expect(evento.saidaDaLoja).toEqual({ chatId: '5544999999999' });
  });

  it('o que o próprio robô mandou (fromApi) não conta como atendimento', () => {
    const evento = lerEventoZapi(recebida({ fromMe: true, fromApi: true }));
    expect(evento.saidaDaLoja).toBeNull();
    expect(evento.incoming).toBeNull();
  });
});

describe('conexão', () => {
  it('ao conectar: conectado, com o telefone da loja', () => {
    expect(lerEventoZapi({ type: 'ConnectedCallback', connected: true, momment: 1, instanceId: 'X', phone: '5516993638485' }))
      .toMatchObject({ connected: true, disconnected: false, livePhone: '5516993638485' });
  });

  it('ao desconectar: desconectado', () => {
    expect(lerEventoZapi({ type: 'DisconnectedCallback', disconnected: true, error: 'Device has been disconnected', instanceId: 'X' }))
      .toMatchObject({ connected: false, disconnected: true, livePhone: '' });
  });

  it('toda mensagem traz o telefone da loja como prova de vida', () => {
    expect(lerEventoZapi(recebida()).livePhone).toBe('554499999999');
  });
});
