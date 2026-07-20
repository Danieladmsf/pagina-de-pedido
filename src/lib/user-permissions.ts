import type { PdvPermissions } from '@/lib/pdv-permissions';

export const RETAGUARDA_PERMISSION_KEYS = [
  'dashboard',
  'produtos',
  'categorias',
  'adicionais',
  'clientes',
  'ofertas',
  'whatsapp',
  'campanhas',
  'encomendas',
  'freelance',
  'perfil',
  'permissoes',
  'usuarios',
] as const;

export type RetaguardaPermissionKey = (typeof RETAGUARDA_PERMISSION_KEYS)[number];

export type RetaguardaPermissions = Record<RetaguardaPermissionKey, boolean>;

export interface OperatorPermissions {
  pdv: PdvPermissions;
  retaguarda: RetaguardaPermissions;
}

export interface OperatorRoleDocument {
  ownerId: string;
  active: boolean;
  name: string;
  email?: string;
  permissions?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
}

const EMPTY_OPERATOR_PDV_PERMISSIONS: PdvPermissions = {
  // Para operador, `enabled` fica sempre ligado. Diferentemente do perfil da
  // loja, ausência/corrupção de uma folha falha fechado em vez de liberar.
  enabled: true,
  tabs: {
    caixa: false,
    delivery: false,
    novo_pedido: false,
    mesas: false,
    encomendas_pedidos: false,
  },
  actions: {
    caixa: {
      abrirCaixa: false,
      fecharCaixa: false,
      suprimento: false,
      sangria: false,
      cancelarVenda: false,
      verCaixasAnteriores: false,
    },
    delivery: {
      finalizarPedido: false,
      mudarStatus: false,
      editarItens: false,
      cancelarPedido: false,
      descontoAcrescimo: false,
      imprimirCupom: false,
    },
    novo_pedido: {
      finalizarVenda: false,
      descontoAcrescimo: false,
      vendaPrazo: false,
    },
    mesas: {
      gerenciarMesa: false,
      lancarItens: false,
      fecharComanda: false,
      aceitarPedidoOnline: false,
      descontoAcrescimo: false,
      vendaPrazo: false,
    },
    encomendas_pedidos: {
      mudarStatus: false,
      editarEncomenda: false,
      lancarSinal: false,
      reimprimir: false,
    },
  },
  global: {
    botaoRetaguarda: false,
    toggleDelivery: false,
  },
};

export const EMPTY_OPERATOR_RETAGUARDA_PERMISSIONS: RetaguardaPermissions = {
  dashboard: false,
  produtos: false,
  categorias: false,
  adicionais: false,
  clientes: false,
  ofertas: false,
  whatsapp: false,
  campanhas: false,
  encomendas: false,
  freelance: false,
  perfil: false,
  permissoes: false,
  usuarios: false,
};

// O modelo atual mistura dados operacionais e sensíveis em algumas telas.
// Até existirem projeções/documentos separados, estes módulos permanecem
// exclusivos do master para não prometer uma proteção que as rules não podem
// oferecer por campo dentro do mesmo documento.
export const OWNER_ONLY_RETAGUARDA_PERMISSIONS = new Set<RetaguardaPermissionKey>([
  'dashboard',
  'clientes',
  'whatsapp',
  'campanhas',
  'encomendas',
  'freelance',
  'perfil',
  'permissoes',
  'usuarios',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function explicitlyAllowed(value: unknown): boolean {
  return value === true;
}

/**
 * Normalização fail-closed para um login de operador.
 *
 * O helper do perfil da loja é permissivo por compatibilidade com lojas
 * antigas; aqui a regra é inversa: apenas `true` literal concede acesso.
 */
export function normalizeOperatorPdvPermissions(value: unknown): PdvPermissions {
  const source = isRecord(value) ? value : {};
  const tabs = isRecord(source.tabs) ? source.tabs : {};
  const actions = isRecord(source.actions) ? source.actions : {};
  const caixa = isRecord(actions.caixa) ? actions.caixa : {};
  const delivery = isRecord(actions.delivery) ? actions.delivery : {};
  const novoPedido = isRecord(actions.novo_pedido) ? actions.novo_pedido : {};
  const mesas = isRecord(actions.mesas) ? actions.mesas : {};
  const encomendas = isRecord(actions.encomendas_pedidos) ? actions.encomendas_pedidos : {};
  const global = isRecord(source.global) ? source.global : {};

  return {
    enabled: true,
    tabs: {
      caixa: explicitlyAllowed(tabs.caixa),
      delivery: explicitlyAllowed(tabs.delivery),
      novo_pedido: explicitlyAllowed(tabs.novo_pedido),
      mesas: explicitlyAllowed(tabs.mesas),
      encomendas_pedidos: explicitlyAllowed(tabs.encomendas_pedidos),
    },
    actions: {
      caixa: {
        abrirCaixa: explicitlyAllowed(caixa.abrirCaixa),
        fecharCaixa: explicitlyAllowed(caixa.fecharCaixa),
        suprimento: explicitlyAllowed(caixa.suprimento),
        sangria: explicitlyAllowed(caixa.sangria),
        cancelarVenda: explicitlyAllowed(caixa.cancelarVenda),
        // Histórico financeiro agregado permanece exclusivo do master nesta
        // fase, mesmo se um documento adulterado tentar habilitar a folha.
        verCaixasAnteriores: false,
      },
      delivery: {
        finalizarPedido: explicitlyAllowed(delivery.finalizarPedido),
        mudarStatus: explicitlyAllowed(delivery.mudarStatus),
        editarItens: explicitlyAllowed(delivery.editarItens),
        cancelarPedido: explicitlyAllowed(delivery.cancelarPedido),
        descontoAcrescimo: explicitlyAllowed(delivery.descontoAcrescimo),
        imprimirCupom: explicitlyAllowed(delivery.imprimirCupom),
      },
      novo_pedido: {
        finalizarVenda: explicitlyAllowed(novoPedido.finalizarVenda),
        descontoAcrescimo: explicitlyAllowed(novoPedido.descontoAcrescimo),
        // Conta da Casa depende hoje de listar a coleção inteira de clientes.
        // Até o lookup virar uma projeção/API mínima, permanece owner-only.
        vendaPrazo: false,
      },
      mesas: {
        gerenciarMesa: explicitlyAllowed(mesas.gerenciarMesa),
        lancarItens: explicitlyAllowed(mesas.lancarItens),
        fecharComanda: explicitlyAllowed(mesas.fecharComanda),
        aceitarPedidoOnline: explicitlyAllowed(mesas.aceitarPedidoOnline),
        descontoAcrescimo: explicitlyAllowed(mesas.descontoAcrescimo),
        vendaPrazo: false,
      },
      encomendas_pedidos: {
        mudarStatus: explicitlyAllowed(encomendas.mudarStatus),
        editarEncomenda: explicitlyAllowed(encomendas.editarEncomenda),
        lancarSinal: explicitlyAllowed(encomendas.lancarSinal),
        reimprimir: explicitlyAllowed(encomendas.reimprimir),
      },
    },
    global: {
      botaoRetaguarda: explicitlyAllowed(global.botaoRetaguarda),
      toggleDelivery: explicitlyAllowed(global.toggleDelivery),
    },
  };
}

export function normalizeRetaguardaPermissions(value: unknown): RetaguardaPermissions {
  const source = isRecord(value) ? value : {};
  const normalized = { ...EMPTY_OPERATOR_RETAGUARDA_PERMISSIONS };

  for (const key of RETAGUARDA_PERMISSION_KEYS) {
    normalized[key] = explicitlyAllowed(source[key]);
  }

  for (const key of OWNER_ONLY_RETAGUARDA_PERMISSIONS) {
    normalized[key] = false;
  }
  return normalized;
}

export function normalizeOperatorPermissions(value: unknown): OperatorPermissions {
  const source = isRecord(value) ? value : {};
  return {
    pdv: normalizeOperatorPdvPermissions(source.pdv),
    retaguarda: normalizeRetaguardaPermissions(source.retaguarda),
  };
}

export function createEmptyOperatorPermissions(): OperatorPermissions {
  return {
    pdv: normalizeOperatorPdvPermissions(EMPTY_OPERATOR_PDV_PERMISSIONS),
    retaguarda: { ...EMPTY_OPERATOR_RETAGUARDA_PERMISSIONS },
  };
}

export function canAccessRetaguarda(
  role: 'owner' | 'operator',
  permissions: RetaguardaPermissions,
  key: RetaguardaPermissionKey,
): boolean {
  if (role === 'owner') return true;
  if (OWNER_ONLY_RETAGUARDA_PERMISSIONS.has(key)) return false;
  return permissions[key] === true;
}

export function hasAnyRetaguardaAccess(
  role: 'owner' | 'operator',
  permissions: RetaguardaPermissions,
): boolean {
  if (role === 'owner') return true;
  return RETAGUARDA_PERMISSION_KEYS.some((key) => canAccessRetaguarda(role, permissions, key));
}

/** Traduz os IDs históricos da página/Sidebar para o contrato persistido. */
export function getRetaguardaPermissionForTab(tabId: string): RetaguardaPermissionKey | null {
  if (tabId.startsWith('perfil_')) return 'perfil';

  const byTabId: Record<string, RetaguardaPermissionKey> = {
    dashboard: 'dashboard',
    produtos: 'produtos',
    categorias: 'categorias',
    addons: 'adicionais',
    clientes: 'clientes',
    promocoes: 'ofertas',
    whatsapp: 'whatsapp',
    campanhas: 'campanhas',
    encomendas: 'encomendas',
    freelance: 'freelance',
    permissoes_pdv: 'permissoes',
    usuarios: 'usuarios',
  };

  return byTabId[tabId] ?? null;
}
