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

export function getItemVisibilityState(item: any): Record<SalesChannel, boolean> {
  return MENU_VISIBILITY_CHANNELS.reduce<Record<SalesChannel, boolean>>((acc, channel) => {
    acc[channel.id] = isItemVisibleInChannel(item, channel.id);
    return acc;
  }, {} as Record<SalesChannel, boolean>);
}

export function hasAnyVisibleChannel(item: any) {
  return MENU_VISIBILITY_CHANNELS.some((channel) => isItemVisibleInChannel(item, channel.id));
}

export function getVisibilityToggleUpdate(item: any, channel: SalesChannel, active: boolean) {
  const nextState = {
    ...getItemVisibilityState(item),
    [channel]: active,
  };

  return {
    [channelById[channel].field]: active,
    isAvailable: Object.values(nextState).some(Boolean),
  };
}
