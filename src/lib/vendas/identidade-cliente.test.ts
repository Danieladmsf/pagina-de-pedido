import { describe, expect, it } from 'vitest';
import { resolverIdentidadeDaVenda } from './identidade-cliente';

const cliente = (over: any = {}) => ({
  id: 'c1',
  nome: 'Thais',
  celular: '16992156780',
  creditEnabled: true,
  creditLimit: 100,
  creditBalance: 0,
  ...over,
});

describe('resolverIdentidadeDaVenda', () => {
  it('nada digitado é venda anônima, e o Prazo nem aparece', () => {
    const id = resolverIdentidadeDaVenda({ nome: '', telefone: '', clientes: [cliente()] });
    expect(id.estado).toBe('anonimo');
    expect(id.prazoVisivel).toBe(false);
  });

  it('telefone pela metade é "incompleto" — não acusa nada enquanto digita', () => {
    const id = resolverIdentidadeDaVenda({ telefone: '(16) 9921', clientes: [cliente()] });
    expect(id.estado).toBe('incompleto');
    expect(id.prazoVisivel).toBe(false);
  });

  it('telefone válido sem cadastro: oferece cadastrar, sem Prazo', () => {
    const id = resolverIdentidadeDaVenda({ telefone: '16900000000', clientes: [cliente()] });
    expect(id.estado).toBe('nao_encontrado');
    expect(id.prazoVisivel).toBe(false);
  });

  it('só nome NUNCA casa cliente — homônimo não vira o mesmo cadastro', () => {
    const id = resolverIdentidadeDaVenda({ nome: 'Thais', clientes: [cliente()] });
    expect(id.estado).toBe('nao_encontrado');
    expect(id.cliente).toBeNull();
  });

  it('acha o cadastro mesmo com o telefone digitado em outro formato', () => {
    const id = resolverIdentidadeDaVenda({ telefone: '(16) 99215-6780', clientes: [cliente()] });
    expect(id.estado).toBe('vinculado');
    expect(id.prazoVisivel).toBe(true);
    expect(id.prazoBloqueado).toBe(false);
    expect(id.disponivel).toBe(100);
  });

  it('dois cadastros com o mesmo telefone é conflito: não escolhe nenhum', () => {
    const id = resolverIdentidadeDaVenda({
      telefone: '16992156780',
      clientes: [cliente(), cliente({ id: 'c2', nome: 'Thais 2' })],
    });
    expect(id.estado).toBe('conflito');
    expect(id.prazoVisivel).toBe(false);
    expect(id.cliente).toBeNull();
  });

  it('escolha explícita no autocomplete vale mais que a dedução pelo telefone', () => {
    const escolhido = cliente({ id: 'escolhido', celular: '16900001111' });
    const id = resolverIdentidadeDaVenda({
      telefone: '16992156780',
      clientes: [cliente()],
      clienteSelecionado: escolhido,
    });
    expect(id.cliente.id).toBe('escolhido');
  });

  describe('cliente casado, mas o Prazo não pode ser usado', () => {
    it('sem prazo ativo: aparece bloqueado, com o motivo', () => {
      const id = resolverIdentidadeDaVenda({
        telefone: '16992156780',
        clientes: [cliente({ creditEnabled: false })],
      });
      expect(id.estado).toBe('vinculado');
      expect(id.prazoVisivel).toBe(true);
      expect(id.prazoBloqueado).toBe(true);
      expect(id.motivoPrazo).toMatch(/desativado/i);
    });

    it('limite esgotado: aparece bloqueado, dizendo quanto deve', () => {
      const id = resolverIdentidadeDaVenda({
        telefone: '16992156780',
        clientes: [cliente({ creditLimit: 100, creditBalance: 100 })],
      });
      expect(id.prazoBloqueado).toBe(true);
      expect(id.motivoPrazo).toMatch(/Limite esgotado/i);
      expect(id.disponivel).toBe(0);
    });

    it('limite 0 é SEM limite, não limite zerado', () => {
      // Mesma leitura de validateCreditData: `limit > 0 && limitReached`.
      const id = resolverIdentidadeDaVenda({
        telefone: '16992156780',
        clientes: [cliente({ creditLimit: 0, creditBalance: 500 })],
      });
      expect(id.prazoBloqueado).toBe(false);
      expect(id.disponivel).toBeNull();
    });

    it('dívida parcial ainda deixa comprar, com o que sobrou do limite', () => {
      const id = resolverIdentidadeDaVenda({
        telefone: '16992156780',
        clientes: [cliente({ creditLimit: 100, creditBalance: 63 })],
      });
      expect(id.prazoBloqueado).toBe(false);
      expect(id.disponivel).toBe(37);
    });
  });
});
