/**
 * Normaliza estoque negativo em menuItems (todas as lojas).
 *
 * Por que existe: estoque negativo era lido como "ilimitado" pelo app, então o
 * produto voltava a vender para sempre sem nunca abater nem aparecer esgotado.
 * O código já não deixa mais gravar negativo; este script limpa o que ficou.
 *
 * Uso:
 *   node scripts/normalizar-estoque-negativo.mjs            (dry-run)
 *   node scripts/normalizar-estoque-negativo.mjs --apply    (grava)
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const APPLY = process.argv.includes('--apply');
const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const keyFile = readdirSync(root).find((f) => /firebase-adminsdk.*\.json$/.test(f));
if (!keyFile) {
  console.error('Service account não encontrada na raiz do projeto.');
  process.exit(1);
}

initializeApp({ credential: cert(JSON.parse(readFileSync(join(root, keyFile), 'utf8'))) });
const db = getFirestore();

const snap = await db.collection('menuItems').get();
const alvos = [];
snap.forEach((d) => {
  const v = d.data();
  if (typeof v.stockQuantity === 'number' && Number.isFinite(v.stockQuantity) && v.stockQuantity < 0) {
    alvos.push({ id: d.id, name: v.name, stock: v.stockQuantity, ownerId: v.ownerId });
  }
});

console.log(`${APPLY ? 'APLICANDO' : 'DRY-RUN'} — ${snap.size} produtos varridos, ${alvos.length} com estoque negativo\n`);
for (const a of alvos) {
  console.log(`  ${a.name}: ${a.stock} -> 0   (loja ${String(a.ownerId).slice(0, 8)}, id ${a.id})`);
}

if (!alvos.length) {
  console.log('\nNada a corrigir.');
  process.exit(0);
}

if (!APPLY) {
  console.log('\nNada foi gravado. Rode de novo com --apply para corrigir.');
  process.exit(0);
}

const writer = db.bulkWriter();
for (const a of alvos) {
  writer.update(db.collection('menuItems').doc(a.id), { stockQuantity: 0 });
}
await writer.close();
console.log(`\n${alvos.length} produto(s) normalizado(s) para 0.`);
