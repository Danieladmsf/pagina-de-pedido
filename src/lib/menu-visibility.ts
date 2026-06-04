export type SalesChannel = 'delivery' | 'pickup' | 'dine_in';
export type VisibilityField = 'showDelivery' | 'showPickup' | 'showDineIn';

export const MENU_VISIBILITY_CHANNELS: Array<{
  id: SalesChannel;
  label: string;
  field: VisibilityField;
  trackClass: string;
}> = [
  { id: 'delivery', label: 'Delivery', field: 'showDelivery', trackClass: 'bg-blue-500' },
  { id: 'pickup', label: 'Balcão', field: 'showPickup', trackClass: 'bg-amber-500' },
  { id: 'dine_in', label: 'Mesa', field: 'showDineIn', trackClass: 'bg-green-500' },
];

const channelById = MENU_VISIBILITY_CHANNELS.reduce<Record<SalesChannel, (typeof MENU_VISIBILITY_CHANNELS)[number]>>((acc, channel) => {
  acc[channel.id] = channel;
  return acc;
}, {} as Record<SalesChannel, (typeof MENU_VISIBILITY_CHANNELS)[number]>);

export function getSalesChannelLabel(channel: SalesChannel) {
  return channelById[channel].label;
}

export function isItemVisibleInChannel(item: any, channel: SalesChannel) {
  return item?.[channelById[channel].field] !== false;
}

export function hasAnyVisibleChannel(item: any) {
  return MENU_VISIBILITY_CHANNELS.some((channel) => isItemVisibleInChannel(item, channel.id));
}

/**
 * Toggles de visibilidade exibidos no painel (aba Produtos).
 * "Balcão" e "Mesa" são unificados em "Local" porque são canais internos
 * operados pelo próprio admin (PDV + aba Mesas). Cada toggle pode controlar
 * mais de um canal interno ao mesmo tempo.
 */
export type VisibilityToggle = {
  id: 'delivery' | 'local';
  label: string;
  channels: SalesChannel[];
  trackClass: string;
};

export const MENU_VISIBILITY_TOGGLES: VisibilityToggle[] = [
  { id: 'delivery', label: 'Delivery', channels: ['delivery'], trackClass: 'bg-blue-500' },
  { id: 'local', label: 'Local', channels: ['pickup', 'dine_in'], trackClass: 'bg-green-500' },
];

/** Toggle fica "ligado" se qualquer um dos seus canais estiver visível. */
export function isToggleActive(item: any, toggle: VisibilityToggle) {
  return toggle.channels.some((channel) => isItemVisibleInChannel(item, channel));
}

export function hasAnyVisibleToggle(item: any) {
  return MENU_VISIBILITY_TOGGLES.some((toggle) => isToggleActive(item, toggle));
}

/**
 * Update do Firestore ao ligar/desligar um toggle.
 * Grava todos os campos do grupo de uma vez (ex.: "Local" grava showPickup e
 * showDineIn juntos) e recalcula isAvailable como o OU de todos os canais —
 * mantendo Delivery e Local independentes entre si.
 */
export function getToggleUpdate(item: any, toggle: VisibilityToggle, active: boolean) {
  const fieldUpdates = toggle.channels.reduce<Partial<Record<VisibilityField, boolean>>>((acc, channel) => {
    acc[channelById[channel].field] = active;
    return acc;
  }, {});

  const merged = { ...item, ...fieldUpdates };

  return {
    ...fieldUpdates,
    isAvailable: hasAnyVisibleChannel(merged),
  };
}
