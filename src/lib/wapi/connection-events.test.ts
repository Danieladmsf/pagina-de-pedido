import { describe, expect, it } from 'vitest';
import {
  getLiveConnectedPhone,
  isConnectedEvent,
  isConnectionEvent,
  isDisconnectedEvent,
} from './connection-events';

/**
 * Payloads REAIS, colhidos de `whatsapp_webhook_events` em producao
 * (2026-07-27). Sao a razao de este arquivo existir: a versao anterior
 * classificava TODOS eles como "nao e conexao", entao nenhum aviso de conectou/
 * desconectou jamais chegava ao banco.
 */
const DESCONECTOU = {
  event: 'webhookDisconnected',
  instanceId: 'LITE-8NDQT1-UWX43P',
  disconnected: true,
  moment: 1785164859,
};

const ACK_DE_MENSAGEM = {
  event: 'webhookStatus',
  instanceId: 'LITE-8NDQT1-UWX43P',
  connectedPhone: '5516993638485',
  connectedLid: '62169752330325@lid',
  status: 'DELIVERY',
  messageId: '2ADA6D9FB6528620CA75',
  fromMe: false,
  moment: 1785164792,
  chat: { id: '98986195173540@lid' },
  isGroup: false,
};

const MENSAGEM_RECEBIDA = {
  event: 'webhookReceived',
  instanceId: 'LITE-8NDQT1-UWX43P',
  connectedPhone: '5516993638485',
  connectedLid: '62169752330325@lid',
  isGroup: false,
  messageId: 'AC0921E80B09C97D476B5449EEC9B7BF',
  fromMe: false,
  chat: { id: '98986195173540@lid' },
  sender: { id: '5516992844226' },
};

const ENTREGA = {
  event: 'webhookDelivery',
  instanceId: 'LITE-8NDQT1-UWX43P',
  connectedPhone: '5516993638485',
  isGroup: false,
  messageId: '2ADA6D9FB6528620CA75',
  fromMe: true,
};

describe('classificacao dos webhooks da W-API', () => {
  it('reconhece o aviso de desconexao (era ignorado: camelCase virava um token so)', () => {
    expect(isDisconnectedEvent(DESCONECTOU, DESCONECTOU.event, 'disconnected')).toBe(true);
    expect(isConnectedEvent(DESCONECTOU, DESCONECTOU.event, 'disconnected')).toBe(false);
  });

  it('reconhece a desconexao mesmo sem o hook na URL', () => {
    expect(isDisconnectedEvent(DESCONECTOU, DESCONECTOU.event)).toBe(true);
  });

  it('reconhece o aviso de conexao', () => {
    const conectou = { event: 'webhookConnected', instanceId: 'X', connected: true, connectedPhone: '5516993638485' };
    expect(isConnectedEvent(conectou, conectou.event, 'connected')).toBe(true);
    expect(isDisconnectedEvent(conectou, conectou.event, 'connected')).toBe(false);
    expect(isConnectedEvent(conectou, conectou.event)).toBe(true);
  });

  it('nao deixa o ack de entrega decidir a conexao da loja', () => {
    // `webhookStatus` casava com includes('status') e virava evento de conexao,
    // com o status do ack ("DELIVERY"/"READ") mandando na loja inteira.
    expect(isConnectionEvent(ACK_DE_MENSAGEM.event, 'message-status')).toBe(false);
    // ...e continua fora mesmo se o hook nao vier na URL.
    expect(isConnectionEvent(ACK_DE_MENSAGEM.event)).toBe(false);
    expect(isConnectedEvent(ACK_DE_MENSAGEM, ACK_DE_MENSAGEM.event, 'message-status')).toBe(false);
    expect(isDisconnectedEvent(ACK_DE_MENSAGEM, ACK_DE_MENSAGEM.event, 'message-status')).toBe(false);
  });

  it('mensagem recebida e entrega nunca sao evento de conexao', () => {
    for (const [payload, hook] of [[MENSAGEM_RECEBIDA, 'received'], [ENTREGA, 'delivery']] as const) {
      expect(isConnectionEvent(payload.event, hook)).toBe(false);
      expect(isDisconnectedEvent(payload, payload.event, hook)).toBe(false);
      expect(isConnectedEvent(payload, payload.event, hook)).toBe(false);
    }
  });

  it('um ack de erro nao derruba a loja', () => {
    const erro = { ...ACK_DE_MENSAGEM, status: 'ERROR' };
    expect(isDisconnectedEvent(erro, erro.event, 'message-status')).toBe(false);
  });

  it('ainda entende os formatos genericos de status', () => {
    expect(isDisconnectedEvent({ status: 'disconnected' }, 'status_change')).toBe(true);
    expect(isDisconnectedEvent({ connected: false }, 'connection_update')).toBe(true);
    expect(isConnectedEvent({ status: 'open' }, 'connection_update')).toBe(true);
    expect(isConnectedEvent({ connected: true }, 'status_change')).toBe(true);
  });
});

describe('prova de vida pelo connectedPhone', () => {
  it('extrai o numero logado de qualquer webhook de mensagem', () => {
    expect(getLiveConnectedPhone(MENSAGEM_RECEBIDA)).toBe('5516993638485');
    expect(getLiveConnectedPhone(ACK_DE_MENSAGEM)).toBe('5516993638485');
    expect(getLiveConnectedPhone(ENTREGA)).toBe('5516993638485');
  });

  it('ignora o aviso de desconexao e valores implausiveis', () => {
    expect(getLiveConnectedPhone(DESCONECTOU)).toBe('');
    expect(getLiveConnectedPhone({ connectedPhone: '123' })).toBe('');
    // LID numerico longo nao pode virar telefone
    expect(getLiveConnectedPhone({ connectedPhone: '62169752330325' })).toBe('');
  });
});
