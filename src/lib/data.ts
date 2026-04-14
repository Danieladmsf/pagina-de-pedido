
import { MenuItem } from './types';
import { PlaceHolderImages } from './placeholder-images';

const getImg = (id: string) => PlaceHolderImages.find(img => img.id === id);

export const MENU_ITEMS: MenuItem[] = [
  {
    id: '1',
    name: 'Burger Clássico',
    description: 'Pão brioche, carne angus 180g, queijo cheddar derretido, alface fresca e molho especial da casa.',
    price: 32.90,
    category: 'Burgers',
    imageUrl: getImg('burger-classic')?.imageUrl || '',
    imageHint: getImg('burger-classic')?.imageHint || ''
  },
  {
    id: '2',
    name: 'Pizza Margherita',
    description: 'Massa de fermentação natural, molho de tomate artesanal, mozzarella de búfala e manjericão fresco.',
    price: 48.00,
    category: 'Pizzas',
    imageUrl: getImg('pizza-margherita')?.imageUrl || '',
    imageHint: getImg('pizza-margherita')?.imageHint || ''
  },
  {
    id: '3',
    name: 'Spaghetti Carbonara',
    description: 'Tradicional spaghetti italiano com ovos, guanciale crocante, queijo pecorino e pimenta do reino.',
    price: 42.50,
    category: 'Pratos',
    imageUrl: getImg('pasta-carbonara')?.imageUrl || '',
    imageHint: getImg('pasta-carbonara')?.imageHint || ''
  },
  {
    id: '4',
    name: 'Pizza Pepperoni',
    description: 'Generosas fatias de pepperoni premium, mozzarella e orégano sobre massa fina e crocante.',
    price: 54.00,
    category: 'Pizzas',
    imageUrl: getImg('pizza-pepperoni')?.imageUrl || '',
    imageHint: getImg('pizza-pepperoni')?.imageHint || ''
  },
  {
    id: '5',
    name: 'Salada Caesar',
    description: 'Alface romana, croutons amanteigados, lascas de parmesão e o clássico molho Caesar.',
    price: 28.00,
    category: 'Pratos',
    imageUrl: getImg('salad-caesar')?.imageUrl || '',
    imageHint: getImg('salad-caesar')?.imageHint || ''
  },
  {
    id: '6',
    name: 'Suco de Laranja',
    description: 'Suco natural feito na hora, 100% fruta, sem adição de açúcar ou conservantes.',
    price: 12.00,
    category: 'Bebidas',
    imageUrl: getImg('juice-orange')?.imageUrl || '',
    imageHint: getImg('juice-orange')?.imageHint || ''
  },
  {
    id: '7',
    name: 'Brownie com Sorvete',
    description: 'Brownie de chocolate meio amargo servido quente com uma bola de sorvete de baunilha.',
    price: 24.50,
    category: 'Sobremesas',
    imageUrl: getImg('dessert-brownie')?.imageUrl || '',
    imageHint: getImg('dessert-brownie')?.imageHint || ''
  },
  {
    id: '8',
    name: 'Batata Frita G',
    description: 'Porção grande de batatas cortadas na hora, fritas em óleo vegetal e finalizadas com sal marinho.',
    price: 18.00,
    category: 'Burgers',
    imageUrl: getImg('fries-large')?.imageUrl || '',
    imageHint: getImg('fries-large')?.imageHint || ''
  }
];

export const CATEGORIES: Category[] = ['Todos', 'Burgers', 'Pizzas', 'Pratos', 'Bebidas', 'Sobremesas'];
