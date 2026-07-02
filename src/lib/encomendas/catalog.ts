// Catálogo de encomendas (modalidade confeitaria) — identidade própria, genérica.
// Estes são os valores PADRÃO. Numa fase seguinte a aba admin "Encomendas" grava
// um catálogo por loja (store_profiles/{uid}.encomendas.catalog) que sobrescreve
// estes defaults. Nada aqui é nome de marca real — tudo é editável pelo lojista.

export type ProductKind = 'especial' | 'bolo' | 'tortas' | 'docinhos';

export interface CatalogProduct {
  kind: ProductKind;
  icon: string;
  title: string;
  description: string;
  imageUrl?: string;   // foto real do produto (substitui o emoji quando definida)
  enabled?: boolean;   // lojista pode desativar um tipo de produto (default: ativo)
}

export const PRODUCTS: CatalogProduct[] = [
  { kind: 'bolo', icon: '🎂', title: 'Bolo personalizado', description: 'Você monta: tamanho, massa, recheio, cobertura e plaquinha.' },
  { kind: 'tortas', icon: '🥧', title: 'Tortas geladas', description: 'Tortas prontas em fatias generosas, nos tamanhos P, M e G.' },
  { kind: 'docinhos', icon: '🍬', title: 'Docinhos finos', description: 'Brigadeiros, beijinhos e gourmet. Mínimo de 50 unidades por sabor.' },
  { kind: 'especial', icon: '✨', title: 'Especial da casa', description: 'Criação sazonal com data limitada de retirada.' },
];

export interface SizeOption {
  id: string; label: string; sub: string; basePrice: number; shape: 'redondo' | 'retangular';
}
export const CAKE_SIZES: SizeOption[] = [
  { id: 'P', label: 'P', sub: '15cm · até 12 pessoas', basePrice: 120, shape: 'redondo' },
  { id: 'M', label: 'M', sub: '17cm · até 15 pessoas', basePrice: 170, shape: 'redondo' },
  { id: 'G', label: 'G', sub: '20cm · até 20 pessoas', basePrice: 240, shape: 'redondo' },
  { id: 'GG', label: 'GG', sub: '30cm · até 30 pessoas', basePrice: 340, shape: 'redondo' },
  { id: 'XG', label: 'XG', sub: '40cm · até 50 pessoas', basePrice: 420, shape: 'retangular' },
  { id: 'XXG', label: 'XXG', sub: '50cm · até 60 pessoas', basePrice: 480, shape: 'retangular' },
];

export const CAKE_DOUGHS = ['Massa branca (baunilha)', 'Massa de chocolate'];

// Recheios em NÍVEIS — nomenclatura própria (não copia "Bronze/Prata/Ouro").
export interface FillingOption { id: string; name: string; tier: string; price: number; }
export const CAKE_FILLINGS: FillingOption[] = [
  { id: 'classico-brig', name: 'Brigadeiro cremoso', tier: 'Clássico', price: 0 },
  { id: 'classico-ninho', name: 'Leite ninho', tier: 'Clássico', price: 0 },
  { id: 'classico-coco', name: 'Coco com abacaxi', tier: 'Clássico', price: 0 },
  { id: 'premium-nutella', name: 'Ninho com avelã', tier: 'Premium', price: 30 },
  { id: 'premium-morango', name: 'Ninho com morango', tier: 'Premium', price: 30 },
  { id: 'premium-redvelvet', name: 'Red velvet', tier: 'Premium', price: 35 },
  { id: 'assinatura-pistache', name: 'Pistache artesanal', tier: 'Assinatura', price: 45 },
  { id: 'assinatura-frutas', name: 'Frutas vermelhas', tier: 'Assinatura', price: 45 },
];
export const FILLING_TIERS = ['Clássico', 'Premium', 'Assinatura'];

export interface CoverOption { id: string; name: string; desc: string; price: number; }
export const CAKE_COVERS: CoverOption[] = [
  { id: 'naked', name: 'Naked (sem laterais)', desc: 'O bolo com as camadas à mostra.', price: 0 },
  { id: 'ganache', name: 'Ganache de chocolate', desc: 'Cobertura cremosa e brilhante.', price: 35 },
  { id: 'chantininho', name: 'Chantininho', desc: 'Chantilly firme, pode ser colorido.', price: 35 },
];

export const PLATE_PRICE = 30;

export interface SkuOption {
  id: string;
  name: string;
  desc?: string;
  price: number;
  imageUrl?: string;
  group?: string;                   // seção na página (ex.: "Tortas Pequenas (P)", "Doces finos")
  minQty?: number;                  // pedido mínimo por item (ex.: 50 unidades por sabor)
  stepQty?: number;                 // incremento do stepper depois do mínimo (default 1)
  role?: 'principal' | 'adicional'; // Especial: o pedido exige ao menos 1 item "principal"
  enabled?: boolean;                // ocultar sem excluir (default: ativo)
}

// Especial da casa — produto sazonal com data fixa (genérico, sem marca).
export const ESPECIAL_INFO = {
  title: 'Bolo no pote — edição da estação',
  desc: 'Camadas de massa, recheio cremoso e calda da estação, servido no pote. Consumir gelado.',
  windowLabel: 'Retirada apenas no período divulgado da campanha.',
};
export const ESPECIAL_ITEMS: SkuOption[] = [
  { id: 'esp-pote', name: 'Bolo no pote', desc: 'Porção individual, aprox. 250g.', price: 22, role: 'principal' },
  { id: 'esp-calda', name: 'Calda extra da estação', desc: 'Porção para acompanhar.', price: 8, role: 'adicional' },
];

// Tortas prontas — o campo `group` cria as seções na página (ex.: por tamanho)
export const TORTAS: SkuOption[] = [
  { id: 'banoffe-p', name: 'Banoffe', price: 55, group: 'Tortas Pequenas (P)' },
  { id: 'limao-p', name: 'Torta de limão', price: 55, group: 'Tortas Pequenas (P)' },
  { id: 'pistache-p', name: 'Pistache', price: 65, group: 'Tortas Pequenas (P)' },
  { id: 'banoffe-g', name: 'Banoffe', price: 110, group: 'Tortas Grandes (G)' },
  { id: 'limao-g', name: 'Torta de limão', price: 110, group: 'Tortas Grandes (G)' },
  { id: 'frutas-g', name: 'Frutas vermelhas', price: 125, group: 'Tortas Grandes (G)' },
];

// Docinhos — preço por unidade; `minQty` é o pedido mínimo por sabor
export const DOCINHOS: SkuOption[] = [
  { id: 'brig', name: 'Brigadeiro tradicional', desc: 'Preço por unidade', price: 1.7, group: 'Doces tradicionais', minQty: 50, stepQty: 10 },
  { id: 'beijinho', name: 'Beijinho', desc: 'Preço por unidade', price: 1.7, group: 'Doces tradicionais', minQty: 50, stepQty: 10 },
  { id: 'ninho-doce', name: 'Leite ninho', desc: 'Preço por unidade', price: 1.9, group: 'Doces tradicionais', minQty: 50, stepQty: 10 },
  { id: 'gourmet', name: 'Gourmet sortido', desc: 'Seleção especial da casa', price: 2.7, group: 'Doces finos', minQty: 50, stepQty: 10 },
];

export const DELIVERY_TIMES = ['10:00', '11:00', '14:00', '15:00', '16:00', '17:00'];

// ---- Catálogo agregado: o wizard consome e a aba admin edita ----
export interface EncomendaCatalog {
  products: CatalogProduct[];
  cakeSizes: SizeOption[];
  cakeDoughs: string[];
  cakeFillings: FillingOption[];
  fillingTiers: string[];
  cakeCovers: CoverOption[];
  platePrice: number;
  especialInfo: { title: string; desc: string; windowLabel: string };
  especialItems: SkuOption[];
  tortas: SkuOption[];
  docinhos: SkuOption[];
  deliveryTimes: string[];
}

export const DEFAULT_CATALOG: EncomendaCatalog = {
  products: PRODUCTS,
  cakeSizes: CAKE_SIZES,
  cakeDoughs: CAKE_DOUGHS,
  cakeFillings: CAKE_FILLINGS,
  fillingTiers: FILLING_TIERS,
  cakeCovers: CAKE_COVERS,
  platePrice: PLATE_PRICE,
  especialInfo: ESPECIAL_INFO,
  especialItems: ESPECIAL_ITEMS,
  tortas: TORTAS,
  docinhos: DOCINHOS,
  deliveryTimes: DELIVERY_TIMES,
};

// Catálogo por loja (encomendas.catalog) sobre os defaults; campo ausente cai no default.
export function mergeCatalog(partial: any): EncomendaCatalog {
  const p = (partial && typeof partial === 'object') ? partial : {};
  const arr = <T,>(v: any, d: T[]): T[] => (Array.isArray(v) ? v : d);
  return {
    products: arr(p.products, DEFAULT_CATALOG.products),
    cakeSizes: arr(p.cakeSizes, DEFAULT_CATALOG.cakeSizes),
    cakeDoughs: arr(p.cakeDoughs, DEFAULT_CATALOG.cakeDoughs),
    cakeFillings: arr(p.cakeFillings, DEFAULT_CATALOG.cakeFillings),
    fillingTiers: arr(p.fillingTiers, DEFAULT_CATALOG.fillingTiers),
    cakeCovers: arr(p.cakeCovers, DEFAULT_CATALOG.cakeCovers),
    platePrice: typeof p.platePrice === 'number' ? p.platePrice : DEFAULT_CATALOG.platePrice,
    especialInfo: (p.especialInfo && typeof p.especialInfo === 'object') ? { ...DEFAULT_CATALOG.especialInfo, ...p.especialInfo } : DEFAULT_CATALOG.especialInfo,
    especialItems: arr(p.especialItems, DEFAULT_CATALOG.especialItems),
    tortas: arr(p.tortas, DEFAULT_CATALOG.tortas),
    docinhos: arr(p.docinhos, DEFAULT_CATALOG.docinhos),
    deliveryTimes: arr(p.deliveryTimes, DEFAULT_CATALOG.deliveryTimes),
  };
}
