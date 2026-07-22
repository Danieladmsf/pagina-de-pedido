'use client';

/**
 * Alerta sonoro de "pedido novo". Usa Web Audio (não um <audio>) por dois motivos:
 *  - permite amplificar o volume acima de 1.0 (ganho), pra ser ouvido no salão;
 *  - permite tocar em loop e cortar em X ms (modo "automático com som").
 *
 * O contexto e o buffer decodificado ficam em caches globais (window) pra
 * reaproveitar entre telas e SOBREVIVER à troca de rota PDV <-> Retaguarda — é o
 * que deixa o <OrderAlertsWatcher/> tocar em qualquer tela sem recarregar o mp3.
 */

/** Toca o alerta. `volumeMultiplier` amplifica; `stopAfterMs` toca em loop e corta. */
export async function playLoudAudio(volumeMultiplier = 4.0, stopAfterMs?: number): Promise<void> {
  try {
    if (typeof window === 'undefined') return;
    const AudioCtx = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) return;
    if (!(window as any)._sharedAudioCtx) {
      (window as any)._sharedAudioCtx = new AudioCtx();
    }
    const ctx = (window as any)._sharedAudioCtx as AudioContext;
    if (ctx.state === 'suspended') await ctx.resume();

    if (!(window as any)._cachedAudioBuffer) {
      const response = await fetch('/foodora.mp3');
      const arrayBuffer = await response.arrayBuffer();
      (window as any)._cachedAudioBuffer = await ctx.decodeAudioData(arrayBuffer);
    }

    if ((window as any)._currentAudioSource) {
      try {
        (window as any)._currentAudioSource.stop();
      } catch { /* fonte já parada */ }
    }

    const source = ctx.createBufferSource();
    (window as any)._currentAudioSource = source;
    source.buffer = (window as any)._cachedAudioBuffer;
    const gainNode = ctx.createGain();
    gainNode.gain.value = volumeMultiplier; // Amplifica o volume
    source.connect(gainNode);
    gainNode.connect(ctx.destination);
    // Modo "automático com som": toca em loop e corta exatamente em stopAfterMs,
    // independente da duração do MP3.
    if (stopAfterMs && stopAfterMs > 0) source.loop = true;
    source.start(0);
    if (stopAfterMs && stopAfterMs > 0) {
      setTimeout(() => { try { source.stop(); } catch { /* já parou */ } }, stopAfterMs);
    }
  } catch (e) {
    console.error('Erro ao tocar audio:', e);
  }
}

/** Um toque curto (modo manual / campainha). */
export function playNewOrderBeep(): void {
  void playLoudAudio(4.0);
}

/** Modo "automático com som": toca o alerta por ~12 segundos e para sozinho. */
export function playOrderSound6s(): void {
  void playLoudAudio(4.0, 12000);
}
