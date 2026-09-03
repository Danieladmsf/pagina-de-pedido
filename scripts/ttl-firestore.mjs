#!/usr/bin/env node
/**
 * Liga (ou confere) a politica de TTL de uma colecao do Firestore.
 *
 * Colecoes de log crescem sozinhas e ninguem lembra delas: a
 * `whatsapp_webhook_events` chegou a 318 mil documentos / ~369 MB antes de
 * alguem olhar. Toda colecao de log nova nasce gravando `expireAt`, mas o
 * campo so vira expurgo de verdade depois que a politica de TTL e ligada --
 * e isso e configuracao de projeto, nao de codigo.
 *
 * PERMISSAO: a service account do app NAO consegue ligar (403 em
 * `datastore.indexes.update`). Para este script funcionar, a conta precisa do
 * papel "Cloud Datastore Index Admin" (roles/datastore.indexAdmin). Sem isso,
 * so pelo console do Google Cloud:
 *   https://console.cloud.google.com/firestore/databases/-default-/ttl
 * (o console do Firebase nao tem essa tela -- ele redireciona para a visao
 * geral do projeto).
 *
 * Uso:
 *   node scripts/ttl-firestore.mjs                          # lista o estado das colecoes de log
 *   node scripts/ttl-firestore.mjs <colecao>                # confere uma
 *   node scripts/ttl-firestore.mjs <colecao> --aplicar      # liga o TTL
 */
import { GoogleAuth } from 'google-auth-library';

const KEY = './studio-2243391254-75492-firebase-adminsdk-fbsvc-aaa63f07c5.json';
const PROJETO = 'studio-2243391254-75492';
const CAMPO = 'expireAt';

/** Colecoes de log que gravam `expireAt` e, portanto, esperam TTL ligado. */
const CONHECIDAS = ['whatsapp_webhook_events', 'whatsapp_send_claims', 'whatsapp_webhook_incidents'];

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const APLICAR = process.argv.includes('--aplicar');
const alvos = args.length ? args : CONHECIDAS;

const auth = new GoogleAuth({ keyFile: KEY, scopes: ['https://www.googleapis.com/auth/datastore'] });
const client = await auth.getClient();

const url = (colecao) =>
  `https://firestore.googleapis.com/v1/projects/${PROJETO}/databases/(default)/collectionGroups/${colecao}/fields/${CAMPO}`;

async function estado(colecao) {
  try {
    const r = await client.request({ url: url(colecao) });
    return r.data?.ttlConfig?.state || null;
  } catch (error) {
    return `ERRO: ${error.code || ''} ${String(error.message).slice(0, 80)}`;
  }
}

console.log(`Campo de expurgo: ${CAMPO}\n`);

for (const colecao of alvos) {
  const atual = await estado(colecao);
  console.log(`${colecao}: ${atual || '(sem TTL)'}`);

  if (!APLICAR || atual === 'ACTIVE' || atual === 'CREATING') continue;

  try {
    await client.request({
      url: `${url(colecao)}?updateMask=ttlConfig`,
      method: 'PATCH',
      data: { ttlConfig: {} },
    });
    console.log(`   -> ligado (leva alguns minutos ate ficar ACTIVE)`);
  } catch (error) {
    const proibido = String(error.code) === '403';
    console.log(`   -> FALHOU: ${error.code || ''} ${String(error.message).slice(0, 120)}`);
    if (proibido) {
      console.log('      Falta o papel roles/datastore.indexAdmin nesta service account.');
      console.log('      Ou ligue pelo console: https://console.cloud.google.com/firestore/databases/-default-/ttl');
    }
  }
}
