
export type Category = 'Todos' | 'Sucos' | 'Vitaminas' | 'Salgados' | 'Pratos Feitos' | 'Sobremesas';

export interface Addon {
  id: string;
  name: string;
  price: number;
  ownerId: string;
}

export interface MenuItem {
  id: string;
  name: string;
  description: string;
  price: number;
  category?: Category;
  categoryId?: string;
  imageUrl: string;
  imageHint?: string;
  addonIds?: string[];
}

export interface SelectedAddon {
  id: string;
  name: string;
  price: number;
}

export interface CartItem extends MenuItem {
  cartId: string;
  quantity: number;
  customization?: {
    addons?: SelectedAddon[];
    notes?: string;
  };
}
