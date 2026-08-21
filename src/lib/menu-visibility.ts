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

/**
 * Botão Ligada/Desligada da aba Categorias. Desligada some do cardápio inteiro:
 * seções, abas, vitrine, páginas de oferta e também PDV/Mesa — o botão não fala
 * de canal, então "Desligada" tem que valer em tudo. Quem quer esconder só do
 * cardápio online usa os toggles Delivery/Local do produto.
 */
export function isCategoryOn(category: any) {
  return category?.isAvailable !== false;
}

const DIAS_DA_SEMANA = ['domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado'];
const limparDia = (d: string) =>
  String(d || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

/**
 * Ligada E dentro da janela de horário configurada (o ícone de relógio da aba
 * Categorias). A janela é do cardápio online — o PDV usa só `isCategoryOn`,
 * senão o balcão ficaria impedido de vender fora do horário do delivery.
 */
export function isCategoryVisibleNow(category: any, now: Date, timezone = 'America/Sao_Paulo') {
  if (!isCategoryOn(category)) return false;
  if (!category?.availability?.enabled) return true;

  let local = now;
  try {
    local = new Date(now.toLocaleString('en-US', { timeZone: timezone }));
  } catch {
    local = new Date(now);
  }

  const { days, startTime, endTime } = category.availability;
  const hoje = DIAS_DA_SEMANA[local.getDay()];
  if (days) {
    const noDia = days
      .map((d: string) => limparDia(d))
      .some((d: string) => d === hoje || d.includes(hoje) || hoje.includes(d));
    if (!noDia) return false;
  }

  const [abreHora, abreMin] = String(startTime || '00:00').split(':').map(Number);
  const [fechaHora, fechaMin] = String(endTime || '23:59').split(':').map(Number);
  const agora = local.getHours() * 60 + local.getMinutes();
  const abre = abreHora * 60 + abreMin;
  const fecha = fechaHora * 60 + fechaMin;

  return fecha <= abre ? agora >= abre || agora <= fecha : agora >= abre && agora <= fecha;
}

/** Categorias que o cliente pode ver agora, já na ordem de exibição. */
export function getVisibleCategories(categories: any[] | null | undefined, now: Date, timezone?: string) {
  return (categories || [])
    .filter((cat) => isCategoryVisibleNow(cat, now, timezone))
    .sort((a, b) => (a.displayOrder || 0) - (b.displayOrder || 0));
}

/**
 * O produto acompanha a categoria dele. Combo tem seção própria e produto sem
 * categoria não tem a quem obedecer — esses dois seguem visíveis.
 */
export function isItemInVisibleCategory(item: any, visibleCategoryIds: Set<string>) {
  if (item?.isCombo) return true;
  if (!item?.categoryId) return true;
  return visibleCategoryIds.has(item.categoryId);
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

/**
 * Por que este produto não aparece no cardápio online.
 *
 * A aba Produtos só mostra os dois botões (Delivery/Local), e o dono conclui
 * que "verde = está no ar". Não está: categoria desligada e estoque zerado
 * escondem o produto sem tocar em botão nenhum, e é isso que as lojas relatam
 * como "liga e desliga sozinho" — some ao vender o último e volta quando um
 * pedido é cancelado. A lista precisa dizer o motivo real.
 *
 * `esgotado` chega pronto de fora (lib/inventory) de propósito: a regra de
 * estoque é uma só e não pode ser reimplementada aqui.
 */
export type MotivoOculto = 'categoria_desligada' | 'desligado' | 'sem_delivery' | 'esgotado';

export const MOTIVO_OCULTO_LABEL: Record<MotivoOculto, string> = {
  categoria_desligada: 'a categoria está desligada',
  desligado: 'está desligado',
  sem_delivery: 'o Delivery está desligado (só sai no PDV)',
  esgotado: 'o estoque está zerado',
};

export function getMotivosOcultoNoCardapio(
  item: any,
  opts: { category?: any; esgotado?: boolean } = {},
): MotivoOculto[] {
  const motivos: MotivoOculto[] = [];

  // Mesmas duas exceções de isItemInVisibleCategory: combo tem seção própria e
  // produto sem categoria não tem a quem obedecer.
  if (!item?.isCombo && item?.categoryId && opts.category && !isCategoryOn(opts.category)) {
    motivos.push('categoria_desligada');
  }

  // isAvailable === false entra junto para o caso legado em que ele ficou
  // dessincronizado dos canais: quem manda no cardápio é ele.
  if (item?.isAvailable === false || !hasAnyVisibleToggle(item)) motivos.push('desligado');
  else if (!isItemVisibleInChannel(item, 'delivery')) motivos.push('sem_delivery');

  if (opts.esgotado) motivos.push('esgotado');

  return motivos;
}

/**
 * O dono olha a linha, vê botão verde e conclui que está no ar — mas não está.
 * É esse recorte que merece aviso na lista; item com os dois botões cinza já se
 * explica sozinho.
 */
export function pareceLigadoMasNaoAparece(motivos: MotivoOculto[]) {
  return motivos.length > 0 && !motivos.includes('desligado');
}

/**
 * O outro lado do "sumiu sozinho": produto DESLIGADO com estoque esperando.
 *
 * A loja opera o mesmo produto por dois caminhos que não se falam — o controle
 * de estoque (que já esgota e trava sozinho) e o botão Delivery/Local (manual).
 * Quando acaba, a dona faz os dois; quando repõe, a entrada devolve o estoque
 * mas ninguém volta no botão, e a mercadoria fica invisível. Medido no Gostinho
 * de Céu em 21/08/2026: 15 produtos, 58 unidades, R$ 461,50 que ninguém
 * conseguia comprar — um deles desligado desde 21/07.
 *
 * `estoque` vem pronto de fora (lib/inventory) porque a regra de estoque é uma
 * só e não pode ser reimplementada aqui.
 */
export function isEstoqueParado(item: any, opts: { estoque?: number | null; category?: any } = {}) {
  if (typeof opts.estoque !== 'number' || opts.estoque <= 0) return false;
  // Já está no ar: não é mercadoria presa.
  if (item?.isAvailable !== false && hasAnyVisibleToggle(item)) return false;
  // Categoria desligada é linha aposentada de propósito, não esquecimento — o
  // aviso ali seria ruído em cima de uma decisão que a dona já tomou.
  if (!item?.isCombo && item?.categoryId && opts.category && !isCategoryOn(opts.category)) return false;
  return true;
}

/**
 * Religar o produto em todos os canais, na mesma regra do botão da aba
 * Produtos. Existe para que a aba Estoque não precise conhecer os nomes dos
 * campos de visibilidade — eles continuam morando só aqui.
 */
export function getLigarTudoUpdate() {
  const fields = MENU_VISIBILITY_CHANNELS.reduce<Partial<Record<VisibilityField, boolean>>>((acc, channel) => {
    acc[channel.field] = true;
    return acc;
  }, {});
  return { ...fields, isAvailable: true };
}
