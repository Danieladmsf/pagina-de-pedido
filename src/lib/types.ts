
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
  // Forma de venda. Ausente ou 'un' = vendido por unidade (padrão histórico).
  // 'kg' = vendido por peso; nesse caso `price` é o preço POR QUILO e a venda
  // pede o peso (em gramas) para calcular o valor da linha.
  saleUnit?: 'un' | 'kg';
  category?: Category;
  categoryId?: string;
  imageUrl: string;
  imageHint?: string;
  // Galeria de fotos (capa + extras, em ordem). Quando presente, o carrossel
  // usa este array; senão, faz fallback para [imageUrl]. imageUrl segue sendo a
  // capa exibida no card do cardápio.
  images?: string[];
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
  // Preenchidos apenas em itens vendidos por peso (saleUnit === 'kg'):
  weightGrams?: number;   // peso digitado na venda, em gramas
  pricePerKg?: number;    // preço por quilo capturado no momento da adição
  customization?: {
    addons?: SelectedAddon[];
    notes?: string;
  };
}
