#!/usr/bin/env node
/**
 * Auditoria global de integridade do Firestore (SOMENTE LEITURA).
 *
 * Uso:
 *   npm run audit:integridade
 *   npm run audit:integridade -- --json
 *   npm run audit:integridade -- --baseline docs/integridade-baseline.json
 *   npm run audit:integridade -- --write-baseline docs/integridade-baseline.json
 *
 * O comando falha (exit code 1) somente para referencia morta nova. Identidade,
 * saldo divergente, orfao e fallback textual continuam visiveis como alertas,
 * mas nao impedem o CI. Sem baseline, toda referencia morta atual e considerada
 * nova; uma baseline so deve ser criada depois de revisao humana.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import {
  auditIntegrity,
  baselineFromReport,
  compareDeadReferences,
} from './lib/integridade-core.mjs';
import { adminFirestore, loadIntegrityDataset, projectRoot } from './lib/firebase-admin-db.mjs';

function usage() {
  console.log(`Auditoria de integridade (somente leitura)

Opcoes:
  --json                       imprime JSON estavel
  --all-details                imprime todos os achados no modo texto
  --max-details N              limite de detalhes por categoria (padrao: 20)
  --baseline ARQUIVO           compara referencias mortas com uma baseline revisada
                               (docs/integridade-baseline.json e auto-detectada)
  --write-baseline ARQUIVO     grava somente as chaves atuais em arquivo local
  --no-fail                    nao devolve exit code 1 (uso exploratorio)
  --help                       mostra esta ajuda

Credenciais:
  FIRESTORE_EMULATOR_HOST, FIREBASE_SERVICE_ACCOUNT_JSON,
  GOOGLE_APPLICATION_CREDENTIALS ou *firebase-adminsdk*.json na raiz.`);
}

function optionValue(args, index, name) {
  const current = args[index];
  if (current.startsWith(`${name}=`)) return { value: current.slice(name.length + 1), consumed: 0 };
  const value = args[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${name} exige um valor.`);
  return { value, consumed: 1 };
}

function parseArgs(argv) {
  const options = { json: false, allDetails: false, maxDetails: 20, noFail: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--json') options.json = true;
    else if (arg === '--all-details') options.allDetails = true;
    else if (arg === '--no-fail') options.noFail = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--baseline' || arg.startsWith('--baseline=')) {
      const parsed = optionValue(argv, index, '--baseline');
      options.baseline = resolve(parsed.value);
      index += parsed.consumed;
    } else if (arg === '--write-baseline' || arg.startsWith('--write-baseline=')) {
      const parsed = optionValue(argv, index, '--write-baseline');
      options.writeBaseline = resolve(parsed.value);
      index += parsed.consumed;
    } else if (arg === '--max-details' || arg.startsWith('--max-details=')) {
      const parsed = optionValue(argv, index, '--max-details');
      options.maxDetails = Number.parseInt(parsed.value, 10);
      if (!Number.isInteger(options.maxDetails) || options.maxDetails < 0) {
        throw new Error('--max-details precisa ser um inteiro >= 0.');
      }
      index += parsed.consumed;
    } else {
      throw new Error(`Opcao desconhecida: ${arg}`);
    }
  }
  return options;
}

function readBaseline(path) {
  if (!path) return null;
  if (!existsSync(path)) throw new Error(`Baseline nao encontrada: ${path}`);
  const parsed = JSON.parse(readFileSync(path, 'utf8'));
  if (!Array.isArray(parsed?.deadReferenceKeys)) {
    throw new Error('Baseline invalida: deadReferenceKeys precisa ser um array.');
  }
  return parsed;
}

function ownerNameMap(dataset) {
  return new Map(dataset.profiles.map((profile) => [
    profile.id,
    profile.data?.general?.name || profile.data?.name || profile.id,
  ]));
}

function printTextReport(report, dataset, comparison, options) {
  const line = '='.repeat(78);
  console.log(line);
  console.log('AUDITORIA DE INTEGRIDADE - SOMENTE LEITURA');
  console.log(line);

  console.log('\nDOCUMENTOS LIDOS POR COLECAO');
  for (const [collection, count] of Object.entries(report.collections)) {
    const issues = report.summary.bySourceCollection[collection] || 0;
    console.log(`  ${collection.padEnd(22)} ${String(count).padStart(7)} documento(s) | ${issues} alerta(s)`);
  }

  console.log('\nRESUMO DOS ACHADOS');
  const categoryLabels = {
    dead_reference: 'referencias mortas',
    orphan: 'orfaos',
    text_link: 'vinculos por texto/sem id',
    identity: 'identidade',
    balance: 'saldo divergente',
  };
  for (const [category, label] of Object.entries(categoryLabels)) {
    console.log(`  ${label.padEnd(28)} ${report.summary.byCategory[category] || 0}`);
  }

  const textByYear = new Map();
  for (const issue of report.issues.filter((item) => item.category === 'text_link')) {
    const key = `${issue.kind}|${issue.year ?? 'sem-data'}`;
    textByYear.set(key, (textByYear.get(key) || 0) + 1);
  }
  if (textByYear.size) {
    console.log('\nVINCULOS TEXTUAIS POR TIPO E ANO');
    for (const [key, count] of [...textByYear].sort(([a], [b]) => a.localeCompare(b, 'pt-BR'))) {
      const [kind, year] = key.split('|');
      console.log(`  ${kind.padEnd(38)} ${year}: ${count}`);
    }
  }

  const names = ownerNameMap(dataset);
  const owners = new Map();
  for (const issue of report.issues) {
    const ownerId = issue.ownerId || 'sem-owner';
    if (!owners.has(ownerId)) owners.set(ownerId, {});
    const counts = owners.get(ownerId);
    counts[issue.category] = (counts[issue.category] || 0) + 1;
  }
  console.log('\nRESUMO POR LOJA');
  for (const [ownerId, counts] of [...owners].sort(([a], [b]) => a.localeCompare(b, 'pt-BR'))) {
    const name = names.get(ownerId) || ownerId;
    const detail = Object.entries(counts).map(([category, count]) => `${category}=${count}`).join(', ');
    console.log(`  ${name} (${ownerId}): ${detail}`);
  }
  if (!owners.size) console.log('  nenhuma loja com alerta');

  const maxDetails = options.allDetails ? Number.POSITIVE_INFINITY : options.maxDetails;
  for (const category of Object.keys(categoryLabels)) {
    const categoryIssues = report.issues.filter((issue) => issue.category === category);
    if (!categoryIssues.length || maxDetails === 0) continue;
    console.log(`\nDETALHES - ${categoryLabels[category].toUpperCase()}`);
    for (const issue of categoryIssues.slice(0, maxDetails)) {
      const target = issue.targetPath ? ` -> ${issue.targetPath}` : '';
      console.log(`  [${issue.kind}] ${issue.sourcePath}${target}`);
      if (issue.detail) console.log(`    ${issue.detail}`);
    }
    if (categoryIssues.length > maxDetails) {
      console.log(`  ... ${categoryIssues.length - maxDetails} omitido(s); use --all-details.`);
    }
  }

  console.log('\nGUARDRAIL');
  console.log(`  referencias mortas atuais: ${report.guardrail.deadReferenceKeys.length}`);
  console.log(`  referencias mortas novas:  ${comparison.newKeys.length}`);
  console.log(`  referencias resolvidas:    ${comparison.resolvedKeys.length}`);
  if (!options.baseline && !options.writeBaseline) {
    console.log('  sem baseline: toda referencia morta atual conta como nova');
  }
  console.log('\nNenhuma escrita foi feita no Firestore.');
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    usage();
    return;
  }

  // Depois de criada e revisada, esta baseline passa a ser usada
  // automaticamente pelo `npm run audit:integridade` no CI.
  const defaultBaseline = join(projectRoot(), 'docs', 'integridade-baseline.json');
  if (!options.baseline && !options.writeBaseline && existsSync(defaultBaseline)) {
    options.baseline = defaultBaseline;
  }

  const db = adminFirestore();
  const dataset = await loadIntegrityDataset(db);
  const report = auditIntegrity(dataset);

  let baseline = readBaseline(options.baseline);
  if (options.writeBaseline) {
    const output = baselineFromReport(report);
    mkdirSync(dirname(options.writeBaseline), { recursive: true });
    writeFileSync(options.writeBaseline, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
    baseline = output;
  }
  const comparison = compareDeadReferences(report, baseline || { deadReferenceKeys: [] });

  if (options.json) {
    console.log(JSON.stringify({
      ...report,
      baseline: {
        used: Boolean(options.baseline || options.writeBaseline),
        newDeadReferenceKeys: comparison.newKeys,
        resolvedDeadReferenceKeys: comparison.resolvedKeys,
      },
    }, null, 2));
  } else {
    printTextReport(report, dataset, comparison, options);
    if (options.writeBaseline) console.log(`Baseline local gravada em: ${options.writeBaseline}`);
  }

  if (!options.noFail && comparison.newKeys.length > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`Falha ao executar a auditoria: ${error?.message || error}`);
  process.exitCode = 2;
});
