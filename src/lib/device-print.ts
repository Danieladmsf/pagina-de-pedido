'use client';

/**
 * Preferência de impressão automática POR MÁQUINA (não por conta).
 *
 * Fica no localStorage do navegador daquele computador — então o mesmo login
 * aberto em dois PCs pode ter comportamentos diferentes: o PC-caixa imprime
 * automaticamente os pedidos que chegam, e um PC só de monitoramento (sem
 * impressora) pode desligar isso para não abrir o modal do navegador.
 *
 * Default = LIGADO, para preservar o comportamento atual de todas as máquinas
 * que já estão em uso (só fica desligado se o operador desligar explicitamente
 * naquele PC).
 */
const KEY = 'pdv_autoprint_device';

export function isDeviceAutoPrintEnabled(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    return window.localStorage.getItem(KEY) !== '0';
  } catch {
    return true;
  }
}

export function setDeviceAutoPrintEnabled(enabled: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(KEY, enabled ? '1' : '0');
  } catch {
    /* localStorage indisponível: mantém o default (ligado) */
  }
}
