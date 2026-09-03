import { describe, expect, it } from 'vitest';
import { Timestamp } from 'firebase/firestore';
import { avisoDePedidoDeOutroDia, diaDaLoja } from './pedido-de-outro-dia';

/**
 * O caso real que originou isto: pedido #ILMLK feito em 02/09/2026 às 14h30
 * (BRT) e finalizado em 03/09 às 10h53, 19 segundos antes do fechamento do
 * caixa. R$ 31 apareceram no Dashboard de hoje sem venda nenhuma ter sido feita
 * hoje.
 */
const PEDIDO_ILMLK = new Date('2026-09-02T17:30:23.405Z'); // 14:30:23 BRT
const FECHOU_ILMLK = new Date('2026-09-03T13:53:19.000Z'); // 10:53:19 BRT

describe('avisoDePedidoDeOutroDia', () => {
  it('avisa no caso real do #ILMLK', () => {
    const aviso = avisoDePedidoDeOutroDia(PEDIDO_ILMLK, FECHOU_ILMLK);

    expect(aviso).not.toBeNull();
    expect(aviso!.quando).toBe('ontem');
    expect(aviso!.diasAtras).toBe(1);
    expect(aviso!.texto).toContain('de ontem');
    expect(aviso!.texto).toContain('faturamento de hoje');
  });

  it('nao avisa nada no caso normal (pedido fechado no mesmo dia)', () => {
    const pedido = new Date('2026-09-03T14:00:00Z'); // 11:00 BRT
    const fechou = new Date('2026-09-03T20:00:00Z'); // 17:00 BRT

    expect(avisoDePedidoDeOutroDia(pedido, fechou)).toBeNull();
  });

  it('conta pelo calendario da loja, nao por 24h corridas', () => {
    // 23h50 de um dia, fechado 20 minutos depois — ja e "ontem".
    const noite = new Date('2026-09-02T02:50:00Z'); // 23:50 BRT do dia 01
    const madrugada = new Date('2026-09-02T03:10:00Z'); // 00:10 BRT do dia 02
    expect(avisoDePedidoDeOutroDia(noite, madrugada)?.quando).toBe('ontem');

    // Quase 24h de diferenca, mas dentro do mesmo dia: nao avisa.
    const cedo = new Date('2026-09-03T03:10:00Z'); // 00:10 BRT
    const tarde = new Date('2026-09-04T02:50:00Z'); // 23:50 BRT do MESMO dia
    expect(avisoDePedidoDeOutroDia(cedo, tarde)).toBeNull();
  });

  it('usa a data quando o pedido e mais antigo que ontem', () => {
    const pedido = new Date('2026-08-28T20:41:00Z'); // 17:41 BRT de 28/08
    const fechou = new Date('2026-09-03T13:00:00Z');

    const aviso = avisoDePedidoDeOutroDia(pedido, fechou);
    expect(aviso!.quando).toBe('28 de agosto');
    expect(aviso!.diasAtras).toBe(6);
  });

  it('aceita Timestamp do Firestore e string ISO', () => {
    const porTimestamp = avisoDePedidoDeOutroDia(Timestamp.fromDate(PEDIDO_ILMLK), FECHOU_ILMLK);
    const porString = avisoDePedidoDeOutroDia(PEDIDO_ILMLK.toISOString(), FECHOU_ILMLK);

    expect(porTimestamp?.quando).toBe('ontem');
    expect(porString?.quando).toBe('ontem');
  });

  it('data ausente ou ilegivel nao vira aviso', () => {
    expect(avisoDePedidoDeOutroDia(null, FECHOU_ILMLK)).toBeNull();
    expect(avisoDePedidoDeOutroDia(undefined, FECHOU_ILMLK)).toBeNull();
    expect(avisoDePedidoDeOutroDia('', FECHOU_ILMLK)).toBeNull();
    expect(avisoDePedidoDeOutroDia('nao e data', FECHOU_ILMLK)).toBeNull();
  });

  it('pedido no futuro nao vira aviso (relogio adiantado da maquina da loja)', () => {
    const amanha = new Date('2026-09-04T14:00:00Z');
    expect(avisoDePedidoDeOutroDia(amanha, FECHOU_ILMLK)).toBeNull();
  });

  it('fuso invalido no cadastro nao quebra o fechamento', () => {
    const aviso = avisoDePedidoDeOutroDia(PEDIDO_ILMLK, FECHOU_ILMLK, 'Fuso/Inexistente');
    expect(aviso?.quando).toBe('ontem');
  });
});

describe('diaDaLoja', () => {
  it('respeita o fuso ao virar o dia', () => {
    // 02h UTC ainda e o dia anterior no Brasil.
    const instante = new Date('2026-09-03T02:00:00Z');
    expect(diaDaLoja(instante, 'America/Sao_Paulo')).toBe('2026-09-02');
    expect(diaDaLoja(instante, 'UTC')).toBe('2026-09-03');
  });
});
