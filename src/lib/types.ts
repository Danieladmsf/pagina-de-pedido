
export type Category = 'Todos' | 'Sucos' | 'Vitaminas' | 'Salgados' | 'Pratos Feitos' | 'Sobremesas';

export interface Addon {
  id: string;
  name: string;
  description?: string;
  price: number;
  ownerId: string;
  active?: boolean;
  imageUrl?: string;
  group?: string; // Grupo: "Carnes", "Guarnições", "Sabores Suco", etc.
}

export interface AddonCategory {
  id: string;
  name: string;
  ownerId: string;
  addonIds?: string[];
  usePrice?: boolean;
}

export interface ComboItem {
  itemId: string;
  name: string;
  price: number;
}

export interface AddonGroup {
  name: string;       // "Escolha a Carne", "Guarnição", etc.
  addonIds: string[];
  addonCategoryId?: string;
  addonCategoryName?: string;
  usePrice?: boolean;
  min: number;        // Mínimo de seleção obrigatória
  max: number;        // Máximo de seleção
  freeLimit?: number; // Quantidade de opções inclusas grátis no valor do prato
  freeAddonIds?: string[]; // IDs dos complementos que serão forçados a R$ 0,00 neste grupo
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
  prazo?: string;
  // Marmita fields
  isMarmita?: boolean;
  fixedItems?: string[];       // ["Arroz", "Feijão", "Salada"]
  addonGroups?: AddonGroup[];  // Grupos de seleção obrigatória
}

export interface SelectedAddon {
  id: string;
  name: string;
  description?: string;
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
