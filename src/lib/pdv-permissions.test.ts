import { describe, expect, it } from 'vitest';

import {
  DEFAULT_PDV_PERMISSIONS,
  PDV_PERMISSION_PATHS,
  PDV_TAB_IDS,
  arePermissionsResolved,
  can,
  getEligibleTabs,
  getPdvFallbackTab,
  getPdvPermissions,
  type PdvPermissionPath,
} from './pdv-permissions';

describe('getPdvPermissions', () => {
  it('mantém o contrato retrocompatível quando o perfil ou campo não existe', () => {
    for (const profile of [undefined, null, {}]) {
      const perms = getPdvPermissions(profile);

      expect(perms).toEqual(DEFAULT_PDV_PERMISSIONS);
      expect(PDV_PERMISSION_PATHS.every((path) => can(perms, path))).toBe(true);
    }
  });

  it('preenche campos parciais com true sem perder false explícito', () => {
    const perms = getPdvPermissions({
      pdvPermissions: {
        enabled: true,
        tabs: { caixa: false },
        actions: {
          caixa: { sangria: false },
          delivery: { mudarStatus: false },
        },
        global: { toggleDelivery: false },
      },
    });

    expect(perms.tabs.caixa).toBe(false);
    expect(perms.tabs.delivery).toBe(true);
    expect(perms.actions.caixa.sangria).toBe(false);
    expect(perms.actions.caixa.suprimento).toBe(true);
    expect(perms.actions.delivery.mudarStatus).toBe(false);
    expect(perms.actions.delivery.editarItens).toBe(true);
    expect(perms.global.toggleDelivery).toBe(false);
    expect(perms.global.botaoRetaguarda).toBe(true);

    expect(can(perms, 'tabs.caixa')).toBe(false);
    expect(can(perms, 'actions.caixa.sangria')).toBe(false);
    expect(can(perms, 'actions.caixa.suprimento')).toBe(true);
  });

  it('ignora restrições salvas enquanto o kill switch está desligado', () => {
    const perms = getPdvPermissions({
      pdvPermissions: {
        enabled: false,
        tabs: { caixa: false },
        actions: { caixa: { sangria: false } },
        global: { toggleDelivery: false },
      },
    });

    expect(perms.tabs.caixa).toBe(false);
    expect(perms.actions.caixa.sangria).toBe(false);
    expect(can(perms, 'tabs.caixa')).toBe(true);
    expect(can(perms, 'actions.caixa.sangria')).toBe(true);
    expect(can(perms, 'global.toggleDelivery')).toBe(true);
  });

  it('normaliza tipos inválidos com defaults seguros e permissivos', () => {
    const perms = getPdvPermissions({
      pdvPermissions: {
        enabled: 'true',
        tabs: {
          caixa: 'false',
          delivery: 0,
          novo_pedido: null,
          mesas: false,
        },
        actions: {
          caixa: { sangria: 'não', suprimento: false },
          delivery: false,
        },
        global: ['inválido'],
      },
    });

    expect(perms.enabled).toBe(false);
    expect(perms.tabs.caixa).toBe(true);
    expect(perms.tabs.delivery).toBe(true);
    expect(perms.tabs.novo_pedido).toBe(true);
    expect(perms.tabs.mesas).toBe(false);
    expect(perms.actions.caixa.sangria).toBe(true);
    expect(perms.actions.caixa.suprimento).toBe(false);
    expect(perms.actions.delivery.finalizarPedido).toBe(true);
    expect(perms.global.toggleDelivery).toBe(true);
  });

  it('preserva campos desconhecidos em todos os níveis para forward compatibility', () => {
    const updatedAt = { seconds: 123 };
    const perms = getPdvPermissions({
      pdvPermissions: {
        enabled: true,
        updatedAt,
        updatedBy: 'owner-1',
        futureRoot: { version: 2 },
        tabs: { caixa: false, future_tab: { visible: false } },
        actions: {
          future_group: { action: false },
          caixa: { sangria: false, futureAction: 'preservada' },
        },
        global: { futureControl: 42 },
      },
    });

    expect(perms.updatedAt).toBe(updatedAt);
    expect(perms.updatedBy).toBe('owner-1');
    expect(perms.futureRoot).toEqual({ version: 2 });
    expect(perms.tabs.future_tab).toEqual({ visible: false });
    expect(perms.actions.future_group).toEqual({ action: false });
    expect(perms.actions.caixa.futureAction).toBe('preservada');
    expect(perms.global.futureControl).toBe(42);
  });

  it('libera somente as folhas conhecidas quando o Modo Dono está ativo', () => {
    const profile = {
      pdvPermissions: {
        enabled: true,
        tabs: Object.fromEntries(PDV_TAB_IDS.map((tab) => [tab, false])),
        actions: { caixa: { sangria: false }, future_group: { blocked: false } },
        global: { botaoRetaguarda: false, futureControl: false },
      },
    };

    const restricted = getPdvPermissions(profile);
    const owner = getPdvPermissions(profile, true);

    expect(can(restricted, 'actions.caixa.sangria')).toBe(false);
    expect(PDV_PERMISSION_PATHS.every((path) => can(owner, path))).toBe(true);
    expect(owner.enabled).toBe(true);
    expect(owner.actions.future_group).toEqual({ blocked: false });
    expect(owner.global.futureControl).toBe(false);
  });
});

describe('can', () => {
  it('só aceita caminhos conhecidos em TypeScript e falha fechado em runtime', () => {
    const perms = getPdvPermissions({ pdvPermissions: { enabled: true } });
    const killSwitchOff = getPdvPermissions({ pdvPermissions: { enabled: false } });
    const validPath: PdvPermissionPath = 'actions.mesas.fecharComanda';

    expect(can(perms, validPath)).toBe(true);
    expect(can(perms, 'actions.mesas.inexistente' as PdvPermissionPath)).toBe(false);
    expect(can(killSwitchOff, 'actions.mesas.inexistente' as PdvPermissionPath)).toBe(false);

    if (false) {
      // @ts-expect-error caminho inexistente deve falhar durante o typecheck
      can(perms, 'actions.mesas.inexistente');
    }
  });
});

describe('getEligibleTabs', () => {
  it('aplica a ordem canônica e restringe Encomendas ao tema confeitaria', () => {
    const perms = getPdvPermissions({});
    const commonThemes = ['padrao', 'marmitaria', 'pizzaria', 'sucaria', 'sorveteria'];

    for (const theme of commonThemes) {
      expect(getEligibleTabs(perms, theme)).toEqual([
        'caixa',
        'delivery',
        'novo_pedido',
        'mesas',
      ]);
    }

    expect(getEligibleTabs(perms, 'confeitaria')).toEqual(PDV_TAB_IDS);
    expect(getEligibleTabs(perms, { id: 'confeitaria' })).toEqual(PDV_TAB_IDS);
  });

  it('pode retornar vazio quando a única aba marcada não se aplica ao tema', () => {
    const perms = getPdvPermissions({
      pdvPermissions: {
        enabled: true,
        tabs: {
          caixa: false,
          delivery: false,
          novo_pedido: false,
          mesas: false,
          encomendas_pedidos: true,
        },
      },
    });

    expect(getEligibleTabs(perms, 'padrao')).toEqual([]);
    expect(getEligibleTabs(perms, 'confeitaria')).toEqual(['encomendas_pedidos']);
  });
});

describe('getPdvFallbackTab', () => {
  it('prioriza Delivery, depois a aba anterior e por fim a primeira elegível', () => {
    expect(getPdvFallbackTab(['caixa', 'delivery'], 'caixa')).toBe('delivery');
    expect(getPdvFallbackTab(['caixa', 'mesas'], 'mesas')).toBe('mesas');
    expect(getPdvFallbackTab(['caixa', 'mesas'], 'delivery')).toBe('caixa');
    expect(getPdvFallbackTab([], 'delivery')).toBeNull();
  });
});

describe('arePermissionsResolved', () => {
  it('distingue loading de qualquer snapshot já resolvido', () => {
    expect(arePermissionsResolved(undefined)).toBe(false);
    expect(arePermissionsResolved(null)).toBe(true);
    expect(arePermissionsResolved({})).toBe(true);
    expect(arePermissionsResolved({ pdvPermissions: undefined })).toBe(true);
  });
});
