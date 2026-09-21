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

describe('a loja está atendendo: o robô não fala por cima', () => {
  // 18/09/2026: a dona respondeu uma cliente por áudio às 16:34 e mandou três
  // documentos às 16:35; às 16:36 o robô soltou "seja bem-vindo, veja o
  // cardápio" na mesma conversa. Ela não falava desde a véspera, então a janela
  // de 12h da saudação estava aberta e ninguém segurava o robô.
  it('cala quando a loja falou com a pessoa há pouco', () => {
    const semCarimbo = responder({ contactData: { lastInboundAt: AGORA - 20 * HORA } });
    expect(semCarimbo?.type).toBe('first_contact_auto_reply');

    const comCarimbo = responder({
      contactData: { lastInboundAt: AGORA - 20 * HORA, lastOutboundAt: AGORA - 2 * 60 * 1000 },
    });
    expect(comCarimbo).toBeNull();
  });

  it('volta a responder quando o atendimento esfriou', () => {
    const reply = responder({
      contactData: { lastInboundAt: AGORA - 20 * HORA, lastOutboundAt: AGORA - 3 * HORA },
    });
    expect(reply?.type).toBe('first_contact_auto_reply');
  });

  it('cala também com a loja fechada', () => {
    const reply = responder({
      storeProfile: lojaFechada,
      contactData: { lastOutboundAt: AGORA - 5 * 60 * 1000 },
    });
    expect(reply).toBeNull();
  });

  it('mas entrega o cardápio para quem apertou o botão', () => {
    // Pedido explícito atravessa: a pessoa está esperando o link de volta.
    const reply = responder({
      incoming: { phone: '16994272353', text: 'Quero pedir.\n\nCód. #PRD8T' },
      contactData: { lastOutboundAt: AGORA - 60 * 1000 },
    });
    expect(reply?.type).toBe('link_request_auto_reply');
  });
});

describe('reação no story (o coraçãozinho)', () => {
  const reacao = { phone: '16993407645', text: '💚', isStoryReaction: true };

  it('agradece curto, sem despejar o horário de funcionamento', () => {
    const reply = responder({ incoming: reacao, storeProfile: lojaFechada });
    expect(reply?.type).toBe('story_reaction_auto_reply');
    expect(reply?.message).not.toContain('Nosso horário de atendimento');
    expect(reply?.message).toContain('gostinho-de-ceu');
  });

  it('não gasta o primeiro contato de quem ainda vai escrever', () => {
    const reply = responder({ incoming: reacao });
    expect(reply?.type).not.toBe('first_contact_auto_reply');
  });

  it('não repete para quem reage todo dia', () => {
    // Uma cliente levou 16 respostas automáticas em 6 semanas, 7 delas só por
    // mandar um coração verde.
    const ontem = responder({
      incoming: reacao,
      contactData: { lastStoryReactionReplyAt: AGORA - 24 * HORA },
    });
    expect(ontem).toBeNull();

    const semanaPassada = responder({
      incoming: reacao,
      contactData: { lastStoryReactionReplyAt: AGORA - 8 * 24 * HORA },
    });
    expect(semanaPassada?.type).toBe('story_reaction_auto_reply');
  });

  it('sai com a logo, igual às outras respostas da loja', () => {
    // Ia como texto pelado com o link cru: quem recebia via uma mensagem com
    // cara de outra loja, no meio de uma conversa em que todo o resto chega
    // como foto + legenda. Foi o que a dona viu e chamou de fora do padrão.
    const comLogo = { ...lojaAberta, general: { ...lojaAberta.general, logoUrl: 'https://exemplo.com/logo.png' } };

    const story = responder({ incoming: reacao, storeProfile: comLogo });
    const saudacao = responder({ storeProfile: comLogo });

    expect(story?.imageUrl).toBe('https://exemplo.com/logo.png');
    expect(story?.imageUrl).toBe(saudacao?.imageUrl);
  });
});
