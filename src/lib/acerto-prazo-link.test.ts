import { describe, expect, it } from 'vitest';
import {
  clienteDoTituloAcerto,
  isAcertoPrazo,
  resolveAcertoClienteLink,
} from './acerto-prazo-link';

describe('vínculo do Acerto de Prazo', () => {
  it('abre somente pelo clienteId gravado', () => {
    expect(resolveAcertoClienteLink({
      clienteId: 'cliente-123',
      titulo: 'Acerto de Prazo - Nome que pode ter mudado',
    })).toEqual({ linked: true, clienteId: 'cliente-123' });
  });

  it('marca lançamento antigo sem id como sem vínculo, mesmo com nome', () => {
    expect(resolveAcertoClienteLink({ titulo: 'Acerto de Prazo - Maria Silva' })).toEqual({
      linked: false,
      nomeLegado: 'Maria Silva',
    });
  });

  it('reconhece apenas venda com o título de acerto', () => {
    expect(clienteDoTituloAcerto('Acerto de Prazo - Ana')).toBe('Ana');
    expect(isAcertoPrazo({ tipo: 'venda', titulo: 'Acerto de Prazo - Ana' })).toBe(true);
    expect(isAcertoPrazo({ tipo: 'suprimento', titulo: 'Acerto de Prazo - Ana' })).toBe(false);
  });
});
