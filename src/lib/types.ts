
export type Category = 'Todos' | 'Burgers' | 'Pizzas' | 'Pratos' | 'Bebidas' | 'Sobremesas';

export interface MenuItem {
  id: string;
  name: string;
  description: string;
  price: number;
  category: Category;
  imageUrl: string;
  imageHint: string;
}

export interface CartItem extends MenuItem {
  cartId: string;
  quantity: number;
  customization?: {
    size?: string;
    extras?: string[];
    notes?: string;
  };
}
