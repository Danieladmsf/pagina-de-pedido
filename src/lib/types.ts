
export type Category = 'Todos' | 'Sucos' | 'Vitaminas' | 'Salgados' | 'Pratos Feitos' | 'Sobremesas';

export interface Addon {
  id: string;
  name: string;
  price: number;
  ownerId: string;
  group?: string; // Grupo: "Carnes", "Guarnições", "Sabores Suco", etc.
}

export interface ComboItem {
  itemId: string;
  name: string;
  price: number;
}

export interface AddonGroup {
  name: string;       // "Escolha a Carne", "Guarnição", etc.
  addonIds: string[];
  min: number;        // Mínimo de seleção obrigatória
  max: number;        // Máximo de seleção
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
  // Combo fields
  isCombo?: boolean;
  comboItems?: ComboItem[];
  comboPrice?: number;
  originalPrice?: number;
  // Marmita fields
  isMarmita?: boolean;
  fixedItems?: string[];       // ["Arroz", "Feijão", "Salada"]
  addonGroups?: AddonGroup[];  // Grupos de seleção obrigatória
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
