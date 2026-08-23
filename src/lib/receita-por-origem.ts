/**
 * Quanto cada origem trouxe em DINHEIRO — não em cliques.
 *
 * O problema que isto resolve foi medido em 23/08/2026: a Gostinho de Céu teve
 * 441 visitas em 7 dias e 6 pedidos fechados pelo cardápio, mas fez 66 pedidos.
 * O cardápio dela é vitrine: a pessoa olha ali e fecha no WhatsApp ou no
 * balcão. Uma tabela que contasse só o pedido nascido no cardápio diria "5% de
 * conversão" e a dona desligaria a divulgação que está funcionando.
 *
 * Por isso o pedido é procurado em TODOS os canais e ligado à pessoa que
 * visitou. A ligação é por **id do cliente**; telefone é reserva de leitura,
 * nunca a chave (o PDV grava o número como foi digitado — ver as convenções de
 * integridade e `lib/customer-credit`).
 *
 * O que NÃO dá para saber, e a tela precisa dizer em voz alta: venda de balcão
 * sem cliente identificado não tem origem. Some as origens e o número não bate
 * com o faturamento — some as origens MAIS o "sem identificação" e bate.
 *
 * Puro de propósito (sem Firestore, sem React).
 */

import { ORIGEM_DIRETA, ORIGEM_DIRETA_LABEL, canalDaOrigem, normalizarOrigem, rotuloDaOrigem } from './origem';
import type { CanalOrigem } from './origem';

/** O mínimo do pedido que interessa aqui. */
export interface VendaLigavel {
  id?: string;
  /** ID completo do doc em `clientes` — a chave de verdade. */
  clienteId?: string;
  /** Telefone como foi gravado. Só reserva, e só depois de normalizado. */
  telefone?: string;
  total?: number;
}

/** O mínimo da pessoa que interessa aqui. */
export interface PessoaComOrigem {
  id: string;
  clienteId?: string;
  telefone?: string;
  origemPrimeira?: string;
  origemUltima?: string;
  linhaDoTempo?: { tipo: string }[];
  carrinho?: { itens?: unknown[]; valor?: number };
}

export interface LinhaDeReceita {
  origem: string;
  rotulo: string;
  canal: CanalOrigem | 'outro' | '';
  pessoas: number;
  olharam: number;
  /** Pessoas desta origem que compraram no período, em qualquer canal. */
  compraram: number;
  pedidos: number;
  receita: number;
  /** Receita dividida pelos pedidos. */
  ticket: number;
  /** Quantas das pessoas desta origem compraram, em %. */
  conversao: number;
}

export interface ReceitaPorOrigem {
  linhas: LinhaDeReceita[];
  /** Pedidos que encontraram dono entre quem visitou o cardápio. */
  pedidosLigados: number;
  receitaLigada: number;
  /** Pedidos sem cliente identificado, ou de quem não passou pelo cardápio. */
  pedidosSoltos: number;
  receitaSolta: number;
}

const soDigitos = (valor?: string) =>
  String(valor || '').replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, '');

/**
 * Junta as duas metades: quem visitou (com origem) e o que foi vendido.
 *
 * Cada pedido conta uma vez só. Duas pessoas nunca disputam o mesmo pedido: o
 * índice por id é consultado primeiro e, no telefone, um número que aponta para
 * mais de uma pessoa é descartado em vez de escolher no chute — regra da casa
 * para vínculo ambíguo.
 */
export function receitaPorOrigem(
  pessoas: PessoaComOrigem[],
  vendas: VendaLigavel[],
): ReceitaPorOrigem {
  const porCliente = new Map<string, PessoaComOrigem>();
  const porTelefone = new Map<string, PessoaComOrigem | null>();

  for (const p of pessoas) {
    const clienteId = (p.clienteId || '').trim();
    if (clienteId && !porCliente.has(clienteId)) porCliente.set(clienteId, p);

    const telefone = soDigitos(p.telefone);
    if (telefone.length >= 10) {
      // `null` marca telefone ambíguo: duas pessoas diferentes com o mesmo
      // número não escolhem dono para o pedido.
      porTelefone.set(telefone, porTelefone.has(telefone) ? null : p);
    }
  }

  const origemDe = (p: PessoaComOrigem) =>
    normalizarOrigem(p.origemPrimeira || p.origemUltima) || ORIGEM_DIRETA;

  const linhas = new Map<string, LinhaDeReceita>();
  const garantir = (origem: string) => {
    let linha = linhas.get(origem);
    if (!linha) {
      linha = {
        origem,
        rotulo: origem === ORIGEM_DIRETA ? ORIGEM_DIRETA_LABEL : rotuloDaOrigem(origem),
        canal: origem === ORIGEM_DIRETA ? '' : canalDaOrigem(origem),
        pessoas: 0,
        olharam: 0,
        compraram: 0,
        pedidos: 0,
        receita: 0,
        ticket: 0,
        conversao: 0,
      };
      linhas.set(origem, linha);
    }
    return linha;
  };

  for (const p of pessoas) {
    const linha = garantir(origemDe(p));
    linha.pessoas += 1;
    if ((p.linhaDoTempo || []).some((e) => e.tipo === 'viu')) linha.olharam += 1;
  }

  const compradores = new Map<string, Set<string>>(); // origem -> ids de pessoa
  let pedidosLigados = 0;
  let receitaLigada = 0;
  let pedidosSoltos = 0;
  let receitaSolta = 0;

  for (const venda of vendas) {
    const total = Number(venda.total) || 0;
    const clienteId = (venda.clienteId || '').trim();
    const telefone = soDigitos(venda.telefone);

    const dono =
      (clienteId && porCliente.get(clienteId)) ||
      (telefone.length >= 10 ? porTelefone.get(telefone) || null : null);

    if (!dono) {
      pedidosSoltos += 1;
      receitaSolta += total;
      continue;
    }

    const origem = origemDe(dono);
    const linha = garantir(origem);
    linha.pedidos += 1;
    linha.receita += total;
    pedidosLigados += 1;
    receitaLigada += total;

    const set = compradores.get(origem) || new Set<string>();
    set.add(dono.id);
    compradores.set(origem, set);
  }

  const arredondar = (valor: number) => Math.round(valor * 100) / 100;

  return {
    linhas: [...linhas.values()]
      .map((linha) => {
        const compraram = compradores.get(linha.origem)?.size ?? 0;
        return {
          ...linha,
          compraram,
          receita: arredondar(linha.receita),
          ticket: linha.pedidos > 0 ? arredondar(linha.receita / linha.pedidos) : 0,
          conversao: linha.pessoas > 0 ? Math.round((compraram / linha.pessoas) * 100) : 0,
        };
      })
      .sort((a, b) => b.receita - a.receita || b.pessoas - a.pessoas),
    pedidosLigados,
    receitaLigada: arredondar(receitaLigada),
    pedidosSoltos,
    receitaSolta: arredondar(receitaSolta),
  };
}
