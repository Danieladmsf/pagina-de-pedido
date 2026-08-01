#!/usr/bin/env node
/**
 * Backfills conservadores do plano de integridade.
 *
 * DRY-RUN e o comportamento padrao. Para escrever, o operador precisa informar
 * loja, campos, --apply e a confirmacao literal. O script nunca altera campo
 * ja preenchido, nunca funde clientes e usa updateTime como precondicao para
 * nao sobrescrever uma mudanca concorrente.
 *
 * Exemplos seguros:
 *   npm run migrar:integridade
 *   npm run migrar:integridade -- --owner UID --only createdAt,orderCode
 *
 * Aplicacao (executar somente depois de revisar o dry-run):
 *   npm run migrar:integridade -- --owner UID --only createdAt \
 *     --apply --confirm APLICAR_BACKFILL_INTEGRIDADE
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { planIntegrityBackfills } from './lib/integridade-core.mjs';
import { adminFirestore, loadIntegrityDataset, projectRoot } from './lib/firebase-admin-db.mjs';

const CONFIRMATION = 'APLICAR_BACKFILL_INTEGRIDADE';
const VALID_KINDS = new Set(['createdAt', 'clienteId', 'orderCode', 'legacyLinks']);

function usage() {
  console.log(`Backfills de integridade (dry-run por padrao)

Opcoes:
  --owner UID                   limita a uma loja (obrigatorio com --apply)
  --only LISTA                 createdAt,clienteId,orderCode,legacyLinks
  --json                       imprime o plano em JSON
  --all-details                mostra todas as propostas e pendencias
  --max-details N              limite por secao (padrao: 30)
  --apply                      habilita escrita; nunca e implicito
  --confirm ${CONFIRMATION}
                               segunda trava obrigatoria para --apply
  --help                       mostra esta ajuda

Sem --apply nenhuma escrita e feita. A aplicacao gera antes um manifesto em
.integridade-backups/ e usa precondicao de versao em cada documento.`);
}

function optionValue(args, index, name) {
  const current = args[index];
  if (current.startsWith(`${name}=`)) return { value: current.slice(name.length + 1), consumed: 0 };
  const value = args[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${name} exige um valor.`);
  return { value, consumed: 1 };
}

function parseArgs(argv) {
  const options = {
    apply: false,
    json: false,
    allDetails: false,
    maxDetails: 30,
    only: [...VALID_KINDS],
    onlyWasExplicit: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--apply') options.apply = true;
    else if (arg === '--json') options.json = true;
    else if (arg === '--all-details') options.allDetails = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--owner' || arg.startsWith('--owner=')) {
      const parsed = optionValue(argv, index, '--owner');
      options.ownerId = parsed.value.trim();
      index += parsed.consumed;
    } else if (arg === '--only' || arg.startsWith('--only=')) {
      const parsed = optionValue(argv, index, '--only');
      const kinds = parsed.value.split(',').map((value) => value.trim()).filter(Boolean);
      if (!kinds.length) throw new Error('--only nao pode ser vazio.');
      const invalid = kinds.filter((kind) => !VALID_KINDS.has(kind));
      if (invalid.length) throw new Error(`Backfill desconhecido em --only: ${invalid.join(', ')}`);
      options.only = [...new Set(kinds)];
      options.onlyWasExplicit = true;
      index += parsed.consumed;
    } else if (arg === '--confirm' || arg.startsWith('--confirm=')) {
      const parsed = optionValue(argv, index, '--confirm');
      options.confirm = parsed.value;
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
  if (options.apply) {
    if (!options.ownerId) throw new Error('--apply exige --owner UID; aplique uma loja por vez.');
    if (!options.onlyWasExplicit) throw new Error('--apply exige --only com os backfills revisados.');
    if (options.confirm !== CONFIRMATION) {
      throw new Error(`--apply exige --confirm ${CONFIRMATION}.`);
    }
  }
  return options;
}

function filterByOwner(dataset, ownerId) {
  if (!ownerId) return dataset;
  const clientes = dataset.clientes.filter((record) => record.data?.ownerId === ownerId);
  const customerIds = new Set(clientes.map((record) => record.id));
  const owned = (records) => records.filter((record) => record.data?.ownerId === ownerId);
  return {
    ...dataset,
    profiles: dataset.profiles.filter((record) => record.id === ownerId),
    menuItems: owned(dataset.menuItems),
    promotions: owned(dataset.promotions),
    orders: owned(dataset.orders),
    encomendas: owned(dataset.encomendas),
    clientes,
    cashRegisters: owned(dataset.cashRegisters),
    cashTransactions: owned(dataset.cashTransactions),
    creditTransactions: dataset.creditTransactions.filter((record) => customerIds.has(record.parentId)),
  };
}

function jsonSafe(value) {
  if (value instanceof Date) return value.toISOString();
  if (typeof value?.toDate === 'function') return value.toDate().toISOString();
  return value;
}

function printablePlan(plan) {
  return JSON.parse(JSON.stringify(plan, (_key, value) => jsonSafe(value)));
}

function printPlan(plan, options) {
  console.log('='.repeat(78));
  console.log(`${options.apply ? 'APLICACAO' : 'DRY-RUN'} - BACKFILLS DE INTEGRIDADE`);
  console.log('='.repeat(78));
  console.log(`Loja: ${options.ownerId || 'todas (somente leitura)'}`);
  console.log(`Escopo: ${plan.selected.join(', ')}`);
  console.log(`Documentos propostos: ${plan.summary.documents}`);
  console.log(`Campos propostos: ${plan.summary.fields}`);
  console.log('\nPROPOSTAS POR TIPO');
  for (const [kind, count] of Object.entries(plan.summary.byKind)) {
    console.log(`  ${kind.padEnd(18)} ${count}`);
  }
  console.log('\nPENDENCIAS NAO ALTERADAS');
  const skippedEntries = Object.entries(plan.summary.skippedByReason);
  if (!skippedEntries.length) console.log('  nenhuma');
  for (const [reason, count] of skippedEntries) console.log(`  ${reason.padEnd(32)} ${count}`);

  const limit = options.allDetails ? Number.POSITIVE_INFINITY : options.maxDetails;
  if (limit > 0 && plan.proposals.length) {
    console.log('\nDETALHES DAS PROPOSTAS');
    for (const proposal of plan.proposals.slice(0, limit)) {
      console.log(`  ${proposal.path} [${proposal.kinds.join(', ')}]`);
      console.log(`    ${JSON.stringify(proposal.patch, (_key, value) => jsonSafe(value))}`);
    }
    if (plan.proposals.length > limit) console.log(`  ... ${plan.proposals.length - limit} omitida(s); use --all-details.`);
  }
  if (limit > 0 && plan.skipped.length) {
    console.log('\nAMOSTRA DAS PENDENCIAS');
    for (const item of plan.skipped.slice(0, limit)) {
      const candidates = item.candidates?.length ? ` | candidatos: ${item.candidates.join(', ')}` : '';
      console.log(`  ${item.path} [${item.kind}] ${item.reason}${candidates}`);
    }
    if (plan.skipped.length > limit) console.log(`  ... ${plan.skipped.length - limit} omitida(s); use --all-details.`);
  }
}

function buildManifest(plan, dataset, options) {
  const records = new Map([
    ...dataset.orders,
    ...dataset.encomendas,
    ...dataset.cashTransactions,
    ...dataset.creditTransactions,
  ].map((record) => [record.path, record]));
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    ownerId: options.ownerId,
    kinds: [...options.only].sort(),
    rollbackNote: 'Todos os campos propostos estavam ausentes/vazios. Revise o manifesto antes de usar FieldValue.delete() para desfazer.',
    writes: plan.proposals.map((proposal) => {
      const data = records.get(proposal.path)?.data || {};
      const before = {};
      for (const field of Object.keys(proposal.patch)) {
        before[field] = Object.prototype.hasOwnProperty.call(data, field)
          ? { existed: true, value: jsonSafe(data[field]) }
          : { existed: false };
      }
      return {
        path: proposal.path,
        kinds: proposal.kinds,
        before,
        patch: JSON.parse(JSON.stringify(proposal.patch, (_key, value) => jsonSafe(value))),
        updateTime: jsonSafe(proposal.updateTime),
      };
    }),
  };
}

function writeManifest(manifest) {
  const directory = join(projectRoot(), '.integridade-backups');
  mkdirSync(directory, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const safeOwner = String(manifest.ownerId).replace(/[^A-Za-z0-9_-]/g, '_');
  const path = join(directory, `backfill-${safeOwner}-${stamp}.json`);
  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return path;
}

async function applyPlan(db, plan) {
  const withoutVersion = plan.proposals.find((proposal) => !proposal.updateTime);
  if (withoutVersion) throw new Error(`${withoutVersion.path}: updateTime indisponivel`);

  const writer = db.bulkWriter();
  writer.onWriteError((error) => {
    // FAILED_PRECONDITION significa que o documento mudou depois da leitura:
    // nao se repete, para nunca atropelar uma escrita concorrente.
    if (error.code === 9 || error.code === 'failed-precondition') return false;
    return error.failedAttempts < 3;
  });
  const writes = plan.proposals.map((proposal) => writer.update(
      db.doc(proposal.path),
      proposal.patch,
      { lastUpdateTime: proposal.updateTime },
    ).then(
      () => ({ status: 'fulfilled' }),
      (error) => ({ status: 'rejected', error }),
    ));
  await writer.close();
  const results = await Promise.all(writes);
  return {
    applied: results.filter((result) => result.status === 'fulfilled').length,
    failed: results
      .map((result, index) => ({ result, proposal: plan.proposals[index] }))
      .filter(({ result }) => result.status === 'rejected')
      .map(({ result, proposal }) => ({ path: proposal.path, error: result.error?.message || String(result.error) })),
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    usage();
    return;
  }

  const db = adminFirestore();
  const fullDataset = await loadIntegrityDataset(db);
  const dataset = filterByOwner(fullDataset, options.ownerId);
  if (options.ownerId && !dataset.profiles.length) {
    throw new Error(`Loja nao encontrada em store_profiles: ${options.ownerId}`);
  }
  const plan = planIntegrityBackfills(dataset, { only: options.only });

  if (options.json) console.log(JSON.stringify(printablePlan(plan), null, 2));
  else printPlan(plan, options);

  if (!options.apply) {
    if (!options.json) console.log('\nDRY-RUN concluido. Nenhuma escrita foi feita no Firestore.');
    return;
  }

  if (!plan.proposals.length) {
    if (!options.json) console.log('\nNada a aplicar.');
    return;
  }

  const manifestPath = writeManifest(buildManifest(plan, dataset, options));
  if (!options.json) console.log(`\nManifesto anterior a escrita: ${manifestPath}`);
  const result = await applyPlan(db, plan);
  if (!options.json) {
    console.log(`Aplicados: ${result.applied}; falhas: ${result.failed.length}.`);
    for (const failure of result.failed) console.error(`  ${failure.path}: ${failure.error}`);
  }
  if (result.failed.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`Falha no backfill: ${error?.message || error}`);
  process.exitCode = 2;
});
