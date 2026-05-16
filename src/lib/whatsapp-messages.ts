export type WhatsAppMessageKey =
  | 'firstContact'
  | 'orderReceived'
  | 'orderReadyDelivery'
  | 'orderReadyPickup'
  | 'orderReadyDineIn'
  | 'orderOutForDelivery'
  | 'orderPickupReady'
  | 'orderDineInReady'
  | 'storeClosed';

export type WhatsAppMessageTemplates = Record<WhatsAppMessageKey, string>;

type WorkingHour = {
  day: string;
  open: string;
  close: string;
  isClosed?: boolean;
};

export const WHATSAPP_MESSAGE_LABELS: Record<WhatsAppMessageKey, string> = {
  firstContact: 'Primeiro contato',
  orderReceived: 'Pedido recebido',
  orderReadyDelivery: 'Pedido pronto/finalizando',
  orderReadyPickup: 'Retirada pronta',
  orderReadyDineIn: 'Pedido pronto na mesa',
  orderOutForDelivery: 'Saiu para entrega',
  orderPickupReady: 'Pronto para retirada',
  orderDineInReady: 'Disponivel no salao',
  storeClosed: 'Loja fechada',
};

export const DEFAULT_WHATSAPP_MESSAGES: WhatsAppMessageTemplates = {
  firstContact:
    'Ol\u00e1! Seja bem-vindo(a) \u00e0 {loja}.\n\nFa\u00e7a seu pedido pelo nosso card\u00e1pio digital:\n{link}',
  orderReceived:
    'Ol\u00e1, {primeiro_nome}! tudo bem?\u{1F60A}\nSeu pedido n\u00ba #{pedido} foi recebido com sucesso!\n\n\u{1F4E6} Resumo do pedido:\n{itens}\n\n\u{1F4B5} Total: {total}\n\u{1F4B3} Pagamento: {pagamento}{tempo_estimado}\n\nAgradecemos pela prefer\u00eancia e esperamos que aproveite seu docinho ao m\u00e1ximo! \u{1F90E}',
  orderReadyDelivery:
    'Ol\u00e1, {primeiro_nome}! \u2705\nSeu pedido n\u00ba #{pedido} est\u00e1 sendo finalizado! Em breve sair\u00e1 para entrega. \u{1F6F5}',
  orderReadyPickup:
    'Ol\u00e1, {primeiro_nome}! \u2705\nSeu pedido n\u00ba #{pedido} est\u00e1 *pronto* e dispon\u00edvel para retirada! \u{1F3EA}\n\nVenha buscar quando quiser. Estamos te esperando! \u{1F60A}',
  orderReadyDineIn:
    'Ol\u00e1, {primeiro_nome}! \u{1F37D}\uFE0F\nSeu pedido n\u00ba #{pedido} est\u00e1 *pronto*!\n\nJ\u00e1 estamos levando at\u00e9 a sua mesa. Bom apetite! \u{1F60B}',
  orderOutForDelivery:
    'Ol\u00e1, {primeiro_nome}! Seu pedido n\u00ba #{pedido} saiu para entrega. \u{1F6F5}\n\nEm breve chegar\u00e1 at\u00e9 voc\u00ea!',
  orderPickupReady:
    'Ol\u00e1, {primeiro_nome}! \u2705\u{1F3EA}\nSeu pedido n\u00ba #{pedido} est\u00e1 *pronto para retirada*!\n\nPode vir buscar a qualquer momento. Obrigado pela prefer\u00eancia! \u{1F60A}',
  orderDineInReady:
    'Ol\u00e1, {primeiro_nome}! \u{1F37D}\uFE0F\u2728\nSeu pedido n\u00ba #{pedido} est\u00e1 *dispon\u00edvel*!\n\nSeu prato j\u00e1 est\u00e1 pronto. Bom apetite! \u{1F60B}',
  storeClosed:
    'Olá! No momento a {loja} está fechada.\n\nNosso horário de atendimento:\n{horarios}\n\n{proxima_abertura}\n\nEnquanto isso, você já pode dar uma espiadinha no nosso cardápio e deixar tudo pronto para pedir quando abrirmos:\n{link}\n\nAgradecemos o carinho e a preferência! 🥰',
};

export function getWhatsAppMessages(saved?: Partial<WhatsAppMessageTemplates> | null): WhatsAppMessageTemplates {
  return {
    ...DEFAULT_WHATSAPP_MESSAGES,
    ...(saved || {}),
  };
}

export function renderWhatsAppTemplate(template: string, values: Record<string, unknown>) {
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (_, key) => {
    const value = values[key];
    return value === null || value === undefined ? '' : String(value);
  });
}

export function slugifyStoreName(name: string) {
  return (name || 'loja')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .toLowerCase();
}

export function buildStoreLink(storeProfile: any, ownerId: string, origin?: string) {
  const baseOrigin = (origin || process.env.NEXT_PUBLIC_APP_URL || '').replace(/\/$/, '');
  const storeName = storeProfile?.general?.name || storeProfile?.storeName || 'loja';
  const slugId = storeProfile?.shortSlug || ownerId;
  const path = `/${slugifyStoreName(storeName)}-${slugId}`;
  return baseOrigin ? `${baseOrigin}${path}` : path;
}

export function formatWorkingHours(workingHours?: WorkingHour[] | null) {
  if (!workingHours || workingHours.length === 0) return 'Hor\u00e1rio n\u00e3o informado.';

  return workingHours
    .map((wh) => {
      if (wh.isClosed) return `${wh.day}: fechado`;
      return `${wh.day}: ${wh.open || '--:--'} \u00e0s ${wh.close || '--:--'}`;
    })
    .join('\n');
}

export function getStoreOpenState(storeProfile: any, now = new Date()) {
  if (!storeProfile) return { isOpen: true, reason: '' };
  if (storeProfile.isCaixaAberto === false) return { isOpen: false, reason: 'caixa_closed' };

  const timezone = storeProfile?.general?.timezone || 'America/Sao_Paulo';
  const localNow = new Date(now.toLocaleString('en-US', { timeZone: timezone }));
  const yyyy = localNow.getFullYear();
  const mm = String(localNow.getMonth() + 1).padStart(2, '0');
  const dd = String(localNow.getDate()).padStart(2, '0');
  const todayStr = `${yyyy}-${mm}-${dd}`;

  const closure = storeProfile.plannedClosures?.find((c: any) => c.date === todayStr);
  if (closure) {
    return { isOpen: false, reason: closure.reason ? `Fechado hoje: ${closure.reason}` : 'hours_closed' };
  }

  const workingHours = storeProfile.workingHours as WorkingHour[] | undefined;
  if (workingHours && workingHours.length > 0) {
    const daysMap = ['Domingo', 'Segunda', 'Terca', 'Quarta', 'Quinta', 'Sexta', 'Sabado'];
    const accentDaysMap = ['Domingo', 'Segunda', 'Ter\u00e7a', 'Quarta', 'Quinta', 'Sexta', 'S\u00e1bado'];
    const dayIndex = localNow.getDay();
    const todayConfig = workingHours.find((wh) => wh.day === accentDaysMap[dayIndex] || wh.day === daysMap[dayIndex]);

    if (todayConfig) {
      if (todayConfig.isClosed) return { isOpen: false, reason: 'hours_closed' };

      const [openHour, openMin] = String(todayConfig.open || '00:00').split(':').map(Number);
      const [closeHour, closeMin] = String(todayConfig.close || '23:59').split(':').map(Number);
      const currentMins = localNow.getHours() * 60 + localNow.getMinutes();
      const openMins = (openHour || 0) * 60 + (openMin || 0);
      const closeMins = (closeHour || 0) * 60 + (closeMin || 0);

      if (currentMins < openMins || currentMins > closeMins) {
        return { isOpen: false, reason: 'hours_closed' };
      }
    }
  }

  return { isOpen: true, reason: '' };
}

export function formatNextOpeningTime(workingHours?: WorkingHour[] | null, plannedClosures?: any[], timezoneStr?: string, now = new Date()) {
  if (!workingHours || workingHours.length === 0) return '';

  let localNow = new Date();
  try {
    const tz = timezoneStr && timezoneStr.trim() !== '' ? timezoneStr : 'America/Sao_Paulo';
    localNow = new Date(now.toLocaleString('en-US', { timeZone: tz }));
  } catch (e) {
    localNow = new Date(now);
  }

  const daysMap = ['domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado'];
  const accentDaysMap = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
  const displayDaysMap = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];

  for (let offset = 0; offset <= 7; offset++) {
    const checkDate = new Date(localNow);
    checkDate.setDate(localNow.getDate() + offset);

    const yyyy = checkDate.getFullYear();
    const mm = String(checkDate.getMonth() + 1).padStart(2, '0');
    const dd = String(checkDate.getDate()).padStart(2, '0');
    const dateStr = `${yyyy}-${mm}-${dd}`;

    const closure = plannedClosures?.find((c: any) => c.date === dateStr);
    if (closure) continue;

    const dayIndex = checkDate.getDay();
    const dayStr1 = daysMap[dayIndex];
    const dayStr2 = accentDaysMap[dayIndex];

    const config = workingHours.find((wh) => {
      const whDay = String(wh.day || '').toLowerCase();
      return whDay === dayStr1 || whDay === dayStr2;
    });

    if (config && !config.isClosed) {
      const [openHour, openMin] = String(config.open || '00:00').split(':').map(Number);
      
      if (offset === 0) {
        const currentMins = localNow.getHours() * 60 + localNow.getMinutes();
        const openMins = (openHour || 0) * 60 + (openMin || 0);
        if (currentMins < openMins) {
          return `A próxima abertura será hoje às ${String(openHour || 0).padStart(2, '0')}:${String(openMin || 0).padStart(2, '0')} hs ⏰🎉.`;
        }
      } else {
        const displayDate = `${dd}/${mm}`;
        const dayName = displayDaysMap[dayIndex];
        return `A próxima abertura será no dia ${displayDate} (${dayName}) às ${String(openHour || 0).padStart(2, '0')}:${String(openMin || 0).padStart(2, '0')} hs ⏰🎉.`;
      }
    }
  }

  return '';
}
