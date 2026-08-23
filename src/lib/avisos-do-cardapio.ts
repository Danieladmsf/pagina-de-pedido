/**
 * O que a dona faria se lesse a tela inteira — em três frases, no topo.
 *
 * Painel ninguém abre. Quem toca a loja passa o dia atendendo, e uma tela com
 * seis tabelas é uma tela que ela vai olhar uma vez e nunca mais. Estes avisos
 * são a leitura que um sócio atento faria por ela: só o que mudou, só o que dá
 * para agir hoje, com o número na frente e o verbo no meio.
 *
 * Duas regras que fazem a diferença entre aviso e ruído:
 *
 * - **Massa mínima.** "1 pessoa procurou X" não é padrão, é acaso. Cada aviso
 *   tem um piso, e abaixo dele não nasce.
 * - **Três, no máximo.** Uma lista de dez avisos vira painel de novo. Fica o
 *   que vale mais dinheiro ou mais decisão.
 *
 * Puro de propósito (sem Firestore, sem React).
 */

import { brl } from './utils';
import { nomeDoDia, type BuscaSemResultado, type PortaFechada } from './decisoes-do-cardapio';
import { ORIGEM_DIRETA } from './origem';
import type { LinhaDeReceita } from './receita-por-origem';

export type TomDoAviso = 'acao' | 'atencao' | 'bom';

export interface AvisoDoCardapio {
  id: string;
  tom: TomDoAviso;
  /** A frase, pronta para a tela. Sem jargão e sem nome de coleção. */
  texto: string;
  /** Usado só para ordenar: quanto vale prestar atenção nisto. */
  peso: number;
}

/** Quantos avisos cabem antes de a tela virar painel de novo. */
export const LIMITE_DE_AVISOS = 3;

/** Pisos que separam padrão de acaso. */
const MINIMO_DE_PESSOAS_NA_ORIGEM = 5;
const MINIMO_DE_BUSCAS = 3;
const MINIMO_NA_PORTA = 5;

export interface EntradaDosAvisos {
  origens: LinhaDeReceita[];
  portaFechada: PortaFechada;
  buscas: BuscaSemResultado[];
  carrinhosParados: number;
  valorParado: number;
  /** Como o período aparece escrito na tela ("hoje", "os últimos 7 dias"). */
  periodo: string;
}

export function avisosDoCardapio(entrada: EntradaDosAvisos): AvisoDoCardapio[] {
  const avisos: AvisoDoCardapio[] = [];

  // 1. Dinheiro escolhido e não fechado. É o único aviso que vira telefonema
  //    ainda hoje, então pesa mais que qualquer análise.
  if (entrada.carrinhosParados > 0 && entrada.valorParado > 0) {
    const pessoas = entrada.carrinhosParados;
    avisos.push({
      id: 'carrinho-parado',
      tom: 'acao',
      texto: `${brl(entrada.valorParado)} em ${pessoas} ${pessoas === 1 ? 'sacola montada' : 'sacolas montadas'} que ninguém fechou. Uma mensagem hoje ainda pega essa venda.`,
      peso: 1_000_000 + entrada.valorParado,
    });
  }

  // 2. Divulgação que traz gente e não traz pedido. Sem isto a loja continua
  //    pagando (em tempo ou em dinheiro) por um canal que não vende.
  const secas = entrada.origens
    .filter(
      (o) =>
        o.origem !== ORIGEM_DIRETA &&
        o.pessoas >= MINIMO_DE_PESSOAS_NA_ORIGEM &&
        o.pedidos === 0,
    )
    .sort((a, b) => b.pessoas - a.pessoas);
  if (secas[0]) {
    avisos.push({
      id: `origem-sem-venda-${secas[0].origem}`,
      tom: 'atencao',
      texto: `${secas[0].rotulo} trouxe ${secas[0].pessoas} pessoas em ${entrada.periodo} e nenhuma comprou. Vale rever o que esse link mostra primeiro.`,
      peso: 10_000 + secas[0].pessoas,
    });
  }

  // 3. E o contrário: o canal que está pagando as contas merece ser dito em voz
  //    alta, senão a loja divide esforço igual entre o que vende e o que não.
  const campea = entrada.origens
    .filter((o) => o.origem !== ORIGEM_DIRETA && o.receita > 0)
    .sort((a, b) => b.receita - a.receita)[0];
  if (campea) {
    avisos.push({
      id: `origem-campea-${campea.origem}`,
      tom: 'bom',
      texto: `${campea.rotulo} trouxe ${brl(campea.receita)} em ${entrada.periodo}. É onde vale insistir.`,
      peso: 5_000 + campea.receita,
    });
  }

  // 4. Porta fechada concentrada numa hora só. Espalhado pelo dia é curiosidade;
  //    empilhado numa hora é decisão de horário.
  const hora = entrada.portaFechada.horas[0];
  if (hora && hora.visitas >= MINIMO_NA_PORTA) {
    const dia = entrada.portaFechada.dias[0];
    const ondeDoi = dia ? ` O dia que mais junta gente é ${nomeDoDia(dia.dia)}.` : '';
    avisos.push({
      id: 'porta-fechada',
      tom: 'atencao',
      texto: `${hora.visitas} pessoas abriram o cardápio às ${String(hora.hora).padStart(2, '0')}h, com a loja fechada.${ondeDoi}`,
      peso: 1_000 + hora.visitas,
    });
  }

  // 5. Produto que o cliente procura e a loja não tem cadastrado.
  const busca = entrada.buscas.find((b) => b.pessoas >= MINIMO_DE_BUSCAS);
  if (busca) {
    avisos.push({
      id: `busca-${busca.termo}`,
      tom: 'atencao',
      texto: `${busca.pessoas} pessoas procuraram "${busca.termo}" no cardápio e não acharam nada.`,
      peso: 500 + busca.pessoas,
    });
  }

  return avisos.sort((a, b) => b.peso - a.peso).slice(0, LIMITE_DE_AVISOS);
}
