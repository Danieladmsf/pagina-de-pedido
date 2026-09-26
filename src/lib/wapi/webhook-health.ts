/**
 * Saúde do RECEBIMENTO de mensagens — coisa diferente de "WhatsApp conectado".
 *
 * O celular pode estar conectado, o envio pode estar funcionando, e mesmo assim
 * nenhuma mensagem de cliente chegar até o app: basta o webhook parar de ser
 * entregue. Foi o que aconteceu em 02/09/2026, ainda com a W-API, quando as
 * duas lojas ficaram mudas (4h32 e 3h32) enquanto a tela exibia
 * "Conectado / Online" — o envio de uma notificação às 18:47 foi aceito
 * normalmente no meio do apagão, e o aviso de entrega dela nunca voltou.
 *
 * Este arquivo é a regra única de "está entrando mensagem?". Sem I/O de
 * propósito: quem age é o vigia (`webhook-watchdog.ts`), quem mostra é a tela.
 *
 * IMPORTANTE, para não esperar o impossível: o servidor tenta entregar cada
 * webhook algumas vezes e depois desiste, e o app não relê conversas. O que não
 * chegar nesse intervalo está perdido. Por isso o objetivo aqui é ENCURTAR a
 * janela e TIRAR DO ESCURO, nunca "não perder nada".
 */

/**
 * Silêncio a partir do qual o registro do webhook é considerado suspeito e o
 * vigia registra de novo o webhook da loja no servidor.
 *
 * O handler carimba `lastWebhookAt` no máximo a cada 5 min (senão seria uma
 * escrita por mensagem recebida), então o valor lido pode estar até 5 min
 * atrasado: 15 aqui significa "entre 10 e 15 min de silêncio real". Registrar
 * de novo custa uma chamada e não interrompe nada — errar para mais é barato,
 * errar para menos custou 4h30 de loja muda.
 */
export const SILENCIO_PARA_REREGISTRAR_MS = 15 * 60 * 1000;

/**
 * O mesmo limite, mas com a LOJA FECHADA — onde silêncio não é sintoma.
 *
 * Medido em produção: entre 22h e 07h, o WhatsApp da Gostinho passa por 46
 * silêncios de 15 min ou mais a cada 8 dias (o maior: 88 min). Ninguém manda
 * mensagem de madrugada e os stories alheios param de chegar. Com o limite
 * único de 15 min, o vigia acusou 7 incidentes numa única noite — todos falsos,
 * e todos rotulados com um veredicto que sujava justamente o dado que a
 * coleção existe para colher.
 *
 * 120 min fica acima do maior silêncio natural já medido. Um apagão real de
 * madrugada ainda é pego, só que em até 2h — e nessa faixa o que se perde é o
 * aviso de "estamos fechados", não um pedido.
 */
export const SILENCIO_COM_LOJA_FECHADA_MS = 120 * 60 * 1000;

/**
 * Silêncio a partir do qual a tela avisa a loja. Maior que o de cima de
 * propósito: dá ao vigia uma tentativa inteira de se curar sozinho antes de
 * incomodar quem está atendendo.
 */
export const SILENCIO_PARA_ALERTAR_MS = 30 * 60 * 1000;

/**
 * Intervalo mínimo entre duas tentativas de re-registro da mesma loja. Serve de
 * backoff: com a loja muda, sem isto o vigia registraria de novo a cada
 * execução, e um servidor fora do ar viraria uma tempestade de chamadas.
 */
export const INTERVALO_ENTRE_TENTATIVAS_MS = 15 * 60 * 1000;

/**
 * Evento de janela que a aba WhatsApp dispara quando o aparelho conecta.
 *
 * O aviso do topo só pergunta ao servidor a cada 5 min. Sem este sinal, quem
 * acabou de ler o QR Code continuaria vendo "WhatsApp desconectado" por minutos,
 * como se não tivesse funcionado.
 */
export const EVENTO_WHATSAPP_CONECTOU = 'whatsapp:conectou';

export type EstadoDoRecebimento =
  /** Chegou mensagem há pouco: o registro está de pé. */
  | 'recebendo'
  /** Conectado, mas nada entra há tempo demais. */
  | 'mudo'
  /**
   * A loja tem WhatsApp vinculado, mas ele não está conectado: nada entra e
   * nada sai até alguém ler o QR Code de novo. Re-registrar webhook não cura
   * isso — só o dono, com o celular da loja na mão.
   */
  | 'desconectado'
  /** Sem WhatsApp vinculado: não há o que vigiar. */
  | 'nao_se_aplica';

export interface SaudeDoWebhook {
  estado: EstadoDoRecebimento;
  /** Há quanto tempo nada chega (ms). 0 quando não se aplica. */
  silencioMs: number;
  /** O vigia deve registrar de novo o webhook no servidor? */
  precisaReRegistrar: boolean;
  /** A tela deve avisar quem está atendendo? */
  precisaAlertar: boolean;
}

export interface EntradaDaSaude {
  connected?: boolean;
  /** ISO do último webhook recebido desta instância. */
  lastWebhookAt?: string;
  /** ISO da última vez que o vigia tentou refazer o registro. */
  ultimaTentativaEm?: string;
  /** A loja está no horário de funcionamento? Fechada não alerta. */
  lojaAberta?: boolean;
  agora?: number;
}

const emMillis = (valor?: string) => (valor ? Date.parse(valor) || 0 : 0);

/**
 * Decide, a partir dos carimbos, se o recebimento está de pé — e o que fazer.
 *
 * Instância nunca vista (`lastWebhookAt` vazio) conta como muda: ou o registro
 * nunca chegou a existir, ou caiu antes do primeiro carimbo. Nos dois casos a
 * ação é a mesma, e é justamente o caso que ninguém percebe.
 */
export function avaliarSaudeDoWebhook(entrada: EntradaDaSaude): SaudeDoWebhook {
  const agora = entrada.agora ?? Date.now();

  // Desconectada não é silêncio a curar: re-registrar webhook não religa um
  // aparelho que saiu da conexão. Mas também não pode ficar calada. Em
  // 22/09/2026 a Gostinho passou mais de 5h desconectada, sem resposta
  // automática e sem aviso de pedido, e nenhuma tela avisou — este ramo
  // devolvia "não se aplica". Com a loja aberta, avisa na hora: não há o que
  // esperar, só alguém ler o QR Code resolve.
  if (!entrada.connected) {
    return {
      estado: 'desconectado',
      silencioMs: 0,
      precisaReRegistrar: false,
      precisaAlertar: entrada.lojaAberta !== false,
    };
  }

  const ultimoWebhook = emMillis(entrada.lastWebhookAt);
  const silencioMs = ultimoWebhook > 0 ? Math.max(0, agora - ultimoWebhook) : Number.POSITIVE_INFINITY;

  // Fechada, só um silêncio muito maior é sintoma: ver a constante acima.
  const limite = entrada.lojaAberta === false ? SILENCIO_COM_LOJA_FECHADA_MS : SILENCIO_PARA_REREGISTRAR_MS;

  if (silencioMs < limite) {
    return { estado: 'recebendo', silencioMs, precisaReRegistrar: false, precisaAlertar: false };
  }

  // Backoff: uma tentativa a cada INTERVALO_ENTRE_TENTATIVAS_MS, no máximo.
  const ultimaTentativa = emMillis(entrada.ultimaTentativaEm);
  const podeTentarDeNovo = agora - ultimaTentativa >= INTERVALO_ENTRE_TENTATIVAS_MS;

  return {
    estado: 'mudo',
    silencioMs,
    precisaReRegistrar: podeTentarDeNovo,
    // Loja fechada não recebe alarme: de madrugada o silêncio é normal e
    // acordar o dono com aviso vermelho ensina a ignorar o aviso.
    precisaAlertar: silencioMs >= SILENCIO_PARA_ALERTAR_MS && entrada.lojaAberta !== false,
  };
}

/** "há 4h32", "há 18 min" — para a tela e para o registro do incidente. */
export function descreverSilencio(silencioMs: number): string {
  if (!Number.isFinite(silencioMs)) return 'desde que foi conectado';
  const minutos = Math.floor(silencioMs / 60000);
  if (minutos < 1) return 'agora há pouco';
  if (minutos < 60) return `há ${minutos} min`;
  const horas = Math.floor(minutos / 60);
  const resto = minutos % 60;
  return resto === 0 ? `há ${horas}h` : `há ${horas}h${String(resto).padStart(2, '0')}`;
}
