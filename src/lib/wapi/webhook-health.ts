/**
 * Saúde do RECEBIMENTO de mensagens — coisa diferente de "WhatsApp conectado".
 *
 * O celular pode estar conectado, a W-API pode estar aceitando envios, e mesmo
 * assim nenhuma mensagem de cliente chegar até o app: basta o registro do
 * webhook cair do lado da W-API. Foi o que aconteceu em 02/09/2026, quando as
 * duas instâncias ficaram mudas (4h32 e 3h32) enquanto a tela exibia
 * "Conectado / Online" — o envio de uma notificação às 18:47 foi aceito
 * normalmente no meio do apagão, e o aviso de entrega dela nunca voltou.
 *
 * Este arquivo é a regra única de "está entrando mensagem?". Sem I/O de
 * propósito: quem age é o vigia (`webhook-watchdog.ts`), quem mostra é a tela.
 *
 * IMPORTANTE, para não esperar o impossível: a W-API não guarda mensagens
 * ("não armazenamos mensagens" na documentação) e a leitura de chats é negada
 * neste plano (403 em `/chats/fetch-chats`). Não existe reconciliação: o que
 * não for entregue no instante em que chega está perdido. Por isso o objetivo
 * aqui é ENCURTAR a janela e TIRAR DO ESCURO, nunca "não perder nada".
 */

/**
 * Silêncio a partir do qual o registro do webhook é considerado suspeito e o
 * vigia refaz os 5 PUTs na W-API.
 *
 * O handler carimba `lastWebhookAt` no máximo a cada 5 min (senão seria uma
 * escrita por mensagem recebida), então o valor lido pode estar até 5 min
 * atrasado: 15 aqui significa "entre 10 e 15 min de silêncio real". Refazer o
 * registro custa 5 chamadas e não interrompe nada — errar para mais é barato,
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
 * Intervalo mínimo entre duas tentativas de re-registro da mesma instância.
 * Serve de backoff: com a loja muda, sem isto o vigia refaria os 5 PUTs a cada
 * execução, e uma W-API fora do ar viraria uma tempestade de chamadas.
 */
export const INTERVALO_ENTRE_TENTATIVAS_MS = 15 * 60 * 1000;

export type EstadoDoRecebimento =
  /** Chegou mensagem há pouco: o registro está de pé. */
  | 'recebendo'
  /** Conectado, mas nada entra há tempo demais. */
  | 'mudo'
  /** Desconectado ou sem integração: silêncio aqui é esperado, não é falha. */
  | 'nao_se_aplica';

export interface SaudeDoWebhook {
  estado: EstadoDoRecebimento;
  /** Há quanto tempo nada chega (ms). 0 quando não se aplica. */
  silencioMs: number;
  /** O vigia deve refazer o registro dos webhooks na W-API? */
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

  // Desconectada não entra na conta: silêncio de quem não está conectado é o
  // esperado, e re-registrar aí seria ruído puro (e alarme falso na tela).
  if (!entrada.connected) {
    return { estado: 'nao_se_aplica', silencioMs: 0, precisaReRegistrar: false, precisaAlertar: false };
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
