import { describe, expect, it } from 'vitest';

import { dedupeRecipientsByPhone, normalizeCampaignPhone } from '@/lib/campanhas/audience';

describe('telefone das campanhas', () => {
  it('completa o código do país sem confundir com o DDD 55', () => {
    expect(normalizeCampaignPhone('(11) 99999-0000')).toBe('5511999990000');
    expect(normalizeCampaignPhone('(21) 3333-4444')).toBe('552133334444');
    expect(normalizeCampaignPhone('+55 (21) 98888-7777')).toBe('5521988887777');
    expect(normalizeCampaignPhone('5511999990000')).toBe('5511999990000');
    // DDD 55 (Santa Maria/Uruguaiana): 11 dígitos, ainda SEM o país na frente.
    expect(normalizeCampaignPhone('(55) 99999-8888')).toBe('5555999998888');
    expect(normalizeCampaignPhone('(55) 3222-1111')).toBe('555532221111');
    expect(normalizeCampaignPhone('')).toBe('');
    expect(normalizeCampaignPhone(undefined)).toBe('');
  });
});

describe('dedupe de destinatários', () => {
  it('junta o mesmo número escrito de formas diferentes e mantém o primeiro', () => {
    const recipients = dedupeRecipientsByPhone([
      { id: 'a', nome: 'Maria Silva', celular: '(11) 99999-0000' },
      { id: 'b', nome: 'Maria', celular: '5511999990000' },
      { id: 'c', nome: 'João', celular: '11988887777' },
    ]);

    expect(recipients.map((r) => r.id)).toEqual(['a', 'c']);
    expect(recipients[0].nome).toBe('Maria Silva');
  });

  it('aproveita o nome do cadastro repetido quando o primeiro está sem nome', () => {
    const recipients = dedupeRecipientsByPhone([
      { id: 'a', nome: '  ', celular: '11999990000' },
      { id: 'b', nome: 'Maria Silva', celular: '(11) 99999-0000' },
    ]);

    expect(recipients).toHaveLength(1);
    expect(recipients[0]).toMatchObject({ id: 'a', nome: 'Maria Silva' });
  });

  it('não adivinha o nono dígito nem quebra com telefone vazio', () => {
    const recipients = dedupeRecipientsByPhone([
      { id: 'a', nome: 'Fixo', celular: '(11) 3333-4444' },
      { id: 'b', nome: 'Celular', celular: '(11) 93333-4444' },
      { id: 'c', nome: 'Sem telefone', celular: '' },
    ]);

    expect(recipients.map((r) => r.id)).toEqual(['a', 'b']);
  });

  it('não altera os objetos recebidos', () => {
    const original = [
      { id: 'a', nome: '', celular: '11999990000' },
      { id: 'b', nome: 'Maria', celular: '11999990000' },
    ];
    dedupeRecipientsByPhone(original);

    expect(original[0].nome).toBe('');
  });
});
