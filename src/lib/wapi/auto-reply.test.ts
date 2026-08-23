import { describe, expect, it } from 'vitest';

import { JANELA_DA_SAUDACAO_MS, buildAutoReply } from './auto-reply';

/**
 * O que estes testes protegem: mensagem que chega em cliente de verdade.
 *
 * Erro aqui não aparece em tela nenhuma. Ou a loja manda a mesma coisa duas
 * vezes, ou — pior — alguém pede o cardápio e fica falando sozinho.
 */

const AGORA = Date.parse('2026-08-23T15:00:00.000Z');
const HORA = 60 * 60 * 1000;

// Loja aberta 24h para o horário não interferir no que está sendo medido.
const lojaAberta = {
  general: { name: 'Gostinho de Céu', whatsapp: '(16) 99363-8485' },
  storeSlug: 'gostinho-de-ceu-5n3mkc',
  workingHours: ['domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado'].map((day) => ({ day, isClosed: false, open: '00:00', close: '23:59' })),
};

const lojaFechada = {
  ...lojaAberta,
  workingHours: ['domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado'].map((day) => ({ day, isClosed: true })),
};

function responder(over: Partial<Parameters<typeof buildAutoReply>[0]> = {}) {
  return buildAutoReply({
    storeProfile: lojaAberta,
    empresaId: 'loja1',
    incoming: { phone: '16994272353', text: 'Bom dia!' },
    requestOrigin: 'https://app.exemplo.com',
    agora: AGORA,
    ...over,
  });
}

describe('pedido de cardápio (mensagem com o código da visita)', () => {
  const pedido = { phone: '16994272353', text: 'Olá! Quero fazer um pedido pelo delivery.\n\nCód. #PRD8T' };

  it('responde mesmo para quem já falou com a loja hoje', () => {
    // Era a armadilha: a saudação só sai no 1º contato ou após 12h de silêncio.
    // Sem gatilho próprio, cliente da manhã pedia o link à tarde e não recebia.
    const semGatilho = responder({
      contactData: { firstContactSentAt: AGORA - HORA, lastInboundAt: AGORA - HORA },
    });
    expect(semGatilho).toBeNull();

    const comPedido = responder({
      incoming: pedido,
      contactData: { firstContactSentAt: AGORA - HORA, lastInboundAt: AGORA - HORA },
    });
    expect(comPedido?.type).toBe('link_request_auto_reply');
    expect(comPedido?.message).toContain('gostinho-de-ceu');
  });

  it('não responde duas vezes na mesma rajada', () => {
    const repetido = responder({ incoming: pedido, contactData: { lastLinkReplyAt: AGORA - 30_000 } });
    // Cai na regra normal: sem contato anterior, sai a saudação — mas NÃO um
    // segundo "aqui está o cardápio" por causa do retry.
    expect(repetido?.type).not.toBe('link_request_auto_reply');
  });

  it('volta a responder quando o pedido é de verdade, minutos depois', () => {
    const depois = responder({
      incoming: pedido,
      contactData: { lastLinkReplyAt: AGORA - 10 * 60 * 1000, firstContactSentAt: AGORA - HORA, lastInboundAt: AGORA - HORA },
    });
    expect(depois?.type).toBe('link_request_auto_reply');
  });

  it('com a loja fechada, manda o aviso E o link', () => {
    const fechada = responder({ storeProfile: lojaFechada, incoming: pedido });
    expect(fechada?.type).toBe('link_request_auto_reply');
    expect(fechada?.message).toContain('gostinho-de-ceu'); // o link foi junto
    expect(fechada?.message.toLowerCase()).toMatch(/fechad|horário|volta/);
  });

  it('o link que sai já nasce marcado como origem whatsapp', () => {
    const reply = responder({ incoming: pedido });
    expect(reply?.message).toContain('via=whatsapp');
  });
});

describe('as regras que já existiam continuam valendo', () => {
  it('primeiro contato ganha a saudação com link', () => {
    const reply = responder();
    expect(reply?.type).toBe('first_contact_auto_reply');
  });

  it('quem está no meio da conversa não é interrompido por robô', () => {
    const reply = responder({
      contactData: { firstContactSentAt: AGORA - HORA, lastInboundAt: AGORA - 5 * 60 * 1000 },
    });
    expect(reply).toBeNull();
  });

  it('depois de 12h de silêncio a conversa é nova de novo', () => {
    const reply = responder({
      contactData: {
        firstContactSentAt: AGORA - 3 * JANELA_DA_SAUDACAO_MS,
        lastInboundAt: AGORA - JANELA_DA_SAUDACAO_MS - HORA,
      },
    });
    expect(reply?.type).toBe('first_contact_auto_reply');
  });

  it('loja fechada avisa uma vez e depois silencia por duas horas', () => {
    const primeira = responder({ storeProfile: lojaFechada });
    expect(primeira?.type).toBe('store_closed_auto_reply');

    const logoDepois = responder({
      storeProfile: lojaFechada,
      contactData: { lastClosedReplyAt: AGORA - 10 * 60 * 1000 },
    });
    expect(logoDepois).toBeNull();

    const horasDepois = responder({
      storeProfile: lojaFechada,
      contactData: { lastClosedReplyAt: AGORA - 3 * HORA },
    });
    expect(horasDepois?.type).toBe('store_closed_auto_reply');
  });
});
