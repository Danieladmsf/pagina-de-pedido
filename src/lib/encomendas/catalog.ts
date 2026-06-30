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

export interface SkuOption { id: string; name: string; desc?: string; price: number; }

// Especial da casa — produto sazonal com data fixa (genérico, sem marca).
export const ESPECIAL_INFO = {
  title: 'Bolo no pote — edição da estação',
  desc: 'Camadas de massa, recheio cremoso e calda da estação, servido no pote. Consumir gelado.',
  windowLabel: 'Retirada apenas no período divulgado da campanha.',
};
export const ESPECIAL_ITEMS: SkuOption[] = [
  { id: 'esp-pote', name: 'Bolo no pote', desc: 'Porção individual, aprox. 250g.', price: 22 },
  { id: 'esp-cento', name: 'Caixa com 6 potes', desc: 'Sortidos a combinar.', price: 120 },
];

// Tortas prontas por tamanho
export const TORTAS: SkuOption[] = [
  { id: 'banoffe-p', name: 'Banoffe · P', price: 55 },
  { id: 'limao-p', name: 'Torta de limão · P', price: 55 },
  { id: 'pistache-p', name: 'Pistache · P', price: 65 },
  { id: 'banoffe-g', name: 'Banoffe · G', price: 110 },
  { id: 'limao-g', name: 'Torta de limão · G', price: 110 },
  { id: 'frutas-g', name: 'Frutas vermelhas · G', price: 125 },
];

// Docinhos — mín. 50 por sabor (cento/meio-cento)
export const DOCINHOS: SkuOption[] = [
  { id: 'brig', name: 'Brigadeiro tradicional (50un)', desc: 'Preço por meio-cento', price: 85 },
  { id: 'beijinho', name: 'Beijinho (50un)', price: 85 },
  { id: 'ninho-doce', name: 'Leite ninho (50un)', price: 95 },
  { id: 'gourmet', name: 'Gourmet sortido (50un)', desc: 'Seleção especial da casa', price: 135 },
];

export const DELIVERY_TIMES = ['10:00', '11:00', '14:00', '15:00', '16:00', '17:00'];
