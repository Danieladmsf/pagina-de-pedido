/**
 * Liga (e confere) o agendamento do vigia do recebimento no QStash.
 *
 * Isto existe como código do servidor, e não só como script de linha de
 * comando, por um motivo de segurança: o `QSTASH_TOKEN` é marcado como
 * "Sensitive" na Vercel e **não pode ser lido por ninguém** — nem pelo painel,
 * nem por `vercel env pull` ("Secret values cannot be pulled"). Quem tem o
 * token é o próprio servidor, em tempo de execução. Então o agendamento é
 * criado de dentro dele, e o segredo nunca precisa sair da Vercel nem passar
 * pela máquina de ninguém.
 *
 * `scripts/agendar-vigia-webhook.mjs` continua servindo para quem tiver o token
 * em mãos (ele é recuperável no console da Upstash, que é a fonte original).
 */
import { Client } from '@upstash/qstash';

/** A cada 10 min: o limite de silêncio do vigia é 15, então nunca passa dele. */
export const CRON_DO_VIGIA = '*/10 * * * *';

const CAMINHO = '/api/cron/webhook-watchdog';

export interface AgendamentoDoVigia {
  scheduleId: string;
  cron: string;
  destino: string;
}

function cliente() {
  const token = process.env.QSTASH_TOKEN;
  if (!token) throw new Error('QSTASH_TOKEN ausente no servidor.');
  return new Client({ token });
}

function destinoDoVigia(origem: string) {
  const base = (process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || process.env.WAPI_PUBLIC_BASE_URL || origem || '')
    .replace(/\/+$/, '');
  if (!base || base.includes('localhost')) {
    throw new Error('URL publica indisponivel para agendar o vigia.');
  }
  return `${base}${CAMINHO}`;
}

/** O que já está agendado hoje para o vigia (para conferir sem mexer em nada). */
export async function listarAgendamentosDoVigia(): Promise<AgendamentoDoVigia[]> {
  const todos = await cliente().schedules.list();
  return todos
    .filter((s) => String(s.destination || '').includes(CAMINHO))
    .map((s) => ({ scheduleId: s.scheduleId, cron: s.cron, destino: String(s.destination || '') }));
}

/**
 * Deixa exatamente UM agendamento do vigia no ar.
 *
 * Recria em vez de acumular: chamar isto duas vezes não pode virar duas
 * varreduras simultâneas em cima da mesma W-API.
 */
export async function agendarVigia(origem: string): Promise<AgendamentoDoVigia> {
  const qstash = cliente();
  const destino = destinoDoVigia(origem);

  for (const antigo of await listarAgendamentosDoVigia()) {
    await qstash.schedules.delete(antigo.scheduleId).catch(() => {});
  }

  const { scheduleId } = await qstash.schedules.create({
    destination: destino,
    cron: CRON_DO_VIGIA,
    body: JSON.stringify({ origem: 'agendamento' }),
    headers: { 'Content-Type': 'application/json' },
  });

  return { scheduleId, cron: CRON_DO_VIGIA, destino };
}
