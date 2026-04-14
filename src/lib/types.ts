
export type Category = 'Todos' | 'Sucos' | 'Vitaminas' | 'Salgados' | 'Pratos Feitos' | 'Sobremesas';

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
