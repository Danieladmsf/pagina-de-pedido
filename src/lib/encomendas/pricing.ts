/**
 * Preço da encomenda — regra pura, sem React.
 *
 * Isto vivia solto dentro do formulário do cliente (EncomendaWizard). Agora a
 * loja também monta encomenda pelo balcão, numa tela com outra cara, e as duas
 * PRECISAM cobrar igual: bolo por kg, embalagem, adicional que recalcula a cada
 * 2 kg, docinho por cento, sinal. Preço em dois lugares é preço que diverge —
 * então a tela desenha, este arquivo calcula.
 */

import type {
  CakeExtra,
  CakeFlavor,
  CakeWeight,
  CoverOption,
  EncomendaCatalog,
  FillingOption,
  ProductKind,
  SizeOption,
  SkuOption,
} from './catalog';
import type { Encomenda, EncomendaLineItem } from './types';

export type Qmap = Record<string, number>;

/** O que foi escolhido — o mesmo formato nas duas telas. */
export type SelecaoEncomenda = {
  products: ProductKind[];
  bolo: {
    // Fluxo "por kg" (catálogo com `cakes`)
    flavorId?: string;
    weightId?: string;
    shape?: string;
    dough?: string;
    extraIds?: string[];
    // Fluxo antigo (tamanho + recheio + cobertura)
    sizeId?: string;
    fillingId?: string;
    coverId?: string;
    plateOn?: boolean;
  };
  especial: Qmap;
  tortas: Qmap;
  docinhos: Qmap;
};

export const selecaoVazia = (): SelecaoEncomenda => ({
  products: [],
  bolo: { extraIds: [] },
  especial: {},
  tortas: {},
  docinhos: {},
});

/**
 * Preço de um item por quantidade. Docinho vendido "por cento" tem regra
 * própria: 50 sozinho custa o preço das 50 (mais caro por unidade); acima
 * disso, a sobra de 50 é proporcional (metade do cento).
 */
export function skuTotal(sku: { price: number; priceCento?: number; price50?: number }, qty: number): number {
  if (typeof sku.priceCento === 'number') {
    if (qty <= 0) return 0;
    if (qty === 50) return typeof sku.price50 === 'number' ? sku.price50 : Math.round(sku.priceCento / 2);
    return Math.floor(qty / 100) * sku.priceCento + (qty % 100 === 50 ? sku.priceCento / 2 : 0);
  }
  return qty * sku.price;
}

/** Adicional do bolo: fixo, ou cobrado a cada 2 kg (a receita cobre 2 kg). */
export function precoDoAdicional(extra: Pick<CakeExtra, 'price' | 'per'>, pesoKg: number): number {
  return extra.per === '2kg' ? extra.price * Math.ceil((pesoKg || 1) / 2) : extra.price;
}

const ativos = <T extends { enabled?: boolean }>(list: T[] | undefined) =>
  (list || []).filter((x) => x.enabled !== false);

/** Itens escolhidos de uma seção, já com o valor de cada linha. */
export function linhasDe(map: Qmap, list: SkuOption[]): EncomendaLineItem[] {
  return ativos(list)
    .filter((x) => (map[x.id] || 0) > 0)
    .map((x) => {
      const qty = map[x.id];
      const total = skuTotal(x, qty);
      return { id: x.id, name: x.name, qty, unitPrice: qty ? total / qty : x.price, total };
    });
}

export type BoloResolvido = {
  /** true quando a loja usa o catálogo por kg (`cakes` preenchido). */
  porKg: boolean;
  flavor?: CakeFlavor;
  weight?: CakeWeight;
  size?: SizeOption;
  filling?: FillingOption;
  cover?: CoverOption;
  extras: { name: string; price: number }[];
  pesoKg: number;
  total: number;
};

/** Resolve o bolo escolhido (objetos + preço), nos dois modelos de catálogo. */
export function resolverBolo(cat: EncomendaCatalog, sel: SelecaoEncomenda): BoloResolvido {
  const porKg = (cat.cakes || []).length > 0;
  const flavor = (cat.cakes || []).find((x) => x.id === sel.bolo.flavorId);
  const weight = (cat.cakeWeights || []).find((x) => x.id === sel.bolo.weightId);
  // Baby (preço fixo, sem kg) conta como um bloco de 2 kg para os adicionais.
  const pesoKg = weight?.kg || 1;
  const extras = porKg
    ? (cat.cakeExtras || [])
        .filter((x) => (sel.bolo.extraIds || []).includes(x.id))
        .map((x) => ({ name: x.name, price: precoDoAdicional(x, pesoKg) }))
    : [];

  const size = cat.cakeSizes.find((x) => x.id === sel.bolo.sizeId);
  const filling = cat.cakeFillings.find((x) => x.id === sel.bolo.fillingId);
  const cover = cat.cakeCovers.find((x) => x.id === sel.bolo.coverId);

  const temBolo = sel.products.includes('bolo');
  let total = 0;
  if (temBolo && porKg && weight) {
    const base = weight.fixedPrice != null
      ? weight.fixedPrice
      : (flavor ? flavor.pricePerKg * (weight.kg || 0) : 0);
    total = base + (weight.packaging || 0) + extras.reduce((acc, x) => acc + x.price, 0);
  } else if (temBolo && !porKg && size) {
    total = size.basePrice + (filling?.price || 0) + (cover?.price || 0)
      + (sel.bolo.plateOn ? cat.platePrice : 0);
  }

  return { porKg, flavor, weight, size, filling, cover, extras, pesoKg, total };
}

/**
 * Caminho de volta: documento gravado → seleção editável.
 *
 * O doc guarda NOME ("Floresta negra"), não id — então sabor, recheio,
 * cobertura e adicionais são reencontrados pelo nome no catálogo atual. Se a
 * loja renomeou ou apagou um item depois do pedido, ele não casa e volta
 * vazio; por isso a tela de edição compara o total recalculado com o total
 * gravado e avisa em vez de salvar um bolo mais barato em silêncio.
 */
export function selecaoDaEncomenda(cat: EncomendaCatalog, enc: Encomenda): SelecaoEncomenda {
  const porNome = (list: { id: string; name: string }[] | undefined, nome?: string) =>
    (nome ? (list || []).find((x) => x.name === nome)?.id : '') || '';

  const bolo = enc.bolo;
  const qmap = (linhas?: EncomendaLineItem[]): Qmap =>
    (linhas || []).reduce((acc, l) => { acc[l.id] = l.qty; return acc; }, {} as Qmap);

  return {
    products: [...((enc.products || []) as ProductKind[])],
    bolo: {
      // Fluxo por kg: `sizeId` guarda o id do PESO.
      flavorId: porNome(cat.cakes, bolo?.flavor || bolo?.filling),
      weightId: (cat.cakeWeights || []).some((w) => w.id === bolo?.sizeId) ? bolo?.sizeId : '',
      shape: bolo?.shape || '',
      dough: bolo?.dough || '',
      extraIds: (bolo?.extras || [])
        .map((x) => porNome(cat.cakeExtras, x.name))
        .filter(Boolean),
      // Fluxo antigo.
      sizeId: cat.cakeSizes.some((s) => s.id === bolo?.sizeId) ? bolo?.sizeId : '',
      fillingId: porNome(cat.cakeFillings, bolo?.filling),
      coverId: porNome(cat.cakeCovers, bolo?.cover),
      plateOn: bolo?.plate?.on === true,
    },
    especial: qmap(enc.especialItems),
    tortas: qmap(enc.tortasItems),
    docinhos: qmap(enc.docinhosItems),
  };
}

export type TotaisEncomenda = {
  bolo: BoloResolvido;
  especialLines: EncomendaLineItem[];
  tortasLines: EncomendaLineItem[];
  docinhosLines: EncomendaLineItem[];
  subtotal: number;
  deliveryFee: number;
  total: number;
  sinal: number;
  saldo: number;
};

/** Todos os valores da encomenda, do subtotal ao sinal. */
export function calcularTotais(
  cat: EncomendaCatalog,
  sel: SelecaoEncomenda,
  opts: { deliveryFee?: number; sinalPercent: number },
): TotaisEncomenda {
  const bolo = resolverBolo(cat, sel);
  const tem = (k: ProductKind) => sel.products.includes(k);

  const especialLines = tem('especial') ? linhasDe(sel.especial, cat.especialItems) : [];
  const tortasLines = tem('tortas') ? linhasDe(sel.tortas, cat.tortas) : [];
  const docinhosLines = tem('docinhos') ? linhasDe(sel.docinhos, cat.docinhos) : [];

  const somaLinhas = (lines: EncomendaLineItem[]) => lines.reduce((acc, l) => acc + l.total, 0);
  const subtotal = bolo.total + somaLinhas(especialLines) + somaLinhas(tortasLines) + somaLinhas(docinhosLines);

  const deliveryFee = Math.max(0, Number(opts.deliveryFee) || 0);
  const total = subtotal + deliveryFee;
  // Percentual inteiro (30 = 30%); o /100 depois do round evita centavo perdido.
  const sinal = Math.round(total * (Number(opts.sinalPercent) || 0)) / 100;

  return {
    bolo,
    especialLines,
    tortasLines,
    docinhosLines,
    subtotal,
    deliveryFee,
    total,
    sinal,
    saldo: total - sinal,
  };
}

/**
 * Monta o documento da encomenda. As duas telas gravam pelo MESMO caminho —
 * é o que garante que a encomenda do balcão apareça na lista, no cupom e no
 * extrato exatamente como a que veio do link público.
 */
export function montarEncomenda(params: {
  id: string;
  customerUid: string;
  ownerId: string;
  cliente: { nome: string; telefone: string; nascimento?: string };
  sel: SelecaoEncomenda;
  totais: TotaisEncomenda;
  sinalPercent: number;
  entrega: {
    date: string;
    time: string;
    type: 'retirada' | 'delivery' | '';
    street?: string;
    number?: string;
    complement?: string;
    neighborhood?: string;
    city?: string;
    feeStatus?: 'calculada' | 'a_combinar';
  };
  plate?: { on: boolean; name?: string; age?: string; theme?: string; notes?: string; imageUrl?: string };
  status: Encomenda['status'];
  source: string;
  orderNotes?: string;
  comprovanteUrl?: string;
  valorPago?: number;
  createdAt?: any;
}): Encomenda {
  const { sel, totais } = params;
  const temBolo = sel.products.includes('bolo');
  const { bolo } = totais;

  return {
    id: params.id,
    customerUid: params.customerUid,
    ownerId: params.ownerId,
    customerName: params.cliente.nome.trim(),
    customerPhone: params.cliente.telefone.replace(/\D/g, ''),
    customerBirthDate: params.cliente.nascimento || '',
    isEmpresa: false,
    products: [...sel.products],
    bolo: !temBolo ? null : (bolo.porKg ? {
      sizeId: bolo.weight?.id || '',
      size: bolo.weight?.label || '',
      dough: sel.bolo.dough || '',
      filling: bolo.flavor?.name || '',
      cover: '',
      plate: { on: false },
      total: bolo.total,
      flavor: bolo.flavor?.name || '',
      weight: bolo.weight?.label || '',
      shape: sel.bolo.shape || '',
      pricePerKg: bolo.flavor?.pricePerKg,
      kg: bolo.weight?.kg,
      extras: bolo.extras,
    } : (bolo.size ? {
      sizeId: bolo.size.id,
      size: bolo.size.label,
      dough: sel.bolo.dough || '',
      filling: bolo.filling?.name || '',
      cover: bolo.cover?.name || '',
      plate: params.plate || { on: false },
      total: bolo.total,
    } : null)),
    especialItems: totais.especialLines,
    tortasItems: totais.tortasLines,
    docinhosItems: totais.docinhosLines,
    delivery: {
      date: params.entrega.date,
      time: params.entrega.time,
      type: params.entrega.type,
      ...(params.entrega.type === 'delivery' ? {
        street: params.entrega.street || '',
        number: params.entrega.number || '',
        complement: params.entrega.complement || '',
        neighborhood: params.entrega.neighborhood || '',
        city: params.entrega.city || '',
        feeStatus: params.entrega.feeStatus || 'a_combinar',
      } : {}),
    },
    subtotal: totais.subtotal,
    deliveryFee: totais.deliveryFee,
    total: totais.total,
    sinalPercent: params.sinalPercent,
    sinal: totais.sinal,
    saldo: totais.saldo,
    status: params.status,
    ...(typeof params.valorPago === 'number' ? { valorPago: params.valorPago } : {}),
    comprovanteUrl: params.comprovanteUrl || '',
    orderNotes: params.orderNotes || '',
    source: params.source,
    orderDateTime: new Date().toISOString(),
    createdAt: params.createdAt,
  };
}
