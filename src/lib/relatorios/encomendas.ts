/**
 * Encomenda lida como venda, para o relatório.
 *
 * Não dava para reusar `encomendas/pedido.encomendaComoPedido`: lá o bolo vira
 * UMA linha com o peso dentro do nome ("Bolo Olho de sogra 3 kg"), que é o certo
 * num cupom e no extrato — a pessoa quer ver o que comprou. Num ranking isso
 * parte o mesmo bolo em uma linha por peso, e a pergunta "qual sabor sai mais"
 * fica sem resposta.
 *
 * Aqui o bolo é o SABOR, vendido por peso — igual a um produto `saleUnit: 'kg'`
 * do cardápio. Assim "Olho de sogra" soma os 3 kg de uma encomenda com os 2 kg
 * de outra, do mesmo jeito que a balança do balcão soma.
 *
 * As chaves saem com prefixo `enc:` de propósito: o catálogo de encomenda é
 * outro (docinho tem slug, bolo não tem id nenhum), e um slug solto no mesmo
 * espaço de nomes do `menuItems` poderia colidir com o id de um produto.
 *
 * Função pura, sem Firestore e sem React.
 */

import type { ItemDaVenda, VendaDoRelatorio } from './venda';
import { foiCancelada } from './venda';

/**
 * As três listas do documento de encomenda, e de onde sai o nome delas.
 *
 * `tortasItems` e `docinhosItems` são nomes INTERNOS e não são o que a loja
 * chama. Na Gostinho de Céu o slot `tortas` está configurado como
 * **"Brigadeiros"** e o `docinhos` como **"Doces Finos"** — chamar um brigadeiro
 * de "Torta" no relatório dela faria a tela parecer errada. O rótulo bom vem do
 * catálogo da loja: primeiro o `group` do item ("Brigadeiros Tradicionais"),
 * senão o `title` da seção. Os nomes aqui são só a última reserva, para quando
 * o catálogo não vier junto.
 */
const LISTAS: {
  campo: 'especialItems' | 'tortasItems' | 'docinhosItems';
  kind: string;
  catalogo: 'especialItems' | 'tortas' | 'docinhos';
  reserva: string;
}[] = [
  { campo: 'especialItems', kind: 'especial', catalogo: 'especialItems', reserva: 'Especiais' },
  { campo: 'tortasItems', kind: 'tortas', catalogo: 'tortas', reserva: 'Tortas' },
  { campo: 'docinhosItems', kind: 'docinhos', catalogo: 'docinhos', reserva: 'Docinhos' },
];

type NomesDoCatalogo = {
  /** id do SKU -> seção que a loja deu a ele. */
  grupoPorId: Map<string, string>;
  /** `kind` do produto -> título que a loja deu à seção. */
  tituloPorKind: Map<string, string>;
};

function lerCatalogo(catalogo: any): NomesDoCatalogo {
  const grupoPorId = new Map<string, string>();
  const tituloPorKind = new Map<string, string>();

  for (const produto of Array.isArray(catalogo?.products) ? catalogo.products : []) {
    const kind = String(produto?.kind || '');
    const titulo = String(produto?.title || '').trim();
    if (kind && titulo) tituloPorKind.set(kind, titulo);
  }

  for (const { catalogo: lista } of LISTAS) {
    for (const sku of Array.isArray(catalogo?.[lista]) ? catalogo[lista] : []) {
      const id = String(sku?.id || '').trim();
      const grupo = String(sku?.group || '').trim();
      if (id && grupo) grupoPorId.set(id, grupo);
    }
  }

  return { grupoPorId, tituloPorKind };
}

function slug(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
}

/**
 * O peso do bolo em gramas.
 *
 * `kg` é o campo do modelo por quilo. Quando ele falta (encomenda antiga, ou
 * bolo escolhido por tamanho P/M/G), o rótulo do peso ainda costuma trazer o
 * número — "2 kg". Sem nenhum dos dois o bolo conta como unidade, não como
 * peso: melhor não mostrar quilo nenhum do que mostrar um quilo inventado.
 */
function gramasDoBolo(bolo: any): number {
  const kg = Number(bolo?.kg);
  if (Number.isFinite(kg) && kg > 0) return Math.round(kg * 1000);

  const rotulo = String(bolo?.weight || bolo?.size || '');
  const achou = rotulo.match(/([\d.,]+)\s*kg/i);
  if (!achou) return 0;
  const numero = Number(achou[1].replace(',', '.'));
  return Number.isFinite(numero) && numero > 0 ? Math.round(numero * 1000) : 0;
}

function itemDoBolo(bolo: any, grupo: string): ItemDaVenda | null {
  if (!bolo) return null;
  const sabor = String(bolo.flavor || bolo.filling || '').trim();
  const gramas = gramasDoBolo(bolo);

  return {
    id: `enc:bolo:${slug(sabor) || 'sem-sabor'}`,
    name: sabor ? `Bolo ${sabor}` : 'Bolo',
    quantity: 1,
    unitPrice: Number(bolo.total) || 0,
    saleUnit: gramas > 0 ? 'kg' : 'un',
    weightGrams: gramas,
    origem: 'encomenda',
    grupo,
  };
}

/**
 * Converte as encomendas em vendas do relatório, já sem as canceladas.
 *
 * `total` inclui a taxa de entrega, igual ao `totalAmount` de um pedido — é o
 * que entrou. A soma dos itens não fecha com ele quando houve taxa, e é a mesma
 * diferença que a tela já explica embaixo da tabela.
 */
export function encomendasComoVendas(
  encomendas: any[] | null | undefined,
  opcoes: { catalogo?: any } = {},
): VendaDoRelatorio[] {
  const lista = Array.isArray(encomendas) ? encomendas : [];
  const { grupoPorId, tituloPorKind } = lerCatalogo(opcoes.catalogo);
  const vendas: VendaDoRelatorio[] = [];

  for (const encomenda of lista) {
    if (!encomenda?.id) continue;
    if (foiCancelada(encomenda)) continue;

    const items: ItemDaVenda[] = [];
    const bolo = itemDoBolo(encomenda.bolo, tituloPorKind.get('bolo') || 'Bolos');
    if (bolo) items.push(bolo);

    for (const { campo, kind, reserva } of LISTAS) {
      for (const item of Array.isArray(encomenda[campo]) ? encomenda[campo] : []) {
        const nome = String(item?.name || '').trim();
        if (!nome) continue;
        const id = String(item?.id || '').trim();
        items.push({
          id: `enc:${id || slug(nome)}`,
          name: nome,
          quantity: Number(item?.qty) || 1,
          unitPrice: Number(item?.unitPrice) || 0,
          origem: 'encomenda',
          // Do mais específico para o mais genérico: a seção que a loja deu ao
          // item, o título da seção, e só então o nome interno da lista.
          grupo: grupoPorId.get(id) || tituloPorKind.get(kind) || reserva,
        });
      }
    }

    vendas.push({
      id: encomenda.id,
      status: encomenda.status,
      orderDateTime: encomenda.orderDateTime,
      createdAt: encomenda.createdAt,
      totalAmount: Number(encomenda.total) || 0,
      items,
    });
  }

  return vendas;
}
