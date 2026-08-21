import { can, PDV_PERMISSION_PATHS, type PdvPermissions } from '@/lib/pdv-permissions';

/**
 * O que o dono liga e desliga para cada funcionário na Retaguarda.
 *
 * Uma chave por tela de verdade — a lista abaixo espelha o menu lateral, item a
 * item. Nada fica reservado ao dono por decisão do código: se um módulo aparece
 * aqui, o dono escolhe na tela de Usuários se aquele funcionário entra nele.
 *
 * Cada módulo guarda duas decisões separadas: `ver` (abre a tela) e `editar`
 * (mexe no que está lá). `editar` sem `ver` não existe — a normalização derruba.
 */
export const RETAGUARDA_PERMISSION_KEYS = [
  // Números do negócio
  'dashboard',
  'relatorios',
  'visitantes',
  // Cardápio
  'produtos',
  'estoque',
  'categorias',
  'adicionais',
  'ofertas',
  // Pessoas
  'clientes',
  'prazo',
  // Marketing
  'whatsapp',
  'campanhas',
  // Operação
  'encomendas',
  'entregas',
  // Configurações da loja
  //
  // Uma chave só, e não uma por sub-aba, porque o perfil inteiro mora em UM
  // documento gravado de uma vez: separar "horários" de "taxas" seria promessa
  // que o servidor não teria como cumprir na hora de salvar.
  'perfil',
  'usuarios',
] as const;

export type RetaguardaPermissionKey = (typeof RETAGUARDA_PERMISSION_KEYS)[number];

export interface RetaguardaModulePermission {
  ver: boolean;
  editar: boolean;
}

export type RetaguardaPermissions = Record<RetaguardaPermissionKey, RetaguardaModulePermission>;

/**
 * Telas que só mostram o que aconteceu: não existe "alterar" nelas, então a
 * tela de permissões nem oferece o segundo interruptor.
 */
export const RETAGUARDA_SOMENTE_LEITURA = new Set<RetaguardaPermissionKey>([
  'dashboard',
  'relatorios',
  'visitantes',
]);

export interface OperatorPermissions {
  pdv: PdvPermissions;
  retaguarda: RetaguardaPermissions;
}

export interface OperatorRoleDocument {
  ownerId: string;
  active: boolean;
  name: string;
  email?: string;
  login?: string;
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

const MODULO_BLOQUEADO: RetaguardaModulePermission = { ver: false, editar: false };

export const EMPTY_OPERATOR_RETAGUARDA_PERMISSIONS: RetaguardaPermissions =
  Object.freeze(
    Object.fromEntries(
      RETAGUARDA_PERMISSION_KEYS.map((key) => [key, { ...MODULO_BLOQUEADO }]),
    ) as RetaguardaPermissions,
  );

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
        verCaixasAnteriores: explicitlyAllowed(caixa.verCaixasAnteriores),
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
        vendaPrazo: explicitlyAllowed(novoPedido.vendaPrazo),
      },
      mesas: {
        gerenciarMesa: explicitlyAllowed(mesas.gerenciarMesa),
        lancarItens: explicitlyAllowed(mesas.lancarItens),
        fecharComanda: explicitlyAllowed(mesas.fecharComanda),
        aceitarPedidoOnline: explicitlyAllowed(mesas.aceitarPedidoOnline),
        descontoAcrescimo: explicitlyAllowed(mesas.descontoAcrescimo),
        vendaPrazo: explicitlyAllowed(mesas.vendaPrazo),
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

/**
 * Aceita o formato atual (`{ ver, editar }`) e o booleano dos primeiros perfis,
 * quando um módulo liberado significava apenas consulta.
 */
function normalizeModulo(value: unknown, key: RetaguardaPermissionKey): RetaguardaModulePermission {
  if (value === true) return { ver: true, editar: false };
  if (!isRecord(value)) return { ...MODULO_BLOQUEADO };

  const ver = explicitlyAllowed(value.ver);
  const editar = ver
    && !RETAGUARDA_SOMENTE_LEITURA.has(key)
    && explicitlyAllowed(value.editar);
  return { ver, editar };
}

export function normalizeRetaguardaPermissions(value: unknown): RetaguardaPermissions {
  const source = isRecord(value) ? value : {};
  return Object.fromEntries(
    RETAGUARDA_PERMISSION_KEYS.map((key) => [key, normalizeModulo(source[key], key)]),
  ) as RetaguardaPermissions;
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
    retaguarda: normalizeRetaguardaPermissions({}),
  };
}

/** O dono vê tudo; o funcionário, o que estiver marcado no perfil dele. */
export function canAccessRetaguarda(
  role: 'owner' | 'operator',
  permissions: RetaguardaPermissions,
  key: RetaguardaPermissionKey,
): boolean {
  if (role === 'owner') return true;
  return permissions[key]?.ver === true;
}

/** Alterar é uma segunda decisão: entrar na tela não dá direito de mexer. */
export function canEditRetaguarda(
  role: 'owner' | 'operator',
  permissions: RetaguardaPermissions,
  key: RetaguardaPermissionKey,
): boolean {
  if (role === 'owner') return true;
  if (RETAGUARDA_SOMENTE_LEITURA.has(key)) return false;
  const modulo = permissions[key];
  return modulo?.ver === true && modulo.editar === true;
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
  const byTabId: Record<string, RetaguardaPermissionKey> = {
    dashboard: 'dashboard',
    relatorios: 'relatorios',
    visitantes: 'visitantes',
    produtos: 'produtos',
    estoque: 'estoque',
    categorias: 'categorias',
    addons: 'adicionais',
    clientes: 'clientes',
    prazo: 'prazo',
    promocoes: 'ofertas',
    whatsapp: 'whatsapp',
    campanhas: 'campanhas',
    encomendas: 'encomendas',
    freelance: 'entregas',
    // A aba de motoboys virou parte de Entregas em 02/08/2026; quem voltar pelo
    // histórico do navegador cai na mesma permissão.
    perfil_motoboys: 'entregas',
    perfil_geral: 'perfil',
    perfil_taxas: 'perfil',
    perfil_horarios: 'perfil',
    perfil_pagamentos: 'perfil',
    perfil_impressora: 'perfil',
    perfil_aparencia: 'perfil',
    usuarios: 'usuarios',
    // A tela de Permissões do PDV foi absorvida por Usuários e acesso.
    permissoes_pdv: 'usuarios',
  };

  return byTabId[tabId] ?? null;
}

export function canAccessRetaguardaTab(
  role: 'owner' | 'operator',
  permissions: RetaguardaPermissions,
  tabId: string,
): boolean {
  const permission = getRetaguardaPermissionForTab(tabId);
  return !!permission && canAccessRetaguarda(role, permissions, permission);
}

/**
 * Um gestor delegado nunca entrega mais do que tem.
 *
 * Quando o dono liga o módulo Usuários para um funcionário, esse funcionário
 * passa a criar e editar colegas. A trava aqui é a regra clássica de não
 * escalada: cada capacidade marcada para o outro precisa existir no perfil de
 * quem está concedendo. Sem isso, bastaria criar um colega com tudo ligado e
 * entrar com ele.
 */
export function excedePermissoes(
  pedidas: OperatorPermissions,
  doGestor: OperatorPermissions,
): boolean {
  for (const path of PDV_PERMISSION_PATHS) {
    if (can(pedidas.pdv, path) && !can(doGestor.pdv, path)) return true;
  }
  for (const key of RETAGUARDA_PERMISSION_KEYS) {
    const pedida = pedidas.retaguarda[key];
    const gestor = doGestor.retaguarda[key];
    if (pedida.ver && !gestor.ver) return true;
    if (pedida.editar && !gestor.editar) return true;
  }
  return false;
}

export function canEditRetaguardaTab(
  role: 'owner' | 'operator',
  permissions: RetaguardaPermissions,
  tabId: string,
): boolean {
  const permission = getRetaguardaPermissionForTab(tabId);
  return !!permission && canEditRetaguarda(role, permissions, permission);
}
