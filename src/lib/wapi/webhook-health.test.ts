import { describe, expect, it } from 'vitest';
import {
  INTERVALO_ENTRE_TENTATIVAS_MS,
  SILENCIO_PARA_ALERTAR_MS,
  SILENCIO_PARA_REREGISTRAR_MS,
  avaliarSaudeDoWebhook,
  descreverSilencio,
} from './webhook-health';

/**
 * O caso que deu origem a tudo isto, com os numeros medidos em producao:
 * 02/09/2026, instancia LITE-8NDQT1-UWX43P (Gostinho de Ceu) muda das 16:00 as
 * 20:32 — 4h32 — enquanto `connected` era true e o envio de uma notificacao as
 * 18:47 foi aceito normalmente pela W-API.
 */
const APAGAO = {
  inicio: Date.parse('2026-09-02T19:00:07.000Z'), // 16:00:07 BRT
  fim: Date.parse('2026-09-02T23:32:29.000Z'), // 20:32:29 BRT
};

const minutos = (n: number) => n * 60 * 1000;

describe('avaliarSaudeDoWebhook', () => {
  it('nao acusa nada enquanto entra mensagem', () => {
    const agora = Date.now();
    const saude = avaliarSaudeDoWebhook({
      connected: true,
      lastWebhookAt: new Date(agora - minutos(3)).toISOString(),
      agora,
    });

    expect(saude.estado).toBe('recebendo');
    expect(saude.precisaReRegistrar).toBe(false);
    expect(saude.precisaAlertar).toBe(false);
  });

  it('o carimbo de ate 5 min atras (o heartbeat do handler) nao vira alarme', () => {
    const agora = Date.now();
    const saude = avaliarSaudeDoWebhook({
      connected: true,
      lastWebhookAt: new Date(agora - minutos(5)).toISOString(),
      agora,
    });

    expect(saude.estado).toBe('recebendo');
  });

  it('manda re-registrar quando o silencio passa do limite', () => {
    const agora = Date.now();
    const saude = avaliarSaudeDoWebhook({
      connected: true,
      lastWebhookAt: new Date(agora - SILENCIO_PARA_REREGISTRAR_MS - 1000).toISOString(),
      agora,
    });

    expect(saude.estado).toBe('mudo');
    expect(saude.precisaReRegistrar).toBe(true);
    // Ainda nao alerta: o vigia merece uma tentativa antes de assustar a loja.
    expect(saude.precisaAlertar).toBe(false);
  });

  it('so alerta a loja depois da janela maior', () => {
    const agora = Date.now();
    const saude = avaliarSaudeDoWebhook({
      connected: true,
      lastWebhookAt: new Date(agora - SILENCIO_PARA_ALERTAR_MS - 1000).toISOString(),
      lojaAberta: true,
      agora,
    });

    expect(saude.precisaAlertar).toBe(true);
  });

  it('loja fechada nao recebe alarme (silencio de madrugada e normal)', () => {
    const agora = Date.now();
    const saude = avaliarSaudeDoWebhook({
      connected: true,
      lastWebhookAt: new Date(agora - minutos(240)).toISOString(),
      lojaAberta: false,
      agora,
    });

    expect(saude.estado).toBe('mudo');
    expect(saude.precisaReRegistrar).toBe(true);
    expect(saude.precisaAlertar).toBe(false);
  });

  it('desconectado nao conta: nada a re-registrar, nada a alertar', () => {
    const saude = avaliarSaudeDoWebhook({
      connected: false,
      lastWebhookAt: new Date(Date.now() - minutos(500)).toISOString(),
    });

    expect(saude.estado).toBe('nao_se_aplica');
    expect(saude.precisaReRegistrar).toBe(false);
    expect(saude.precisaAlertar).toBe(false);
  });

  it('instancia que nunca recebeu webhook conta como muda', () => {
    const saude = avaliarSaudeDoWebhook({ connected: true, lastWebhookAt: '' });

    expect(saude.estado).toBe('mudo');
    expect(saude.precisaReRegistrar).toBe(true);
    expect(saude.silencioMs).toBe(Number.POSITIVE_INFINITY);
  });

  it('respeita o backoff entre tentativas', () => {
    const agora = Date.now();
    const entrada = {
      connected: true,
      lastWebhookAt: new Date(agora - minutos(90)).toISOString(),
      agora,
    };

    const logoApos = avaliarSaudeDoWebhook({
      ...entrada,
      ultimaTentativaEm: new Date(agora - minutos(2)).toISOString(),
    });
    expect(logoApos.estado).toBe('mudo');
    expect(logoApos.precisaReRegistrar).toBe(false);

    const passadoOIntervalo = avaliarSaudeDoWebhook({
      ...entrada,
      ultimaTentativaEm: new Date(agora - INTERVALO_ENTRE_TENTATIVAS_MS - 1000).toISOString(),
    });
    expect(passadoOIntervalo.precisaReRegistrar).toBe(true);
  });

  it('o apagao de 02/09/2026 teria sido pego em 15 min, nao em 4h32', () => {
    // Como estava: ninguem olhava, e o silencio durou o apagao inteiro.
    const noFimDoApagao = avaliarSaudeDoWebhook({
      connected: true,
      lastWebhookAt: new Date(APAGAO.inicio).toISOString(),
      lojaAberta: true,
      agora: APAGAO.fim,
    });
    expect(noFimDoApagao.estado).toBe('mudo');
    expect(noFimDoApagao.precisaAlertar).toBe(true);
    expect(Math.round(noFimDoApagao.silencioMs / 60000)).toBe(272);

    // Com o vigia: a primeira varredura passados 15 min ja teria agido.
    const quinzeMinutosDepois = avaliarSaudeDoWebhook({
      connected: true,
      lastWebhookAt: new Date(APAGAO.inicio).toISOString(),
      lojaAberta: true,
      agora: APAGAO.inicio + SILENCIO_PARA_REREGISTRAR_MS + 1000,
    });
    expect(quinzeMinutosDepois.precisaReRegistrar).toBe(true);
  });
});

describe('descreverSilencio', () => {
  it('fala como gente, nao em milissegundos', () => {
    expect(descreverSilencio(minutos(0.5))).toBe('agora há pouco');
    expect(descreverSilencio(minutos(18))).toBe('há 18 min');
    expect(descreverSilencio(minutos(120))).toBe('há 2h');
    expect(descreverSilencio(minutos(272))).toBe('há 4h32');
    expect(descreverSilencio(Number.POSITIVE_INFINITY)).toBe('desde que foi conectado');
  });
});
