#!/usr/bin/env node
/**
 * Cria (ou refaz) o agendamento do vigia do recebimento de WhatsApp no QStash.
 *
 * Por que no QStash e nao no cron da Vercel: o cron do plano Hobby roda uma vez
 * por dia, e um vigia que acorda de 24 em 24 horas nao serve para nada aqui —
 * o objetivo e cortar o silencio em ~15 min. O QStash ja e usado pelo disparo
 * de campanhas, entao nao entra dependencia nova no projeto.
 *
 * Roda uma vez. Depois disso o agendamento vive no QStash e sobrevive a
 * qualquer deploy.
 *
 * Uso:
 *   node scripts/agendar-vigia-webhook.mjs                 # so mostra o que existe
 *   node scripts/agendar-vigia-webhook.mjs --aplicar       # cria/atualiza
 *   node scripts/agendar-vigia-webhook.mjs --remover       # tira do ar
 *
 * Precisa de QSTASH_TOKEN e da URL publica do app (NEXT_PUBLIC_APP_URL ou
 * APP_URL) — o script le do ambiente e, se faltar, do .env.local.
 */
import { readFileSync } from 'node:fs';
import { Client } from '@upstash/qstash';

const APLICAR = process.argv.includes('--aplicar');
const REMOVER = process.argv.includes('--remover');

/** A cada 10 min: o limite de silencio do vigia e 15, entao nunca passa dele. */
const CRON = '*/10 * * * *';

function lerEnvLocal() {
  try {
    const texto = readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
    const mapa = {};
    for (const linha of texto.split(/\r?\n/)) {
      const m = linha.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m) mapa[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
    return mapa;
  } catch {
    return {};
  }
}

const env = { ...lerEnvLocal(), ...process.env };
const token = env.QSTASH_TOKEN;
const base = (env.NEXT_PUBLIC_APP_URL || env.APP_URL || env.WAPI_PUBLIC_BASE_URL || '').replace(/\/+$/, '');

if (!token) {
  console.error('QSTASH_TOKEN ausente (defina no ambiente ou no .env.local).');
  process.exit(1);
}
if (!base) {
  console.error('URL publica ausente (defina NEXT_PUBLIC_APP_URL ou APP_URL).');
  process.exit(1);
}

const destino = `${base}/api/cron/webhook-watchdog`;
const client = new Client({ token });

const existentes = await client.schedules.list();
const doVigia = existentes.filter((s) => String(s.destination || '').includes('/api/cron/webhook-watchdog'));

console.log(`Destino: ${destino}`);
console.log(`Agendamentos do vigia hoje: ${doVigia.length}`);
for (const s of doVigia) console.log(`  - ${s.scheduleId} | cron="${s.cron}" | ${s.destination}`);

if (REMOVER) {
  if (!APLICAR) {
    console.log('\n(simulacao) --remover com --aplicar apagaria os agendamentos acima.');
    process.exit(0);
  }
  for (const s of doVigia) {
    await client.schedules.delete(s.scheduleId);
    console.log(`removido: ${s.scheduleId}`);
  }
  process.exit(0);
}

if (!APLICAR) {
  console.log(`\n(simulacao) criaria o agendamento "${CRON}" para ${destino}.`);
  console.log('Rode de novo com --aplicar para valer.');
  process.exit(0);
}

// Recriar em vez de acumular: rodar o script duas vezes nao pode virar duas
// varreduras simultaneas em cima da mesma W-API.
for (const s of doVigia) {
  await client.schedules.delete(s.scheduleId);
  console.log(`removido o anterior: ${s.scheduleId}`);
}

const { scheduleId } = await client.schedules.create({
  destination: destino,
  cron: CRON,
  body: JSON.stringify({ origem: 'agendamento' }),
  headers: { 'Content-Type': 'application/json' },
});

console.log(`\nAgendado: ${scheduleId} (${CRON})`);
console.log('Confira em https://console.upstash.com/qstash — aba Schedules.');
