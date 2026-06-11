
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
  removedAddonIds?: string[];
  /** Pausados SÓ neste container (o active do addon segue valendo global). */
  pausedAddonIds?: string[];
  usePrice?: boolean;
  min?: number;
  max?: number;
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
  max?: number;        // Máximo de seleção
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
  stockQuantity?: number | null;
}

export interface SelectedAddon {
  id: string;
  name: string;
  description?: string;
  price: number;
  group?: string;
}

export interface CartItem extends MenuItem {
  cartId: string;
  quantity: number;
  customization?: {
    addons?: SelectedAddon[];
    notes?: string;
  };
}
