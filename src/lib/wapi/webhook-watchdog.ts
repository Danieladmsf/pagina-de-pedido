/**
 * O vigia do recebimento: percebe que parou de entrar mensagem e refaz o
 * registro dos webhooks na W-API sem depender de ninguém abrir tela nenhuma.
 *
 * Por que ele existe: a auto-cura já existia em `/wapi/status`, mas só rodava
 * enquanto alguém estivesse com a aba de conexão do WhatsApp aberta no
 * navegador — e ninguém fica. Em 02/09/2026 isso custou 4h32 de loja muda, com
 * a tela exibindo "Conectado / Online" o tempo todo. O PDV também refazia o
 * registro, mas uma única vez por carregamento de página e só para `owner`.
 *
 * O que ele NÃO faz, e é importante não prometer: nada aqui recupera mensagem
 * perdida. A W-API não guarda o que não conseguiu entregar e não reenvia. Este
 * vigia encurta a janela (de horas para ~15 min) e deixa rastro do que houve.
 *
 * O rastro é o segundo motivo de ele existir. Hoje não dá para saber se o
 * silêncio foi "o registro caiu do lado deles" (isto aqui cura) ou "a entrega
 * deles estava fora" (isto aqui não cura). Cada incidente registra quanto tempo
 * levou para a primeira mensagem voltar DEPOIS do re-registro, e é isso que
 * separa as duas causas — na próxima vez a conversa terá dado, não palpite.
 */
import { getOptionalAdminDb } from '@/lib/firebase-admin';
import { getStoreOpenState } from '@/lib/whatsapp-messages';
import { configureWapiWebhooks } from '@/lib/wapi/wapi.service';
import { decryptWapiToken } from '@/lib/wapi/integration-store';
import type { WhatsAppIntegration } from '@/lib/wapi/types';
import {
  SILENCIO_PARA_REREGISTRAR_MS,
  avaliarSaudeDoWebhook,
  descreverSilencio,
} from '@/lib/wapi/webhook-health';

/** Onde ficam os incidentes. Só o Admin SDK escreve; a tela não lê. */
const COLECAO_INCIDENTES = 'whatsapp_webhook_incidents';

/**
 * Se a mensagem voltar dentro desta janela depois do re-registro, o que estava
 * quebrado era o REGISTRO na W-API — e o vigia resolveu. Passou muito disso, o
 * registro não era o problema: a entrega do provedor é que estava fora, e aí
 * nenhum código nosso teria evitado o silêncio.
 */
const JANELA_DE_CURA_MS = 5 * 60 * 1000;

export type VeredictoDoIncidente =
  /** Voltou logo após o re-registro: registro perdido do lado da W-API. */
  | 'registro_perdido'
  /** Só voltou muito depois: a entrega do provedor estava fora. */
  | 'entrega_do_provedor'
  /**
   * Detectado com a loja FECHADA. Não conclui nada, e é por isso que existe:
   * de madrugada a mensagem "volta" quando alguém finalmente escreve, não
   * quando o provedor se recupera — chamar isso de `entrega_do_provedor`
   * mentiria justamente no dado que a coleção existe para colher.
   */
  | 'inconclusivo_sem_movimento'
  /** Ainda mudo. */
  | 'em_aberto';

export interface ResultadoDaLoja {
  empresaId: string;
  instanceId: string;
  estado: 'recebendo' | 'mudo' | 'nao_se_aplica';
  silencioMs: number;
  reRegistrou: boolean;
  registroConfirmado: boolean;
  erro?: string;
}

export interface ResultadoDaVarredura {
  verificadas: number;
  mudas: number;
  reRegistradas: number;
  falhas: number;
  lojas: ResultadoDaLoja[];
}

interface DocDeLoja {
  empresaId: string;
  integration: WhatsAppIntegration;
  /** Estado da loja no momento da varredura; muda o limite de silêncio. */
  lojaAberta?: boolean;
}

/**
 * Lojas com WhatsApp conectado. Filtra no servidor pelo campo aninhado — são
 * poucas hoje, mas a varredura roda a cada poucos minutos e não pode virar
 * leitura da coleção inteira quando a base crescer.
 */
async function listarLojasConectadas(adminDb: FirebaseFirestore.Firestore): Promise<DocDeLoja[]> {
  const snap = await adminDb
    .collection('roles_admin')
    .where('whatsappIntegration.connected', '==', true)
    .get();

  const lojas = snap.docs
    .map((doc) => ({ empresaId: doc.id, integration: (doc.data() || {}).whatsappIntegration as WhatsAppIntegration }))
    .filter((loja) => Boolean(loja.integration?.wapiInstanceId));

  // O estado da loja muda o limite de silêncio, então precisa vir junto: são
  // poucas leituras (uma por loja conectada, a cada 10 min).
  return Promise.all(
    lojas.map(async (loja) => {
      const perfil = await adminDb.collection('store_profiles').doc(loja.empresaId).get().catch(() => null);
      return { ...loja, lojaAberta: getStoreOpenState(perfil?.data()).isOpen };
    }),
  );
}

/**
 * Fecha o incidente aberto desta loja quando a mensagem voltou, gravando o
 * veredicto. Roda antes de avaliar de novo: assim o incidente é encerrado pelo
 * mesmo carimbo que prova a volta (`lastWebhookAt`), sem custo nenhum no
 * caminho quente do webhook.
 */
async function fecharIncidenteSeVoltou(
  adminDb: FirebaseFirestore.Firestore,
  empresaId: string,
  integration: WhatsAppIntegration,
  agora: number,
) {
  const abertos = await adminDb
    .collection(COLECAO_INCIDENTES)
    .where('empresaId', '==', empresaId)
    .where('status', '==', 'aberto')
    .get();

  if (abertos.empty) return;

  const ultimoWebhook = Date.parse(integration.lastWebhookAt || '') || 0;

  for (const doc of abertos.docs) {
    const dados = doc.data() || {};
    const referencia = Date.parse(dados.ultimoWebhookAntes || '') || 0;

    // Só encerra quando entrou mensagem NOVA — `lastWebhookAt` igual ao de
    // quando o incidente abriu significa que continua mudo.
    if (ultimoWebhook <= referencia) continue;

    const ultimaTentativa = Date.parse(dados.ultimaTentativaEm || '') || 0;
    const tempoAteVoltarMs = ultimaTentativa > 0 ? ultimoWebhook - ultimaTentativa : 0;
    // Incidente aberto com a loja fechada não vira veredicto: naquele horário
    // a volta da mensagem não diz nada sobre a causa do silêncio.
    const veredicto: VeredictoDoIncidente = dados.lojaAbertaNaDeteccao === false
      ? 'inconclusivo_sem_movimento'
      : ultimaTentativa > 0 && tempoAteVoltarMs <= JANELA_DE_CURA_MS
        ? 'registro_perdido'
        : 'entrega_do_provedor';

    await doc.ref
      .set(
        {
          status: 'curado',
          voltouEm: new Date(ultimoWebhook).toISOString(),
          fechadoEm: new Date(agora).toISOString(),
          duracaoDoSilencioMs: ultimoWebhook - referencia,
          tempoAteVoltarDepoisDoReRegistroMs: tempoAteVoltarMs,
          veredicto,
        },
        { merge: true },
      )
      .catch(() => {});
  }
}

/** Abre o incidente (ou soma uma tentativa ao que já está aberto). */
async function registrarTentativa(
  adminDb: FirebaseFirestore.Firestore,
  loja: DocDeLoja,
  silencioMs: number,
  registroConfirmado: boolean,
  erro: string,
  agora: number,
) {
  const agoraIso = new Date(agora).toISOString();
  const abertos = await adminDb
    .collection(COLECAO_INCIDENTES)
    .where('empresaId', '==', loja.empresaId)
    .where('status', '==', 'aberto')
    .limit(1)
    .get();

  const tentativa = {
    em: agoraIso,
    registroConfirmado,
    ...(erro ? { erro: erro.slice(0, 300) } : {}),
  };

  if (!abertos.empty) {
    const doc = abertos.docs[0];
    const anteriores = Array.isArray(doc.data()?.tentativas) ? doc.data()!.tentativas : [];
    await doc.ref
      .set(
        {
          ultimaTentativaEm: agoraIso,
          silencioMsAtual: Number.isFinite(silencioMs) ? silencioMs : null,
          // Guarda no máximo as 20 últimas: incidente longo não pode inchar o
          // documento até estourar o limite de 1 MB do Firestore.
          tentativas: [...anteriores, tentativa].slice(-20),
        },
        { merge: true },
      )
      .catch(() => {});
    return;
  }

  await adminDb
    .collection(COLECAO_INCIDENTES)
    .add({
      empresaId: loja.empresaId,
      instanceId: loja.integration.wapiInstanceId,
      status: 'aberto',
      detectadoEm: agoraIso,
      ultimaTentativaEm: agoraIso,
      // Referência para saber, na próxima passada, se entrou mensagem nova.
      ultimoWebhookAntes: loja.integration.lastWebhookAt || '',
      silencioNaDeteccao: descreverSilencio(silencioMs),
      lojaAbertaNaDeteccao: loja.lojaAberta !== false,
      silencioMsNaDeteccao: Number.isFinite(silencioMs) ? silencioMs : null,
      tentativas: [tentativa],
      // A coleção se mantém sozinha, como a de eventos do webhook.
      expireAt: new Date(agora + 90 * 24 * 60 * 60 * 1000),
    })
    .catch(() => {});
}

/**
 * Verifica uma loja e, se estiver muda, refaz o registro dos 5 webhooks.
 *
 * `webhookUrl` vem pronto de quem chama (a rota sabe montar a URL a partir do
 * request); assim esta camada não depende de `next/server` e continua testável.
 */
export async function vigiarRecebimentoDaLoja(
  loja: DocDeLoja,
  montarWebhookUrl: (integration: WhatsAppIntegration, token: string) => string,
  agora = Date.now(),
): Promise<ResultadoDaLoja> {
  const adminDb = getOptionalAdminDb();
  const base: ResultadoDaLoja = {
    empresaId: loja.empresaId,
    instanceId: loja.integration?.wapiInstanceId || '',
    estado: 'nao_se_aplica',
    silencioMs: 0,
    reRegistrou: false,
    registroConfirmado: false,
  };

  if (!adminDb) return { ...base, erro: 'Firebase Admin indisponivel.' };

  await fecharIncidenteSeVoltou(adminDb, loja.empresaId, loja.integration, agora);

  const saude = avaliarSaudeDoWebhook({
    connected: loja.integration.connected,
    lastWebhookAt: loja.integration.lastWebhookAt,
    ultimaTentativaEm: (loja.integration as any).watchdogUltimaTentativaEm,
    lojaAberta: loja.lojaAberta,
    agora,
  });

  base.estado = saude.estado;
  base.silencioMs = Number.isFinite(saude.silencioMs) ? saude.silencioMs : SILENCIO_PARA_REREGISTRAR_MS;

  if (!saude.precisaReRegistrar) return base;

  let registroConfirmado = false;
  let erro = '';

  try {
    const token = decryptWapiToken(loja.integration);
    if (!token) throw new Error('Token da instancia indisponivel.');

    const resultado = await configureWapiWebhooks(
      loja.integration.wapiInstanceId,
      token,
      montarWebhookUrl(loja.integration, token),
    );
    // `configureWapiWebhooks` engole falha parcial (Promise.allSettled): sem
    // esta checagem um 429 deixaria o registro pela metade e ainda contaria
    // como sucesso — o mesmo erro que já mordeu no poll de status.
    registroConfirmado = resultado.failed.length === 0;
    if (!registroConfirmado) {
      erro = `Endpoints recusados: ${resultado.failed.map((f) => f.endpoint).join(', ')}`;
    }
  } catch (error: any) {
    erro = String(error?.message || error);
  }

  base.reRegistrou = true;
  base.registroConfirmado = registroConfirmado;
  if (erro) base.erro = erro;

  const agoraIso = new Date(agora).toISOString();
  await adminDb
    .collection('roles_admin')
    .doc(loja.empresaId)
    .update({
      // Backoff do vigia. Fica separado de `lastWebhookAt` de propósito: o poll
      // de status já recarimbava aquele campo para se dar backoff, o que
      // apagava a informação de "há quanto tempo esta loja está muda".
      'whatsappIntegration.watchdogUltimaTentativaEm': agoraIso,
      'whatsappIntegration.watchdogUltimoResultado': registroConfirmado ? 'ok' : 'falha',
      'whatsappIntegration.updatedAt': agoraIso,
    })
    .catch(() => {});

  await registrarTentativa(adminDb, loja, saude.silencioMs, registroConfirmado, erro, agora);

  return base;
}

/** Varre todas as lojas conectadas. É o que o cron chama. */
export async function vigiarRecebimentoDeTodasAsLojas(
  montarWebhookUrl: (integration: WhatsAppIntegration, token: string) => string,
  agora = Date.now(),
): Promise<ResultadoDaVarredura> {
  const adminDb = getOptionalAdminDb();
  if (!adminDb) return { verificadas: 0, mudas: 0, reRegistradas: 0, falhas: 0, lojas: [] };

  const lojas = await listarLojasConectadas(adminDb);
  const resultados: ResultadoDaLoja[] = [];

  // Sequencial de propósito: são poucas lojas e cada re-registro são 5 PUTs na
  // W-API. Em paralelo, uma varredura viraria rajada em cima de um provedor que
  // pode estar justamente instável.
  for (const loja of lojas) {
    resultados.push(await vigiarRecebimentoDaLoja(loja, montarWebhookUrl, agora));
  }

  return {
    verificadas: resultados.length,
    mudas: resultados.filter((r) => r.estado === 'mudo').length,
    reRegistradas: resultados.filter((r) => r.reRegistrou && r.registroConfirmado).length,
    falhas: resultados.filter((r) => r.reRegistrou && !r.registroConfirmado).length,
    lojas: resultados,
  };
}

export { listarLojasConectadas };
export type { DocDeLoja };
