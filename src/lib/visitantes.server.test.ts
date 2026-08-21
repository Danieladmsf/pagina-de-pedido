import { describe, expect, it, vi } from 'vitest';
import { identificarVisitantePeloCodigo } from './visitantes.server';

/**
 * O reconhecimento pelo código que volta na mensagem do WhatsApp.
 *
 * O risco aqui não é a tela quebrar: é carimbar o telefone de uma pessoa na
 * visita de outra. Por isso quase todo caso abaixo é sobre NÃO identificar.
 */

function bancoFalso(docs: any[]) {
  const gravado: any[] = [];
  const consultas: any[] = [];
  const query = {
    where(campo: string, _op: string, valor: any) {
      consultas.push([campo, valor]);
      return query;
    },
    limit() {
      return query;
    },
    async get() {
      return {
        size: docs.length,
        docs: docs.map((d) => ({
          data: () => d.dados,
          ref: { set: async (campos: any) => void gravado.push({ id: d.id, campos }) },
        })),
      };
    },
  };
  return {
    db: { collection: () => query },
    gravado,
    consultas,
  };
}

const BASE = { storeId: 'loja', codigo: '7K2M9', telefone: '5516999998888', nome: 'Maria' };

describe('identificarVisitantePeloCodigo', () => {
  it('amarra o telefone de quem escreveu à visita do código', async () => {
    const { db, gravado, consultas } = bancoFalso([{ id: 'loja__v1', dados: {} }]);
    expect(await identificarVisitantePeloCodigo(db, BASE)).toBe(true);

    expect(consultas).toEqual([['storeId', 'loja'], ['codigo', '7K2M9']]);
    expect(gravado[0].campos.telefone).toBe('16999998888');
    expect(gravado[0].campos.nome).toBe('Maria');
    expect(gravado[0].campos.viaLink).toBe(false);
    expect(gravado[0].campos.linhaDoTempo.at(-1).tipo).toBe('whatsapp');
  });

  it('código repetido em duas visitas não identifica ninguém', async () => {
    const { db, gravado } = bancoFalso([
      { id: 'loja__v1', dados: {} },
      { id: 'loja__v2', dados: {} },
    ]);
    expect(await identificarVisitantePeloCodigo(db, BASE)).toBe(false);
    expect(gravado).toHaveLength(0);
  });

  it('código que não existe não grava nada', async () => {
    const { db, gravado } = bancoFalso([]);
    expect(await identificarVisitantePeloCodigo(db, BASE)).toBe(false);
    expect(gravado).toHaveLength(0);
  });

  it('não sobrescreve o telefone que a própria pessoa digitou no carrinho', async () => {
    const { db, gravado } = bancoFalso([
      { id: 'loja__v1', dados: { telefone: '16988887777', viaLink: false } },
    ]);
    await identificarVisitantePeloCodigo(db, BASE);
    expect(gravado[0].campos.telefone).toBeUndefined();
    // ...mas o evento de "chamou no WhatsApp" continua valendo.
    expect(gravado[0].campos.linhaDoTempo.at(-1).tipo).toBe('whatsapp');
  });

  it('substitui o telefone provável que tinha vindo do link', async () => {
    const { db, gravado } = bancoFalso([
      { id: 'loja__v1', dados: { telefone: '16911112222', viaLink: true } },
    ]);
    await identificarVisitantePeloCodigo(db, BASE);
    expect(gravado[0].campos.telefone).toBe('16999998888');
    expect(gravado[0].campos.viaLink).toBe(false);
  });

  it('nome do WhatsApp não apaga o nome do cadastro', async () => {
    const { db, gravado } = bancoFalso([{ id: 'loja__v1', dados: { nome: 'Maria Aparecida Souza' } }]);
    await identificarVisitantePeloCodigo(db, BASE);
    expect(gravado[0].campos.nome).toBeUndefined();
  });

  it('contato fora da agenda (sem telefone) ainda registra a passagem pelo WhatsApp', async () => {
    const { db, gravado } = bancoFalso([{ id: 'loja__v1', dados: {} }]);
    await identificarVisitantePeloCodigo(db, { ...BASE, telefone: '' });
    expect(gravado[0].campos.telefone).toBeUndefined();
    expect(gravado[0].campos.linhaDoTempo.at(-1).tipo).toBe('whatsapp');
  });

  it('três mensagens seguidas não viram três eventos', async () => {
    const { db, gravado } = bancoFalso([
      { id: 'loja__v1', dados: { linhaDoTempo: [{ tipo: 'whatsapp', at: 1 }] } },
    ]);
    await identificarVisitantePeloCodigo(db, BASE);
    expect(gravado[0].campos.linhaDoTempo).toBeUndefined();
  });

  it('sem código ou sem loja nem consulta o banco', async () => {
    const collection = vi.fn();
    expect(await identificarVisitantePeloCodigo({ collection }, { ...BASE, codigo: '' })).toBe(false);
    expect(await identificarVisitantePeloCodigo({ collection }, { ...BASE, storeId: '' })).toBe(false);
    expect(collection).not.toHaveBeenCalled();
  });
});
