import { describe, expect, it } from 'vitest';

import { createEmptyOperatorPermissions } from '@/lib/user-permissions';
import {
  canOperatorFetchProfilePicture,
  canOperatorSendOperationalMessage,
  normalizeWapiPhone,
  sanitizeOperatorDelegation,
  sanitizeOperationalMessageType,
  sanitizeWapiDocumentId,
} from '@/lib/wapi/operator-access';

describe('WAPI operator access', () => {
  it('sanitizes document IDs and accepts only operational message types', () => {
    expect(sanitizeWapiDocumentId(' owner-1 ')).toBe('owner-1');
    expect(sanitizeWapiDocumentId('../owner')).toBeNull();
    expect(sanitizeWapiDocumentId('with space')).toBeNull();
    expect(sanitizeOperationalMessageType('order_created')).toBe('order_created');
    expect(sanitizeOperationalMessageType('manual_test')).toBeNull();
    expect(sanitizeOperationalMessageType('credit_statement')).toBeNull();
    expect(normalizeWapiPhone('(11) 99999-0000')).toBe('5511999990000');
  });

  it('accepts only an active delegation to the requested owner and normalizes fail-closed', () => {
    expect(sanitizeOperatorDelegation({ active: false, ownerId: 'owner-1' }, 'owner-1')).toBeNull();
    expect(sanitizeOperatorDelegation({ active: true, ownerId: 'owner-2' }, 'owner-1')).toBeNull();

    const permissions = sanitizeOperatorDelegation({
      active: true,
      ownerId: 'owner-1',
      permissions: { pdv: { tabs: { delivery: true } } },
    }, 'owner-1');
    expect(permissions?.pdv.tabs.delivery).toBe(true);
    expect(permissions?.pdv.actions.delivery.mudarStatus).toBe(false);
  });

  it('allows read-only operational notifications from the visible delivery tab', () => {
    const permissions = createEmptyOperatorPermissions();
    permissions.pdv.tabs.delivery = true;

    expect(canOperatorFetchProfilePicture(permissions)).toBe(true);
    expect(canOperatorSendOperationalMessage(permissions, 'order_created', 'delivery')).toBe(true);
    expect(canOperatorSendOperationalMessage(permissions, 'pix_proof_request', 'pickup')).toBe(true);
    expect(canOperatorSendOperationalMessage(permissions, 'order_ready', 'delivery')).toBe(false);
  });

  it('requires the matching status capability and rejects mismatched order types', () => {
    const permissions = createEmptyOperatorPermissions();
    permissions.pdv.tabs.delivery = true;
    permissions.pdv.actions.delivery.mudarStatus = true;

    expect(canOperatorSendOperationalMessage(permissions, 'order_ready', 'delivery')).toBe(true);
    expect(canOperatorSendOperationalMessage(permissions, 'pickup_ready', 'pickup')).toBe(true);
    expect(canOperatorSendOperationalMessage(permissions, 'dine_in_ready', 'delivery')).toBe(false);
  });

  it('accepts mesa operations only with a mesa action', () => {
    const permissions = createEmptyOperatorPermissions();
    permissions.pdv.tabs.mesas = true;

    expect(canOperatorSendOperationalMessage(permissions, 'dine_in_ready', 'dine_in')).toBe(false);
    permissions.pdv.actions.mesas.aceitarPedidoOnline = true;
    expect(canOperatorSendOperationalMessage(permissions, 'dine_in_ready', 'dine_in')).toBe(true);
  });

  it('allows a cancellation notification through the caixa cancellation capability', () => {
    const permissions = createEmptyOperatorPermissions();
    permissions.pdv.tabs.caixa = true;
    permissions.pdv.actions.caixa.cancelarVenda = true;

    expect(canOperatorSendOperationalMessage(permissions, 'order_canceled', 'delivery')).toBe(true);
    expect(canOperatorSendOperationalMessage(permissions, 'order_canceled', 'dine_in')).toBe(true);
    expect(canOperatorFetchProfilePicture(permissions)).toBe(false);
  });
});
