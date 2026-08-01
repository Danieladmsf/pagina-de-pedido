import { describe, expect, it } from 'vitest';

import { can } from '@/lib/pdv-permissions';
import {
  canAccessRetaguarda,
  createEmptyOperatorPermissions,
  getRetaguardaPermissionForTab,
  normalizeOperatorPermissions,
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
    expect(partial.retaguarda.produtos).toBe(false);
  });

  it('não aceita autopromoção para capacidades exclusivas do master', () => {
    const permissions = normalizeOperatorPermissions({
      pdv: { actions: { caixa: { verCaixasAnteriores: true } } },
      retaguarda: {
        dashboard: true,
        clientes: true,
        campanhas: true,
        perfil: true,
        permissoes: true,
        usuarios: true,
      },
    });

    expect(can(permissions.pdv, 'actions.caixa.verCaixasAnteriores')).toBe(false);
    expect(permissions.retaguarda.dashboard).toBe(false);
    expect(permissions.retaguarda.clientes).toBe(false);
    expect(permissions.retaguarda.campanhas).toBe(false);
    expect(permissions.retaguarda.perfil).toBe(false);
    expect(permissions.retaguarda.permissoes).toBe(false);
    expect(permissions.retaguarda.usuarios).toBe(false);
  });

  it('libera somente os módulos de catálogo configurados como leitura', () => {
    const permissions = normalizeOperatorPermissions({
      retaguarda: {
        produtos: true,
        categorias: true,
        adicionais: true,
        ofertas: true,
      },
    });

    expect(canAccessRetaguarda('operator', permissions.retaguarda, 'produtos')).toBe(true);
    expect(canAccessRetaguarda('operator', permissions.retaguarda, 'ofertas')).toBe(true);
    expect(canAccessRetaguarda('operator', permissions.retaguarda, 'dashboard')).toBe(false);
    expect(canAccessRetaguarda('owner', permissions.retaguarda, 'dashboard')).toBe(true);
  });

  it('mapeia os IDs históricos da Gestão para as chaves persistidas', () => {
    expect(getRetaguardaPermissionForTab('addons')).toBe('adicionais');
    expect(getRetaguardaPermissionForTab('promocoes')).toBe('ofertas');
    expect(getRetaguardaPermissionForTab('perfil_aparencia')).toBe('perfil');
    expect(getRetaguardaPermissionForTab('inexistente')).toBeNull();
    expect(createEmptyOperatorPermissions().pdv.enabled).toBe(true);
  });
});
