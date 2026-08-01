import { createHash } from 'node:crypto';

/**
 * Regras puras da auditoria e dos backfills de integridade.
 *
 * Este modulo nao abre conexao com o Firestore. Manter a analise separada da
 * leitura/escrita permite testar as decisoes que podem afetar dados historicos.
 */

const EPSILON = 0.009;
const COMBINING_MARKS = /[\u0300-\u036f]/g;

export function normalizePhone(value) {
  const digits = String(value ?? '').replace(/\D/g, '');
  return digits.replace(/^55(?=\d{10,11}$)/, '');
}

export function isValidPhone(value) {
  const phone = normalizePhone(value);
  return phone.length === 10 || phone.length === 11;
}

export function normalizeName(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(COMBINING_MARKS, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export function legacyReference(value) {
  const match = String(value ?? '').match(/#([A-Za-z0-9]+)/);
  return match?.[1] || '';
}

export function toMillis(value) {
  if (!value) return NaN;
  if (value instanceof Date) return value.getTime();
  if (typeof value?.toMillis === 'function') return value.toMillis();
  if (typeof value?.toDate === 'function') return value.toDate().getTime();
  if (typeof value === 'object' && Number.isFinite(value._seconds)) {
    return value._seconds * 1000 + (Number(value._nanoseconds) || 0) / 1e6;
  }
  if (typeof value === 'number') {
    // Datas Firestore costumam estar em ms; aceita epoch em segundos tambem.
    return value > 0 && value < 10_000_000_000 ? value * 1000 : value;
  }
  const parsed = Date.parse(String(value));
  return Number.isNaN(parsed) ? NaN : parsed;
}

export function yearOf(value) {
  const millis = toMillis(value);
  return Number.isFinite(millis) ? new Date(millis).getUTCFullYear() : 'sem-data';
}

function dataOf(record) {
  return record?.data && typeof record.data === 'object' ? record.data : {};
}

function pathOf(record, fallbackCollection = 'desconhecido') {
  return record?.path || `${fallbackCollection}/${record?.id || '?'}`;
}

function ownerOf(record) {
  const ownerId = dataOf(record).ownerId;
  return typeof ownerId === 'string' && ownerId.trim() ? ownerId.trim() : '';
}

function collectionOfPath(path) {
  const parts = String(path || '').split('/');
  if (parts.includes('credit_transactions')) return 'credit_transactions';
  return parts[0] || 'desconhecido';
}

function indexById(records = []) {
  return new Map(records.map((record) => [record.id, record]));
}

function stableKey(issue) {
  return [
    issue.category,
    issue.kind,
    issue.ownerId || 'sem-owner',
    issue.sourcePath || '',
    issue.field || '',
    issue.targetPath || '',
    issue.groupKey || '',
  ].join('|');
}

function guardrailKey(issue) {
  // A chave bruta pode conter paths determinísticos com telefone. O relatório
  // local mantém o diagnóstico, mas baseline/CI recebem somente o hash estável.
  return createHash('sha256').update(stableKey(issue)).digest('hex');
}

function sortIssues(issues) {
  return issues.sort((a, b) => stableKey(a).localeCompare(stableKey(b), 'pt-BR'));
}

function issueCounter(issues, field) {
  const counts = {};
  for (const issue of issues) {
    const key = issue[field] || 'desconhecido';
    counts[key] = (counts[key] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b, 'pt-BR')));
}

function sameOwner(sourceOwner, target) {
  const targetOwner = ownerOf(target);
  return !sourceOwner || !targetOwner || sourceOwner === targetOwner;
}

/**
 * Analisa snapshots ja carregados. Um registro tem o formato
 * `{ id, path, data, parentId? }`.
 */
export function auditIntegrity(input) {
  const profiles = input.profiles || [];
  const menuItems = input.menuItems || [];
  const promotions = input.promotions || [];
  const orders = input.orders || [];
  const encomendas = input.encomendas || [];
  const clientes = input.clientes || [];
  const cashRegisters = input.cashRegisters || [];
  const cashTransactions = input.cashTransactions || [];
  const creditTransactions = input.creditTransactions || [];
  const requestedNow = toMillis(input.now);
  const auditNow = Number.isFinite(requestedNow) ? requestedNow : Date.now();

  const profileIds = new Set(profiles.map((record) => record.id));
  const menuById = indexById(menuItems);
  const orderById = indexById(orders);
  const encomendaById = indexById(encomendas);
  const customerById = indexById(clientes);
  const registerById = indexById(cashRegisters);
  const creditByCustomerAndId = new Map(creditTransactions.map((transaction) => {
    const customerId = transaction.parentId || String(pathOf(transaction)).split('/')[1] || '';
    return [`${customerId}/${transaction.id}`, transaction];
  }));
  const cashCreditKeys = new Set(cashTransactions
    .map((transaction) => dataOf(transaction))
    .filter((data) => data.clienteId && data.creditTxId)
    .map((data) => `${data.clienteId}/${data.creditTxId}`));
  const issues = [];

  const addIssue = (issue) => {
    const normalized = {
      severity: issue.category === 'dead_reference' ? 'error' : 'warning',
      ...issue,
    };
    normalized.key = stableKey(normalized);
    issues.push(normalized);
  };

  const reportArchivedCustomerUse = ({ source, sourceOwner, field, customerId }) => {
    if (!customerId) return;
    const customer = customerById.get(customerId);
    const customerData = dataOf(customer);
    if (customerData.archived !== true) return;
    const archivedAt = toMillis(customerData.archivedAt);
    const usedAt = sourceTime(source);
    // Um vinculo historico anterior ao arquivamento e legitimo. So sinalizamos
    // uso comprovadamente posterior; sem as duas datas nao se adivinha.
    if (!Number.isFinite(archivedAt) || !Number.isFinite(usedAt) || usedAt <= archivedAt) return;
    addIssue({
      category: 'identity',
      kind: 'vinculo_cliente_arquivado_posterior',
      ownerId: sourceOwner,
      sourcePath: pathOf(source),
      field,
      targetPath: pathOf(customer, 'clientes'),
      detail: 'registro criado depois de o cliente ter sido arquivado',
    });
  };

  const validateReference = ({
    source,
    sourceOwner,
    field,
    targetId,
    targetMap,
    targetCollection,
    kind,
    category = 'dead_reference',
    missingCategory = category,
    missingKind = kind,
  }) => {
    if (!targetId) return;
    const target = targetMap.get(targetId);
    const targetPath = `${targetCollection}/${targetId}`;
    if (!target) {
      addIssue({
        category: missingCategory,
        kind: missingKind,
        ownerId: sourceOwner,
        sourcePath: pathOf(source),
        field,
        targetPath,
        detail: 'documento de destino nao existe',
      });
      return;
    }
    if (!sameOwner(sourceOwner, target)) {
      addIssue({
        category,
        kind: `${kind}_outra_loja`,
        ownerId: sourceOwner,
        sourcePath: pathOf(source),
        field,
        targetPath: pathOf(target, targetCollection),
        detail: `destino pertence a outra loja (${ownerOf(target)})`,
      });
    }
  };

  // Promocao/combo -> produto.
  for (const promotion of promotions) {
    const data = dataOf(promotion);
    const sourceOwner = ownerOf(promotion);
    for (const [index, item] of (Array.isArray(data.items) ? data.items : []).entries()) {
      validateReference({
        source: promotion,
        sourceOwner,
        field: `items[${index}].menuItemId`,
        targetId: item?.menuItemId,
        targetMap: menuById,
        targetCollection: 'menuItems',
        kind: 'promocao_produto',
      });
    }
  }

  for (const combo of menuItems) {
    const data = dataOf(combo);
    if (!data.isCombo && !Array.isArray(data.comboItems)) continue;
    const sourceOwner = ownerOf(combo);
    for (const [index, item] of (Array.isArray(data.comboItems) ? data.comboItems : []).entries()) {
      validateReference({
        source: combo,
        sourceOwner,
        field: `comboItems[${index}].itemId`,
        targetId: item?.itemId,
        targetMap: menuById,
        targetCollection: 'menuItems',
        kind: 'combo_produto',
      });
    }
  }

  // Pedido -> item do menu / cliente / loja.
  for (const order of orders) {
    const data = dataOf(order);
    const sourceOwner = ownerOf(order);
    if (!sourceOwner || !profileIds.has(sourceOwner)) {
      addIssue({
        category: 'orphan',
        kind: 'pedido_owner_invalido',
        ownerId: sourceOwner,
        sourcePath: pathOf(order, 'orders'),
        field: 'ownerId',
        detail: sourceOwner ? 'store_profiles da loja nao existe' : 'ownerId ausente',
      });
    }

    validateReference({
      source: order,
      sourceOwner,
      field: 'clienteId',
      targetId: data.clienteId,
      targetMap: customerById,
      targetCollection: 'clientes',
      kind: 'pedido_cliente',
      missingCategory: data.customerIdentityPending === true
        && Number.isFinite(sourceTime(order))
        && auditNow - sourceTime(order) >= 0
        && auditNow - sourceTime(order) <= 24 * 60 * 60 * 1000
        ? 'identity'
        : 'dead_reference',
      missingKind: data.customerIdentityPending === true
        && Number.isFinite(sourceTime(order))
        && auditNow - sourceTime(order) >= 0
        && auditNow - sourceTime(order) <= 24 * 60 * 60 * 1000
        ? 'pedido_cliente_pendente'
        : 'pedido_cliente',
    });
    reportArchivedCustomerUse({ source: order, sourceOwner, field: 'clienteId', customerId: data.clienteId });

    for (const [index, item] of (Array.isArray(data.items) ? data.items : []).entries()) {
      const itemId = item?.menuItemId || item?.id;
      validateReference({
        source: order,
        sourceOwner,
        field: `items[${index}].id`,
        targetId: itemId,
        targetMap: menuById,
        targetCollection: 'menuItems',
        kind: 'pedido_produto',
        // Itens do pedido sao snapshots (nome/preco/quantidade ficam no
        // proprio pedido). Produto removido e historico, nao FK viva capaz de
        // quebrar a operacao ou o guardrail.
        category: 'orphan',
      });
      for (const [comboIndex, component] of (Array.isArray(item?.comboItems) ? item.comboItems : []).entries()) {
        validateReference({
          source: order,
          sourceOwner,
          field: `items[${index}].comboItems[${comboIndex}].itemId`,
          targetId: component?.itemId,
          targetMap: menuById,
          targetCollection: 'menuItems',
          kind: 'pedido_componente_combo',
          category: 'orphan',
        });
      }
    }

    if (!data.clienteId) {
      const phone = normalizePhone(data.customerPhone || data.customerIdentifier);
      const mode = isValidPhone(phone) ? 'telefone' : (normalizeName(data.customerName) ? 'nome' : 'sem_identidade');
      addIssue({
        category: 'text_link',
        kind: `pedido_cliente_${mode}`,
        ownerId: sourceOwner,
        sourcePath: pathOf(order, 'orders'),
        field: mode === 'telefone' ? 'customerPhone' : 'customerName',
        year: yearOf(data.createdAt || data.orderDateTime),
        detail: 'pedido ainda nao guarda clienteId',
      });
    }

    const rawPhone = String(data.customerPhone || data.customerIdentifier || '').trim();
    if (rawPhone && !/\d/.test(rawPhone)) {
      addIssue({
        category: 'identity',
        kind: 'pedido_telefone_nao_numerico',
        ownerId: sourceOwner,
        sourcePath: pathOf(order, 'orders'),
        field: 'customerPhone',
        detail: `valor sem digitos: ${JSON.stringify(rawPhone)}`,
      });
    } else if (rawPhone && !isValidPhone(rawPhone)) {
      addIssue({
        category: 'identity',
        kind: 'pedido_telefone_invalido',
        ownerId: sourceOwner,
        sourcePath: pathOf(order, 'orders'),
        field: 'customerPhone',
        detail: `${normalizePhone(rawPhone).length} digitos apos normalizacao`,
      });
    }
  }

  // Encomenda -> cliente / loja. Itens de encomenda sao snapshots do catalogo
  // proprio e nao devem ser confundidos com menuItems.
  for (const encomenda of encomendas) {
    const data = dataOf(encomenda);
    const sourceOwner = ownerOf(encomenda);
    if (!sourceOwner || !profileIds.has(sourceOwner)) {
      addIssue({
        category: 'orphan',
        kind: 'encomenda_owner_invalido',
        ownerId: sourceOwner,
        sourcePath: pathOf(encomenda, 'encomendas'),
        field: 'ownerId',
        detail: sourceOwner ? 'store_profiles da loja nao existe' : 'ownerId ausente',
      });
    }
    validateReference({
      source: encomenda,
      sourceOwner,
      field: 'clienteId',
      targetId: data.clienteId,
      targetMap: customerById,
      targetCollection: 'clientes',
      kind: 'encomenda_cliente',
      missingCategory: data.customerIdentityPending === true
        && Number.isFinite(sourceTime(encomenda))
        && auditNow - sourceTime(encomenda) >= 0
        && auditNow - sourceTime(encomenda) <= 24 * 60 * 60 * 1000
        ? 'identity'
        : 'dead_reference',
      missingKind: data.customerIdentityPending === true
        && Number.isFinite(sourceTime(encomenda))
        && auditNow - sourceTime(encomenda) >= 0
        && auditNow - sourceTime(encomenda) <= 24 * 60 * 60 * 1000
        ? 'encomenda_cliente_pendente'
        : 'encomenda_cliente',
    });
    reportArchivedCustomerUse({ source: encomenda, sourceOwner, field: 'clienteId', customerId: data.clienteId });
    const hasHumanIdentity = Boolean(
      data.clienteId || data.customerUid || normalizeName(data.customerName) || normalizePhone(data.customerPhone),
    );
    if (!hasHumanIdentity) {
      addIssue({
        category: 'orphan',
        kind: 'encomenda_sem_cliente',
        ownerId: sourceOwner,
        sourcePath: pathOf(encomenda, 'encomendas'),
        detail: 'sem clienteId, customerUid, nome ou telefone',
      });
    }
    if (!data.clienteId) {
      const mode = isValidPhone(data.customerPhone) ? 'telefone' : (normalizeName(data.customerName) ? 'nome' : 'sem_identidade');
      addIssue({
        category: 'text_link',
        kind: `encomenda_cliente_${mode}`,
        ownerId: sourceOwner,
        sourcePath: pathOf(encomenda, 'encomendas'),
        field: mode === 'telefone' ? 'customerPhone' : 'customerName',
        year: yearOf(data.createdAt || data.orderDateTime),
        detail: 'encomenda ainda nao guarda clienteId',
      });
    }
  }

  // Caixa -> sessao / pedido / encomenda / cliente.
  for (const transaction of cashTransactions) {
    const data = dataOf(transaction);
    const sourceOwner = ownerOf(transaction);
    if (!data.caixaId) {
      addIssue({
        category: 'dead_reference',
        kind: 'caixa_sessao_ausente',
        ownerId: sourceOwner,
        sourcePath: pathOf(transaction, 'cash_transactions'),
        field: 'caixaId',
        detail: 'lancamento nao informa a sessao de caixa',
      });
    }
    validateReference({
      source: transaction,
      sourceOwner,
      field: 'caixaId',
      targetId: data.caixaId,
      targetMap: registerById,
      targetCollection: 'cash_registers',
      kind: 'caixa_sessao',
    });
    validateReference({
      source: transaction,
      sourceOwner,
      field: 'orderId',
      targetId: data.orderId,
      targetMap: orderById,
      targetCollection: 'orders',
      kind: 'caixa_pedido',
    });
    validateReference({
      source: transaction,
      sourceOwner,
      field: 'encomendaId',
      targetId: data.encomendaId,
      targetMap: encomendaById,
      targetCollection: 'encomendas',
      kind: 'caixa_encomenda',
    });
    validateReference({
      source: transaction,
      sourceOwner,
      field: 'clienteId',
      targetId: data.clienteId,
      targetMap: customerById,
      targetCollection: 'clientes',
      kind: 'caixa_cliente',
    });
    reportArchivedCustomerUse({ source: transaction, sourceOwner, field: 'clienteId', customerId: data.clienteId });

    // O lançamento de acerto no caixa e o crédito do extrato formam uma
    // operação única. O id da subcoleção só é válido dentro do cliente indicado.
    if (data.creditTxId) {
      if (!data.clienteId) {
        addIssue({
          category: 'dead_reference',
          kind: 'caixa_prazo_cliente_ausente',
          ownerId: sourceOwner,
          sourcePath: pathOf(transaction, 'cash_transactions'),
          field: 'creditTxId',
          detail: 'creditTxId exige clienteId para localizar o extrato',
        });
      } else {
        const targetPath = `clientes/${data.clienteId}/credit_transactions/${data.creditTxId}`;
        const creditTransaction = creditByCustomerAndId.get(`${data.clienteId}/${data.creditTxId}`);
        if (!creditTransaction) {
          addIssue({
            category: 'dead_reference',
            kind: 'caixa_prazo_transacao',
            ownerId: sourceOwner,
            sourcePath: pathOf(transaction, 'cash_transactions'),
            field: 'creditTxId',
            targetPath,
            detail: 'credito do acerto nao existe no extrato deste cliente',
          });
        } else if (dataOf(creditTransaction).type !== 'credit') {
          addIssue({
            category: 'dead_reference',
            kind: 'caixa_prazo_transacao_tipo',
            ownerId: sourceOwner,
            sourcePath: pathOf(transaction, 'cash_transactions'),
            field: 'creditTxId',
            targetPath,
            detail: 'acerto deve apontar para uma transacao do tipo credit',
          });
        }
      }
    }

    if (
      data.tipo === 'venda'
      && !data.orderId
      && !data.encomendaId
      && !(data.clienteId && data.creditTxId)
    ) {
      const ref = legacyReference(data.titulo);
      addIssue({
        category: 'text_link',
        kind: ref ? 'caixa_pedido_prefixo' : 'caixa_venda_sem_vinculo',
        ownerId: sourceOwner,
        sourcePath: pathOf(transaction, 'cash_transactions'),
        field: 'titulo',
        year: yearOf(data.data),
        detail: ref ? `prefixo #${ref}` : 'venda antiga sem id nem prefixo',
      });
    }
  }

  // Extrato do Prazo -> cliente / pedido / encomenda.
  const creditsByCustomer = new Map();
  for (const transaction of creditTransactions) {
    const data = dataOf(transaction);
    const customerId = transaction.parentId || String(pathOf(transaction)).split('/')[1] || '';
    const customer = customerById.get(customerId);
    const sourceOwner = customer ? ownerOf(customer) : '';
    if (!creditsByCustomer.has(customerId)) creditsByCustomer.set(customerId, []);
    creditsByCustomer.get(customerId).push(transaction);

    if (!customer) {
      addIssue({
        category: 'orphan',
        kind: 'extrato_cliente_inexistente',
        ownerId: '',
        sourcePath: pathOf(transaction, 'credit_transactions'),
        targetPath: `clientes/${customerId}`,
        detail: 'subcolecao existe, mas o cadastro pai nao existe',
      });
    } else {
      reportArchivedCustomerUse({ source: transaction, sourceOwner, field: 'parent', customerId });
    }
    if (
      data.channel === 'acerto'
      && !dataOf(customer).mergedInto
      && !cashCreditKeys.has(`${customerId}/${transaction.id}`)
    ) {
      addIssue({
        category: 'dead_reference',
        kind: 'prazo_acerto_sem_caixa',
        ownerId: sourceOwner,
        sourcePath: pathOf(transaction, 'credit_transactions'),
        field: 'channel',
        detail: 'credito de acerto nao possui o lancamento correspondente no caixa',
      });
    }
    validateReference({
      source: transaction,
      sourceOwner,
      field: 'orderId',
      targetId: data.orderId,
      targetMap: orderById,
      targetCollection: 'orders',
      kind: 'prazo_pedido',
    });
    validateReference({
      source: transaction,
      sourceOwner,
      field: 'encomendaId',
      targetId: data.encomendaId,
      targetMap: encomendaById,
      targetCollection: 'encomendas',
      kind: 'prazo_encomenda',
    });

    if (data.type === 'debit' && !data.orderId && !data.encomendaId) {
      const ref = legacyReference(data.description);
      addIssue({
        category: 'text_link',
        kind: ref ? 'prazo_pedido_prefixo' : 'prazo_debito_sem_vinculo',
        ownerId: sourceOwner,
        sourcePath: pathOf(transaction, 'credit_transactions'),
        field: 'description',
        year: yearOf(data.date),
        detail: ref ? `prefixo #${ref}` : 'debito sem id nem prefixo',
      });
    }
  }

  // Unificacao de clientes cria um novo vinculo entre documentos. O cadastro
  // de origem fica arquivado, mas seu extrato continua existindo e o destino
  // precisa permanecer valido.
  for (const customer of clientes) {
    const data = dataOf(customer);
    const sourceOwner = ownerOf(customer);
    validateReference({
      source: customer,
      sourceOwner,
      field: 'mergedInto',
      targetId: data.mergedInto,
      targetMap: customerById,
      targetCollection: 'clientes',
      kind: 'cliente_unificacao_destino',
    });
    if (data.mergedInto === customer.id) {
      addIssue({
        category: 'identity',
        kind: 'cliente_unificacao_para_si',
        ownerId: sourceOwner,
        sourcePath: pathOf(customer, 'clientes'),
        field: 'mergedInto',
        targetPath: pathOf(customer, 'clientes'),
        detail: 'mergedInto nao pode apontar para o proprio cadastro',
      });
    }
    const mergeTarget = customerById.get(data.mergedInto);
    if (mergeTarget && data.mergedInto !== customer.id && dataOf(mergeTarget).archived === true) {
      addIssue({
        category: 'identity',
        kind: 'cliente_unificacao_destino_arquivado',
        ownerId: sourceOwner,
        sourcePath: pathOf(customer, 'clientes'),
        field: 'mergedInto',
        targetPath: pathOf(mergeTarget, 'clientes'),
        detail: 'unificacao aponta para outro cliente arquivado',
      });
    }
  }

  // Identidade dos clientes.
  const phones = new Map();
  const namesWithoutPhone = new Map();
  for (const customer of clientes) {
    const data = dataOf(customer);
    // Arquivados continuam no calculo de saldo e nas validacoes de referencia,
    // mas nao voltam para a fila de conflitos ativos/campanhas.
    if (data.archived === true) continue;
    const sourceOwner = ownerOf(customer);
    const phone = normalizePhone(data.celular);
    if (phone && !isValidPhone(phone)) {
      addIssue({
        category: 'identity',
        kind: 'cliente_telefone_invalido',
        ownerId: sourceOwner,
        sourcePath: pathOf(customer, 'clientes'),
        field: 'celular',
        detail: `${phone.length} digitos apos normalizacao`,
      });
    }
    if (isValidPhone(phone)) {
      const key = `${sourceOwner}\u0000${phone}`;
      if (!phones.has(key)) phones.set(key, []);
      phones.get(key).push(customer);
    } else if (!phone) {
      const name = normalizeName(data.nome);
      if (name) {
        const key = `${sourceOwner}\u0000${name}`;
        if (!namesWithoutPhone.has(key)) namesWithoutPhone.set(key, []);
        namesWithoutPhone.get(key).push(customer);
      }
    }
  }

  for (const [groupKey, records] of phones) {
    if (records.length < 2) continue;
    const [ownerId, phone] = groupKey.split('\u0000');
    addIssue({
      category: 'identity',
      kind: 'cliente_telefone_duplicado',
      ownerId,
      sourcePath: pathOf(records[0], 'clientes'),
      groupKey: phone,
      paths: records.map((record) => pathOf(record, 'clientes')).sort(),
      detail: `${records.length} cadastros com o telefone normalizado ${phone}`,
    });
  }

  for (const [groupKey, records] of namesWithoutPhone) {
    if (records.length < 2) continue;
    const [ownerId, name] = groupKey.split('\u0000');
    addIssue({
      category: 'identity',
      kind: 'cliente_nome_duplicado_sem_telefone',
      ownerId,
      sourcePath: pathOf(records[0], 'clientes'),
      groupKey: name,
      paths: records.map((record) => pathOf(record, 'clientes')).sort(),
      detail: `${records.length} cadastros sem telefone com o mesmo nome normalizado`,
    });
  }

  // Saldo: o extrato e a fonte de verdade; creditBalance e somente contador.
  for (const customer of clientes) {
    const data = dataOf(customer);
    const transactions = creditsByCustomer.get(customer.id) || [];
    const statementBalance = transactions.reduce((total, transaction) => {
      const tx = dataOf(transaction);
      const amount = Number(tx.amount) || 0;
      if (tx.type === 'debit') return total + amount;
      if (tx.type === 'credit') return total - amount;
      return total;
    }, 0);
    const storedBalance = Number(data.creditBalance) || 0;
    if (Math.abs(storedBalance - statementBalance) > EPSILON) {
      addIssue({
        category: 'balance',
        kind: 'cliente_saldo_divergente',
        ownerId: ownerOf(customer),
        sourcePath: pathOf(customer, 'clientes'),
        field: 'creditBalance',
        detail: `cadastro=${storedBalance.toFixed(2)} extrato=${statementBalance.toFixed(2)} diferenca=${(storedBalance - statementBalance).toFixed(2)}`,
      });
    }
  }

  sortIssues(issues);
  const collections = {
    store_profiles: profiles.length,
    menuItems: menuItems.length,
    promotions: promotions.length,
    orders: orders.length,
    encomendas: encomendas.length,
    clientes: clientes.length,
    cash_registers: cashRegisters.length,
    cash_transactions: cashTransactions.length,
    credit_transactions: creditTransactions.length,
  };
  const bySourceCollection = {};
  for (const issue of issues) {
    const collection = collectionOfPath(issue.sourcePath);
    bySourceCollection[collection] = (bySourceCollection[collection] || 0) + 1;
  }

  return {
    schemaVersion: 1,
    collections,
    summary: {
      stores: profiles.length,
      issues: issues.length,
      byCategory: issueCounter(issues, 'category'),
      byKind: issueCounter(issues, 'kind'),
      bySourceCollection: Object.fromEntries(
        Object.entries(bySourceCollection).sort(([a], [b]) => a.localeCompare(b, 'pt-BR')),
      ),
    },
    issues,
    guardrail: {
      deadReferenceKeys: issues
        .filter((issue) => issue.category === 'dead_reference')
        .map((issue) => guardrailKey(issue))
        .sort(),
    },
  };
}

export function baselineFromReport(report) {
  return {
    schemaVersion: 1,
    deadReferenceKeys: [...(report?.guardrail?.deadReferenceKeys || [])].sort(),
  };
}

export function compareDeadReferences(report, baseline) {
  const current = new Set(report?.guardrail?.deadReferenceKeys || []);
  const known = new Set(
    Array.isArray(baseline)
      ? baseline
      : (baseline?.deadReferenceKeys || baseline?.guardrail?.deadReferenceKeys || []),
  );
  return {
    newKeys: [...current].filter((key) => !known.has(key)).sort(),
    resolvedKeys: [...known].filter((key) => !current.has(key)).sort(),
  };
}

function makePhoneIndex(customers) {
  const index = new Map();
  for (const customer of customers) {
    if (dataOf(customer).archived === true) continue;
    const ownerId = ownerOf(customer);
    const phone = normalizePhone(dataOf(customer).celular);
    if (!ownerId || !isValidPhone(phone)) continue;
    const key = `${ownerId}\u0000${phone}`;
    if (!index.has(key)) index.set(key, []);
    index.get(key).push(customer);
  }
  return index;
}

function orderTime(record) {
  const data = dataOf(record);
  const created = toMillis(data.createdAt);
  if (Number.isFinite(created)) return created;
  return toMillis(data.orderDateTime);
}

function sourceTime(record) {
  const data = dataOf(record);
  return toMillis(data.data || data.date || data.createdAt || data.orderDateTime);
}

function matchesLegacyCode(record, prefix) {
  const data = dataOf(record);
  const values = [record.id, data.orderCode]
    .filter((value) => typeof value === 'string' && value);
  return values.some((value) => value.startsWith(prefix));
}

/**
 * Devolve um destino somente quando o prefixo e inequivoco para a mesma loja
 * e o destino ja existia na data do lancamento. Candidato sem data torna a
 * decisao insegura e bloqueia o backfill.
 */
export function uniqueLegacyTarget({ source, ownerId, prefix, candidates }) {
  const at = sourceTime(source);
  if (!ownerId) return { target: null, reason: 'ownerId_indisponivel', candidates: [] };
  if (!prefix) return { target: null, reason: 'prefixo_ausente', candidates: [] };
  if (!Number.isFinite(at)) return { target: null, reason: 'data_lancamento_invalida', candidates: [] };

  const matching = candidates.filter(
    (candidate) => ownerOf(candidate) === ownerId && matchesLegacyCode(candidate, prefix),
  );
  const withoutDate = matching.filter((candidate) => !Number.isFinite(orderTime(candidate)));
  if (withoutDate.length) {
    return {
      target: null,
      reason: 'candidato_sem_data',
      candidates: matching.map((candidate) => pathOf(candidate)).sort(),
    };
  }
  const eligible = matching.filter((candidate) => orderTime(candidate) <= at);
  if (eligible.length !== 1) {
    return {
      target: null,
      reason: eligible.length ? 'prefixo_ambiguo' : (matching.length ? 'somente_pedido_futuro' : 'prefixo_sem_destino'),
      candidates: eligible.map((candidate) => pathOf(candidate)).sort(),
    };
  }
  return { target: eligible[0], reason: 'unico_anterior_ao_lancamento', candidates: [pathOf(eligible[0])] };
}

/**
 * Planeja backfills conservadores. Nunca altera um campo existente e nunca
 * tenta corrigir telefone/nome ou fundir clientes.
 */
export function planIntegrityBackfills(input, options = {}) {
  const orders = input.orders || [];
  const encomendas = input.encomendas || [];
  const clientes = input.clientes || [];
  const cashTransactions = input.cashTransactions || [];
  const creditTransactions = input.creditTransactions || [];
  const selected = new Set(options.only || ['createdAt', 'clienteId', 'orderCode', 'legacyLinks']);
  const customerById = indexById(clientes);
  const phoneIndex = makePhoneIndex(clientes);
  const proposalsByPath = new Map();
  const skipped = [];

  const skip = (kind, record, reason, extra = {}) => skipped.push({
    kind,
    path: pathOf(record),
    ownerId: ownerOf(record),
    reason,
    ...extra,
  });

  const propose = (kind, record, patch, reason, explicitOwnerId) => {
    const path = pathOf(record);
    const current = proposalsByPath.get(path) || {
      path,
      ownerId: explicitOwnerId ?? ownerOf(record),
      kinds: [],
      patch: {},
      updateTime: record.updateTime,
    };
    current.kinds.push(kind);
    Object.assign(current.patch, patch);
    current.reason = current.reason ? `${current.reason}; ${reason}` : reason;
    proposalsByPath.set(path, current);
  };

  if (selected.has('createdAt')) {
    for (const order of orders) {
      const data = dataOf(order);
      if (data.createdAt != null) continue;
      const millis = toMillis(data.orderDateTime);
      if (!Number.isFinite(millis)) {
        skip('createdAt', order, 'orderDateTime_invalido');
        continue;
      }
      propose('createdAt', order, { createdAt: new Date(millis) }, 'derivado de orderDateTime');
    }
  }

  if (selected.has('orderCode')) {
    for (const order of orders) {
      const data = dataOf(order);
      if (typeof data.orderCode === 'string' && data.orderCode.trim()) continue;
      propose('orderCode', order, { orderCode: order.id }, 'codigo historico preserva o id exibido');
    }
  }

  if (selected.has('clienteId')) {
    for (const record of [...orders, ...encomendas]) {
      const data = dataOf(record);
      if (data.clienteId) continue;
      const ownerId = ownerOf(record);
      const phone = normalizePhone(data.customerPhone || data.customerIdentifier);
      if (!ownerId) {
        skip('clienteId', record, 'ownerId_ausente');
        continue;
      }
      if (!isValidPhone(phone)) {
        skip('clienteId', record, phone ? 'telefone_invalido' : 'telefone_ausente');
        continue;
      }
      const matches = phoneIndex.get(`${ownerId}\u0000${phone}`) || [];
      if (matches.length !== 1) {
        skip('clienteId', record, matches.length ? 'telefone_ambiguo' : 'cliente_nao_encontrado', {
          candidates: matches.map((customer) => pathOf(customer, 'clientes')).sort(),
        });
        continue;
      }
      propose('clienteId', record, { clienteId: matches[0].id }, 'telefone normalizado casou com um unico cliente');
    }
  }

  if (selected.has('legacyLinks')) {
    const sources = [
      ...cashTransactions
        .filter((record) => {
          const data = dataOf(record);
          return data.tipo === 'venda' && !data.orderId && !data.encomendaId;
        })
        .map((record) => ({ record, text: dataOf(record).titulo, ownerId: ownerOf(record) })),
      ...creditTransactions
        .filter((record) => {
          const data = dataOf(record);
          return data.type === 'debit' && !data.orderId && !data.encomendaId;
        })
        .map((record) => {
          const customerId = record.parentId || String(pathOf(record)).split('/')[1] || '';
          return {
            record,
            text: dataOf(record).description,
            ownerId: ownerOf(customerById.get(customerId)),
          };
        }),
    ];

    for (const { record, text, ownerId } of sources) {
      const prefix = legacyReference(text);
      if (!prefix) {
        skip('legacyLinks', record, 'prefixo_ausente');
        continue;
      }
      const data = dataOf(record);
      const isEncomenda = data.channel === 'encomenda' || /\bencomenda\b/i.test(String(text || ''));
      const candidates = isEncomenda ? encomendas : orders;
      const result = uniqueLegacyTarget({ source: record, ownerId, prefix, candidates });
      if (!result.target) {
        skip('legacyLinks', record, result.reason, { prefix, candidates: result.candidates });
        continue;
      }
      const field = isEncomenda ? 'encomendaId' : 'orderId';
      propose('legacyLinks', record, { [field]: result.target.id }, `${prefix} casou com um unico destino anterior`, ownerId);
    }
  }

  const proposals = [...proposalsByPath.values()]
    .map((proposal) => ({
      ...proposal,
      kinds: [...new Set(proposal.kinds)].sort(),
      patch: Object.fromEntries(Object.entries(proposal.patch).sort(([a], [b]) => a.localeCompare(b))),
    }))
    .sort((a, b) => a.path.localeCompare(b.path, 'pt-BR'));
  skipped.sort((a, b) => `${a.kind}|${a.path}|${a.reason}`.localeCompare(`${b.kind}|${b.path}|${b.reason}`, 'pt-BR'));

  return {
    selected: [...selected].sort(),
    proposals,
    skipped,
    summary: {
      documents: proposals.length,
      fields: proposals.reduce((total, proposal) => total + Object.keys(proposal.patch).length, 0),
      byKind: Object.fromEntries([...selected].sort().map((kind) => [
        kind,
        proposals.filter((proposal) => proposal.kinds.includes(kind)).length,
      ])),
      skippedByReason: Object.fromEntries(
        [...new Set(skipped.map((item) => item.reason))]
          .sort()
          .map((reason) => [reason, skipped.filter((item) => item.reason === reason).length]),
      ),
    },
  };
}
