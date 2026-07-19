/**
 * Contrato central das permissões de interface do PDV.
 *
 * As permissões são deliberadamente permissivas por padrão para manter a
 * compatibilidade com perfis criados antes deste contrato. Somente o booleano
 * literal `false`, com `enabled: true`, revoga uma capacidade conhecida.
 */

export const PDV_TAB_IDS = [
  'caixa',
  'delivery',
  'novo_pedido',
  'mesas',
  'encomendas_pedidos',
] as const;

export type PdvTabId = (typeof PDV_TAB_IDS)[number];

export const PDV_PERMISSION_PATHS = [
  'tabs.caixa',
  'tabs.delivery',
  'tabs.novo_pedido',
  'tabs.mesas',
  'tabs.encomendas_pedidos',
  'actions.caixa.abrirCaixa',
  'actions.caixa.fecharCaixa',
  'actions.caixa.suprimento',
  'actions.caixa.sangria',
  'actions.caixa.cancelarVenda',
  'actions.caixa.verCaixasAnteriores',
  'actions.delivery.finalizarPedido',
  'actions.delivery.mudarStatus',
  'actions.delivery.editarItens',
  'actions.delivery.cancelarPedido',
  'actions.delivery.descontoAcrescimo',
  'actions.delivery.imprimirCupom',
  'actions.novo_pedido.finalizarVenda',
  'actions.novo_pedido.descontoAcrescimo',
  'actions.novo_pedido.vendaPrazo',
  'actions.mesas.gerenciarMesa',
  'actions.mesas.lancarItens',
  'actions.mesas.fecharComanda',
  'actions.mesas.aceitarPedidoOnline',
  'actions.mesas.descontoAcrescimo',
  'actions.mesas.vendaPrazo',
  'actions.encomendas_pedidos.mudarStatus',
  'actions.encomendas_pedidos.editarEncomenda',
  'actions.encomendas_pedidos.lancarSinal',
  'actions.encomendas_pedidos.reimprimir',
  'global.botaoRetaguarda',
  'global.toggleDelivery',
] as const;

export type PdvPermissionPath = (typeof PDV_PERMISSION_PATHS)[number];

/**
 * Os index signatures preservam campos adicionados por clientes mais novos.
 * Campos conhecidos, porém, sempre são normalizados para booleanos.
 */
export interface PdvTabPermissions {
  caixa: boolean;
  delivery: boolean;
  novo_pedido: boolean;
  mesas: boolean;
  encomendas_pedidos: boolean;
  [futureTab: string]: unknown;
}

export interface PdvCaixaPermissions {
  abrirCaixa: boolean;
  fecharCaixa: boolean;
  suprimento: boolean;
  sangria: boolean;
  cancelarVenda: boolean;
  verCaixasAnteriores: boolean;
  [futureAction: string]: unknown;
}

export interface PdvDeliveryPermissions {
  finalizarPedido: boolean;
  mudarStatus: boolean;
  editarItens: boolean;
  cancelarPedido: boolean;
  descontoAcrescimo: boolean;
  imprimirCupom: boolean;
  [futureAction: string]: unknown;
}

export interface PdvNovoPedidoPermissions {
  finalizarVenda: boolean;
  descontoAcrescimo: boolean;
  vendaPrazo: boolean;
  [futureAction: string]: unknown;
}

export interface PdvMesasPermissions {
  gerenciarMesa: boolean;
  lancarItens: boolean;
  fecharComanda: boolean;
  aceitarPedidoOnline: boolean;
  descontoAcrescimo: boolean;
  vendaPrazo: boolean;
  [futureAction: string]: unknown;
}

export interface PdvEncomendasPermissions {
  mudarStatus: boolean;
  editarEncomenda: boolean;
  lancarSinal: boolean;
  reimprimir: boolean;
  [futureAction: string]: unknown;
}

export interface PdvActionPermissions {
  caixa: PdvCaixaPermissions;
  delivery: PdvDeliveryPermissions;
  novo_pedido: PdvNovoPedidoPermissions;
  mesas: PdvMesasPermissions;
  encomendas_pedidos: PdvEncomendasPermissions;
  [futureGroup: string]: unknown;
}

export interface PdvGlobalPermissions {
  botaoRetaguarda: boolean;
  toggleDelivery: boolean;
  [futureControl: string]: unknown;
}

export interface PdvPermissions {
  enabled: boolean;
  tabs: PdvTabPermissions;
  actions: PdvActionPermissions;
  global: PdvGlobalPermissions;
  /** Metadados e campos futuros são mantidos sem interpretação pelo helper. */
  [futureField: string]: unknown;
}

const DEFAULT_TABS = {
  caixa: true,
  delivery: true,
  novo_pedido: true,
  mesas: true,
  encomendas_pedidos: true,
} as const;

const DEFAULT_CAIXA_ACTIONS = {
  abrirCaixa: true,
  fecharCaixa: true,
  suprimento: true,
  sangria: true,
  cancelarVenda: true,
  verCaixasAnteriores: true,
} as const;

const DEFAULT_DELIVERY_ACTIONS = {
  finalizarPedido: true,
  mudarStatus: true,
  editarItens: true,
  cancelarPedido: true,
  descontoAcrescimo: true,
  imprimirCupom: true,
} as const;

const DEFAULT_NOVO_PEDIDO_ACTIONS = {
  finalizarVenda: true,
  descontoAcrescimo: true,
  vendaPrazo: true,
} as const;

const DEFAULT_MESAS_ACTIONS = {
  gerenciarMesa: true,
  lancarItens: true,
  fecharComanda: true,
  aceitarPedidoOnline: true,
  descontoAcrescimo: true,
  vendaPrazo: true,
} as const;

const DEFAULT_ENCOMENDAS_ACTIONS = {
  mudarStatus: true,
  editarEncomenda: true,
  lancarSinal: true,
  reimprimir: true,
} as const;

const DEFAULT_GLOBAL = {
  botaoRetaguarda: true,
  toggleDelivery: true,
} as const;

export const DEFAULT_PDV_PERMISSIONS: PdvPermissions = {
  enabled: false,
  tabs: { ...DEFAULT_TABS },
  actions: {
    caixa: { ...DEFAULT_CAIXA_ACTIONS },
    delivery: { ...DEFAULT_DELIVERY_ACTIONS },
    novo_pedido: { ...DEFAULT_NOVO_PEDIDO_ACTIONS },
    mesas: { ...DEFAULT_MESAS_ACTIONS },
    encomendas_pedidos: { ...DEFAULT_ENCOMENDAS_ACTIONS },
  },
  global: { ...DEFAULT_GLOBAL },
};

const KNOWN_PERMISSION_PATHS = new Set<string>(PDV_PERMISSION_PATHS);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function recordOrEmpty(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function normalizeBooleanBranch<T extends Record<string, boolean>>(
  value: unknown,
  defaults: T,
): T & Record<string, unknown> {
  const source = recordOrEmpty(value);
  const normalized: Record<string, unknown> = { ...source };

  for (const key of Object.keys(defaults)) {
    normalized[key] = typeof source[key] === 'boolean' ? source[key] : defaults[key];
  }

  return normalized as T & Record<string, unknown>;
}

function permissionValue(perms: PdvPermissions, path: string): unknown {
  let current: unknown = perms;

  for (const segment of path.split('.')) {
    if (!isRecord(current)) return undefined;
    current = current[segment];
  }

  return current;
}

function allowAllKnownPermissions(perms: PdvPermissions): void {
  for (const path of PDV_PERMISSION_PATHS) {
    const segments = path.split('.');
    const leaf = segments.pop();
    let current: Record<string, unknown> = perms;

    for (const segment of segments) {
      current = current[segment] as Record<string, unknown>;
    }

    current[leaf!] = true;
  }
}

/**
 * Normaliza o campo `pdvPermissions` de um perfil da loja.
 *
 * - `enabled` ausente ou inválido vira `false` (kill switch desligado);
 * - toda permissão conhecida ausente ou inválida vira `true`;
 * - o booleano explícito `false` é preservado;
 * - campos desconhecidos são mantidos para compatibilidade futura;
 * - `ownerMode` libera todas as capacidades conhecidas neste único ponto.
 */
export function getPdvPermissions(storeProfile: unknown, ownerMode = false): PdvPermissions {
  const profile = recordOrEmpty(storeProfile);
  const stored = recordOrEmpty(profile.pdvPermissions);
  const storedActions = recordOrEmpty(stored.actions);

  const normalized: PdvPermissions = {
    ...stored,
    enabled: typeof stored.enabled === 'boolean' ? stored.enabled : false,
    tabs: normalizeBooleanBranch(stored.tabs, DEFAULT_TABS),
    actions: {
      ...storedActions,
      caixa: normalizeBooleanBranch(storedActions.caixa, DEFAULT_CAIXA_ACTIONS),
      delivery: normalizeBooleanBranch(storedActions.delivery, DEFAULT_DELIVERY_ACTIONS),
      novo_pedido: normalizeBooleanBranch(storedActions.novo_pedido, DEFAULT_NOVO_PEDIDO_ACTIONS),
      mesas: normalizeBooleanBranch(storedActions.mesas, DEFAULT_MESAS_ACTIONS),
      encomendas_pedidos: normalizeBooleanBranch(
        storedActions.encomendas_pedidos,
        DEFAULT_ENCOMENDAS_ACTIONS,
      ),
    },
    global: normalizeBooleanBranch(stored.global, DEFAULT_GLOBAL),
  };

  if (ownerMode) allowAllKnownPermissions(normalized);

  return normalized;
}

/**
 * Decide uma capacidade. Chamadores nunca precisam conhecer o kill switch nem
 * o Modo Dono: o primeiro é aplicado aqui e o segundo em getPdvPermissions().
 */
export function can(perms: PdvPermissions, path: PdvPermissionPath): boolean {
  if (!KNOWN_PERMISSION_PATHS.has(path)) return false;
  if (perms.enabled === false) return true;
  if (perms.enabled !== true) return false;
  return permissionValue(perms, path) === true;
}

export type PdvTheme = string | { id?: string | null } | null | undefined;

function getThemeId(theme: PdvTheme): string | undefined {
  return typeof theme === 'string' ? theme : theme?.id ?? undefined;
}

/** Retorna as abas visíveis na ordem canônica do PDV e aplicáveis ao tema. */
export function getEligibleTabs(perms: PdvPermissions, theme: PdvTheme): PdvTabId[] {
  const themeId = getThemeId(theme);

  return PDV_TAB_IDS.filter((tab) => {
    if (tab === 'encomendas_pedidos' && themeId !== 'confeitaria') return false;
    return can(perms, `tabs.${tab}` as PdvPermissionPath);
  });
}

/**
 * Fallback compartilhado por aba inicial, revogação em tempo real e histórico.
 * Mantém Delivery como padrão retrocompatível; depois tenta a aba anterior.
 */
export function getPdvFallbackTab(
  eligibleTabs: readonly PdvTabId[],
  previouslyActiveTab?: PdvTabId | null,
): PdvTabId | null {
  if (eligibleTabs.includes('delivery')) return 'delivery';
  if (previouslyActiveTab && eligibleTabs.includes(previouslyActiveTab)) {
    return previouslyActiveTab;
  }
  return eligibleTabs[0] ?? null;
}

/** `undefined` é o único estado ainda não resolvido pelo primeiro snapshot. */
export function arePermissionsResolved(storeProfile: unknown): boolean {
  return storeProfile !== undefined;
}
