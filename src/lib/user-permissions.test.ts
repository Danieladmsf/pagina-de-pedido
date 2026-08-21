import { describe, expect, it } from 'vitest';

import { can } from '@/lib/pdv-permissions';
import {
  canAccessRetaguarda,
  canAccessRetaguardaTab,
  canEditRetaguarda,
  canEditRetaguardaTab,
  createEmptyOperatorPermissions,
  getRetaguardaPermissionForTab,
  hasAnyRetaguardaAccess,
  normalizeOperatorPermissions,
  RETAGUARDA_PERMISSION_KEYS,
} from '@/lib/user-permissions';

describe('permissões de operador', () => {
  it('falha fechado quando o perfil está ausente ou parcial', () => {
    const empty = normalizeOperatorPermissions(undefined);
    const partial = normalizeOperatorPermissions({
      pdv: { tabs: { delivery: true } },
    });

    expect(can(empty.pdv, 'tabs.delivery')).toBe(false);
    expect(can(partial.pdv, 'tabs.delivery')).toBe(true);
    expect(can(partial.pdv, 'actions.delivery.finalizarPedido')).toBe(false);
    expect(partial.retaguarda.produtos).toEqual({ ver: false, editar: false });
  });

  it('nenhum módulo fica reservado ao dono por decisão do código', () => {
    const permissions = normalizeOperatorPermissions({
      pdv: {
        actions: {
          caixa: { verCaixasAnteriores: true },
          novo_pedido: { vendaPrazo: true },
        },
      },
      retaguarda: {
        dashboard: { ver: true },
        clientes: { ver: true, editar: true },
        campanhas: { ver: true, editar: true },
        usuarios: { ver: true, editar: true },
      },
    });

    expect(can(permissions.pdv, 'actions.caixa.verCaixasAnteriores')).toBe(true);
    expect(can(permissions.pdv, 'actions.novo_pedido.vendaPrazo')).toBe(true);
    expect(canAccessRetaguarda('operator', permissions.retaguarda, 'dashboard')).toBe(true);
    expect(canEditRetaguarda('operator', permissions.retaguarda, 'clientes')).toBe(true);
    expect(canEditRetaguarda('operator', permissions.retaguarda, 'usuarios')).toBe(true);
  });

  it('separa entrar na tela de mexer no que está nela', () => {
    const permissions = normalizeOperatorPermissions({
      retaguarda: {
        produtos: { ver: true, editar: true },
        categorias: { ver: true },
      },
    });

    expect(canAccessRetaguarda('operator', permissions.retaguarda, 'produtos')).toBe(true);
    expect(canEditRetaguarda('operator', permissions.retaguarda, 'produtos')).toBe(true);
    expect(canAccessRetaguarda('operator', permissions.retaguarda, 'categorias')).toBe(true);
    expect(canEditRetaguarda('operator', permissions.retaguarda, 'categorias')).toBe(false);
  });

  it('editar sem ver não existe, nem em tela que só mostra números', () => {
    const permissions = normalizeOperatorPermissions({
      retaguarda: {
        clientes: { ver: false, editar: true },
        dashboard: { ver: true, editar: true },
        relatorios: { ver: true, editar: true },
        visitantes: { ver: true, editar: true },
      },
    });

    expect(permissions.retaguarda.clientes).toEqual({ ver: false, editar: false });
    expect(permissions.retaguarda.dashboard).toEqual({ ver: true, editar: false });
    expect(permissions.retaguarda.relatorios.editar).toBe(false);
    expect(canEditRetaguarda('operator', permissions.retaguarda, 'visitantes')).toBe(false);
  });

  it('aceita o booleano dos primeiros perfis como somente consulta', () => {
    const permissions = normalizeOperatorPermissions({
      retaguarda: { produtos: true, categorias: true, dashboard: false },
    });

    expect(permissions.retaguarda.produtos).toEqual({ ver: true, editar: false });
    expect(permissions.retaguarda.categorias.ver).toBe(true);
    expect(permissions.retaguarda.dashboard.ver).toBe(false);
  });

  it('o dono passa por tudo sem consultar o perfil', () => {
    const vazio = createEmptyOperatorPermissions();

    for (const key of RETAGUARDA_PERMISSION_KEYS) {
      expect(canAccessRetaguarda('owner', vazio.retaguarda, key)).toBe(true);
      expect(canEditRetaguarda('owner', vazio.retaguarda, key)).toBe(true);
    }
    expect(hasAnyRetaguardaAccess('owner', vazio.retaguarda)).toBe(true);
    expect(hasAnyRetaguardaAccess('operator', vazio.retaguarda)).toBe(false);
    expect(vazio.pdv.enabled).toBe(true);
  });

  it('mapeia os IDs históricos da Gestão para as chaves persistidas', () => {
    expect(getRetaguardaPermissionForTab('addons')).toBe('adicionais');
    expect(getRetaguardaPermissionForTab('promocoes')).toBe('ofertas');
    expect(getRetaguardaPermissionForTab('freelance')).toBe('entregas');
    expect(getRetaguardaPermissionForTab('perfil_motoboys')).toBe('entregas');
    expect(getRetaguardaPermissionForTab('perfil_aparencia')).toBe('perfil');
    expect(getRetaguardaPermissionForTab('perfil_horarios')).toBe('perfil');
    expect(getRetaguardaPermissionForTab('permissoes_pdv')).toBe('usuarios');
    expect(getRetaguardaPermissionForTab('inexistente')).toBeNull();
  });

  it('Relatórios e Estoque têm chave própria, e não a do vizinho', () => {
    const permissions = normalizeOperatorPermissions({
      retaguarda: { dashboard: { ver: true }, produtos: { ver: true } },
    });

    expect(getRetaguardaPermissionForTab('relatorios')).toBe('relatorios');
    expect(getRetaguardaPermissionForTab('estoque')).toBe('estoque');
    expect(canAccessRetaguardaTab('operator', permissions.retaguarda, 'dashboard')).toBe(true);
    expect(canAccessRetaguardaTab('operator', permissions.retaguarda, 'relatorios')).toBe(false);
    expect(canAccessRetaguardaTab('operator', permissions.retaguarda, 'estoque')).toBe(false);
    expect(canAccessRetaguardaTab('owner', permissions.retaguarda, 'estoque')).toBe(true);
  });

  it('a aba respeita as duas decisões do módulo', () => {
    const permissions = normalizeOperatorPermissions({
      retaguarda: { produtos: { ver: true, editar: true }, ofertas: { ver: true } },
    });

    expect(canEditRetaguardaTab('operator', permissions.retaguarda, 'produtos')).toBe(true);
    expect(canEditRetaguardaTab('operator', permissions.retaguarda, 'promocoes')).toBe(false);
    expect(canEditRetaguardaTab('operator', permissions.retaguarda, 'inexistente')).toBe(false);
  });
});
