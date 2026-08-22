#!/usr/bin/env node
/**
 * Costura o `@lid` ao telefone da mesma pessoa nos contatos de resposta
 * automatica.
 *
 * Por que existe: a reacao no story chega so com o LID, enquanto a DM da mesma
 * pessoa chega com o numero. Sem o vinculo, quem ja e cliente conhecida recebe a
 * saudacao de novo ao reagir num story — e quem reage e escreve na sequencia
 * recebe duas mensagens com segundos de diferenca.
 *
 * A relacao e inequivoca: o proprio provedor entrega `sender.id` (telefone) e
 * `sender.senderLid` no MESMO payload. LID com mais de um telefone e conflito e
 * fica de fora, sem chute.
 *
 * Uso:
 *   node scripts/backfill-lid-telefone.mjs            # so relata
 *   node scripts/backfill-lid-telefone.mjs --aplicar  # grava
 */
import { adminFirestore } from './lib/firebase-admin-db.mjs';

const APLICAR = process.argv.includes('--aplicar');
const db = adminFirestore();

const EVENTOS = 'whatsapp_webhook_events';
const CONTATOS = 'whatsapp_auto_reply_contacts';

function telefonePlausivel(valor) {
  const digitos = String(valor || '').replace(/\D/g, '');
  if (!digitos) return '';
  const comDdi = digitos.startsWith('55') ? digitos : `55${digitos}`;
  return comDdi.length >= 12 && comDdi.length <= 13 ? comDdi : '';
}

function lidDe(valor) {
  const texto = String(valor || '').trim().toLowerCase();
  if (!texto.endsWith('@lid')) return '';
  const digitos = texto.slice(0, -'@lid'.length).replace(/\D/g, '');
  return digitos.length >= 8 && digitos.length <= 20 ? `${digitos}@lid` : '';
}

const snapshot = await db.collection(EVENTOS).get();
console.log(`eventos lidos: ${snapshot.size}`);

/** chave `empresaId|lid` -> Set de telefones vistos */
const vistos = new Map();

for (const documento of snapshot.docs) {
  const dados = documento.data();
  if ((dados.hook || '') !== 'received') continue;
  if (!dados.empresaId) continue;

  const payload = dados.payload || {};
  if (payload.fromMe || payload.isGroup) continue;

  const lid = lidDe(payload?.sender?.senderLid);
  const telefone = telefonePlausivel(payload?.sender?.id);
  if (!lid || !telefone) continue;

  const chave = `${dados.empresaId}|${lid}`;
  if (!vistos.has(chave)) vistos.set(chave, new Set());
  vistos.get(chave).add(telefone);
}

const pares = [];
const conflitos = [];
for (const [chave, telefones] of vistos) {
  const [empresaId, lid] = chave.split('|');
  if (telefones.size > 1) {
    conflitos.push({ empresaId, lid, telefones: [...telefones] });
    continue;
  }
  pares.push({ empresaId, lid, telefone: [...telefones][0] });
}

console.log(`pares LID <-> telefone inequivocos: ${pares.length}`);
console.log(`conflitos (LID com mais de um telefone, deixados de fora): ${conflitos.length}`);
for (const c of conflitos) console.log('  conflito:', c.lid, c.telefones.join(', '));

if (!APLICAR) {
  console.log('\nNada gravado. Rode com --aplicar para escrever.');
  process.exit(0);
}

const agora = new Date().toISOString();
let gravados = 0;
for (let inicio = 0; inicio < pares.length; inicio += 400) {
  const lote = db.batch();
  for (const par of pares.slice(inicio, inicio + 400)) {
    lote.set(
      db.collection(CONTATOS).doc(`${par.empresaId}_${par.lid}`),
      { empresaId: par.empresaId, telefoneConhecido: par.telefone, updatedAt: agora },
      { merge: true },
    );
    gravados++;
  }
  await lote.commit();
}

console.log(`gravados: ${gravados}`);
process.exit(0);
