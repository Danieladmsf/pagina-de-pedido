import { describe, expect, it } from 'vitest';
import { wapiAfirmaDesconectado } from './wapi.service';

describe('wapiAfirmaDesconectado', () => {
  it('reconhece a resposta real de uma instância desconectada', () => {
    // GET /instance/status-instance da Gostinho em 22/09/2026, 21:28 BRT,
    // depois do Desconectar: o número tinha saído da W-API.
    expect(wapiAfirmaDesconectado({ connected: false, instanceId: 'LITE-8NDQT1-UWX43P' })).toBe(true);
  });

  it('conectada não é desconectada', () => {
    expect(wapiAfirmaDesconectado({ connected: true, instanceId: 'LITE-8NDQT1-UWX43P' })).toBe(false);
  });

  it('telefone na resposta é prova de vida, mesmo com connected:false', () => {
    expect(wapiAfirmaDesconectado({ connected: false, connectedPhone: '5516993638485' })).toBe(false);
  });

  it('formato desconhecido ou vazio não derruba ninguém', () => {
    expect(wapiAfirmaDesconectado({ instanceId: 'LITE-8NDQT1-UWX43P' })).toBe(false);
    expect(wapiAfirmaDesconectado({})).toBe(false);
    expect(wapiAfirmaDesconectado(null)).toBe(false);
  });
});
