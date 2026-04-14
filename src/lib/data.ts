
import { MenuItem, Category as CategoryType } from './types';
import { PlaceHolderImages } from './placeholder-images';

const getImg = (id: string) => PlaceHolderImages.find(img => img.id === id);

export const MENU_ITEMS: MenuItem[] = [
  {
    id: '1',
    name: 'Suco Lima Limão Especial',
    description: 'Nossa assinatura! Suco refrescante de limão taiti e limão siciliano com um toque de hortelã.',
    price: 12.00,
    category: 'Sucos',
    imageUrl: getImg('juice-lima-limao')?.imageUrl || '',
    imageHint: getImg('juice-lima-limao')?.imageHint || ''
  },
  {
    id: '2',
    name: 'Vitamina de Frutas Tropical',
    description: 'Batida cremosa com leite, banana, mamão e maçã. Energia pura para o seu dia.',
    price: 15.00,
    category: 'Vitaminas',
    imageUrl: getImg('vitamin-mixed')?.imageUrl || '',
    imageHint: getImg('vitamin-mixed')?.imageHint || ''
  },
  {
    id: '3',
    name: 'Coxinha de Frango Premium',
    description: 'Massa artesanal de batata recheada com frango desfiado temperado e catupiry original.',
    price: 8.50,
    category: 'Salgados',
    imageUrl: getImg('salgado-coxinha')?.imageUrl || '',
    imageHint: getImg('salgado-coxinha')?.imageHint || ''
  },
  {
    id: '4',
    name: 'PF do Dia (Prato Feito)',
    description: 'Arroz branco, feijão carioquinha, bife acebolado ou frango grelhado, salada e batata frita.',
    price: 28.90,
    category: 'Pratos Feitos',
    imageUrl: getImg('prato-feito')?.imageUrl || '',
    imageHint: getImg('prato-feito')?.imageHint || ''
  },
  {
    id: '5',
    name: 'Suco de Laranja Natural',
    description: 'Suco 100% puro da fruta, espremido na hora. Fonte de vitamina C.',
    price: 10.00,
    category: 'Sucos',
    imageUrl: getImg('juice-orange-fresh')?.imageUrl || '',
    imageHint: getImg('juice-orange-fresh')?.imageHint || ''
  }
];

export const CATEGORIES: CategoryType[] = ['Todos', 'Sucos', 'Vitaminas', 'Salgados', 'Pratos Feitos', 'Sobremesas'];
