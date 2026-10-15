import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ambiguousCreditCustomerResult,
  creditOrderMatchesCustomer,
  creditPhonesAreEqual,
  debtDueDate,
  dueDateFor,
  isValidCreditPhone,
  getPhoneVariants,
  isCreditEnabled,
  maskCreditPhoneInput,
  matchUniqueActiveCustomerByPhone,
  normalizeCreditPhone,
  quickRegistrationCreditDefaults,
  validateCustomerCredit,
} from './customer-credit';
import { unpaidDebt, type CreditTransaction } from './prazo-statement';

// Firestore em memória só para `validateCustomerCredit`: a busca do cadastro
// pelo telefone e o extrato de cada cliente.
const fake = vi.hoisted(() => ({
  clientes: new Map<string, any>(),
  extratos: new Map<string, any[]>(),
}));

vi.mock('firebase/firestore', () => ({
  collection: (_db: any, ...path: string[]) => ({ path }),
  where: (field: string, op: string, value: any) => ({ field, op, value }),
  query: (ref: { path: string[] }, ...constraints: any[]) => ({ ...ref, constraints }),
  getDocs: async ({ path, constraints = [] }: { path: string[]; constraints?: any[] }) => {
    if (path.length === 3) {
      return { docs: (fake.extratos.get(path[1]) || []).map((tx) => ({ id: tx.date, data: () => tx })) };
    }
    const docs = [...fake.clientes.entries()]
      .filter(([, data]) => constraints.every(({ field, op, value }) =>
        (op === 'in' ? value.includes(data[field]) : data[field] === value)))
      .map(([id, data]) => ({ id, data: () => data }));
    return { docs };
  },
}));

describe('contrato de telefone do cliente', () => {
  it('normaliza formatos brasileiros no mesmo identificador', () => {
    expect(normalizeCreditPhone('(16) 99999-8877')).toBe('16999998877');
    expect(normalizeCreditPhone('+55 16 99999-8877')).toBe('16999998877');
    // DDD 55 não é confundido com código do país.
    expect(normalizeCreditPhone('55999998888')).toBe('55999998888');
  });

  it('valida somente telefone com DDD e 10 ou 11 dígitos', () => {
    expect(isValidCreditPhone('1633334444')).toBe(true);
    expect(isValidCreditPhone('(16) 99999-8877')).toBe(true);
    expect(isValidCreditPhone('99998877')).toBe(false);
    expect(isValidCreditPhone('LARA')).toBe(false);
  });

  it('aplica uma única máscara progressiva para os formulários', () => {
    expect(maskCreditPhoneInput('16')).toBe('16');
    expect(maskCreditPhoneInput('1699999')).toBe('(16) 9999-9');
    expect(maskCreditPhoneInput('16999998877')).toBe('(16) 99999-8877');
  });

  it('cobre formatos legados sem ultrapassar o limite do operador in', () => {
    const variants = getPhoneVariants('16999998877');
    expect(variants).toContain('+55 16 99999-8877');
    expect(variants).toContain('(16)999998877');
    expect(variants).toContain('16 99999 8877');
    expect(variants).toContain('16-99999-8877');
    expect(variants.length).toBeLessThanOrEqual(30);
  });

  it('não confunde pessoas diferentes apenas pela presença do nono dígito', () => {
    expect(creditPhonesAreEqual('(16) 99999-8877', '+55 16 99999-8877')).toBe(true);
    expect(creditPhonesAreEqual('16999998877', '1699998877')).toBe(false);
    expect(getPhoneVariants('16999998877')).not.toContain('1699998877');
  });
});

describe('defaults do cadastro rápido', () => {
  it('inicializa Prazo e saldo apenas para cliente realmente novo', () => {
    expect(quickRegistrationCreditDefaults(false, '2026-07-31')).toEqual({
      createdAt: '2026-07-31',
      creditEnabled: true,
      creditLimit: 0,
      creditPayDay: 0,
      creditBalance: 0,
    });
  });

  it('não devolve nenhum campo financeiro para cadastro existente', () => {
    expect(quickRegistrationCreditDefaults(true, '2026-07-31')).toEqual({});
  });
});

describe('bloqueio temporário de unificação', () => {
  it('desativa o Prazo enquanto o cadastro está sendo incorporado', () => {
    expect(isCreditEnabled({ creditEnabled: true })).toBe(true);
    expect(isCreditEnabled({
      creditEnabled: true,
      mergeInProgress: { targetCustomerId: 'destino' },
    })).toBe(false);
  });
});

describe('vínculo de pedido pendente no Prazo', () => {
  it('prefere clienteId mesmo se o telefone do pedido ficou antigo', () => {
    expect(creditOrderMatchesCustomer(
      { clienteId: 'cliente-1', customerPhone: '16911112222' },
      '16999998888',
      'cliente-1',
    )).toBe(true);
  });

  it('não captura por telefone pedido já ligado a outro cliente', () => {
    expect(creditOrderMatchesCustomer(
      { clienteId: 'outro', customerPhone: '16999998888' },
      '16999998888',
      'cliente-1',
    )).toBe(false);
  });

  it('mantém telefone como fallback para pedido legado', () => {
    expect(creditOrderMatchesCustomer(
      { customerPhone: '(16) 99999-8888' },
      '16999998888',
      'cliente-1',
    )).toBe(true);
  });

  it('não captura pedido legado de outro número sem o nono dígito', () => {
    expect(creditOrderMatchesCustomer(
      { customerPhone: '1699998877' },
      '16999998877',
      'cliente-1',
    )).toBe(false);
  });
});

describe('Prazo com telefone duplicado', () => {
  it('bloqueia explicitamente em vez de escolher o primeiro cadastro', () => {
    const result = ambiguousCreditCustomerResult([
      { id: 'c1', data: { creditEnabled: true } },
      { id: 'c2', data: { creditEnabled: true } },
    ]);
    expect(result).toMatchObject({ allowed: false, reason: 'ambiguous' });
    expect(result?.message).toMatch(/conflito.*Clientes/i);
  });

  it('não interfere quando a identidade é única', () => {
    expect(ambiguousCreditCustomerResult([{ id: 'c1', data: {} }])).toBeNull();
  });
});

describe('matchUniqueActiveCustomerByPhone', () => {
  const target = '(16) 99999-8877';

  it('resolve um único cadastro ativo mesmo com formatação diferente', () => {
    const result = matchUniqueActiveCustomerByPhone([
      { id: 'c1', data: { celular: '16999998877' } },
      { id: 'outro', data: { celular: '16988887777' } },
    ], target);
    expect(result).toEqual({ kind: 'unique', customer: { id: 'c1', data: { celular: '16999998877' } } });
  });

  it('nunca escolhe o primeiro quando há duplicidade normalizada', () => {
    expect(matchUniqueActiveCustomerByPhone([
      { id: 'c1', data: { celular: '16999998877' } },
      { id: 'c2', data: { celular: '+55 16 99999-8877' } },
    ], target)).toEqual({ kind: 'ambiguous' });
  });

  it('ignora arquivados e não os reativa implicitamente', () => {
    expect(matchUniqueActiveCustomerByPhone([
      { id: 'arquivado', data: { celular: '16999998877', archived: true } },
    ], target)).toEqual({ kind: 'none' });
  });
});

describe('saldo do Prazo em centavos', () => {
  const OWNER = 'loja-1';
  const TELEFONE = '16999998877';
  const lancamento = (date: string, type: 'debit' | 'credit', amount: number) => ({ date, type, amount });
  // O servidor soma cada `increment` em binário, na ordem em que chegam.
  const somaComoOServidor = (extrato: any[]) =>
    extrato.reduce((saldo, tx) => saldo + (tx.type === 'debit' ? tx.amount : -tx.amount), 0);
  const cadastro = (over: any) => ({
    ownerId: OWNER,
    celular: TELEFONE,
    creditEnabled: true,
    creditLimit: 200,
    creditPayDay: 10,
    ...over,
  });

  beforeEach(() => {
    fake.clientes.clear();
    fake.extratos.clear();
    // Dia 16/09/2026, 11h47 em Brasília: a foto do balcão barrado.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-16T14:47:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('conta quitada com resto binário no cadastro não bloqueia por vencimento', async () => {
    // Extrato real de uma cliente que quitou tudo em 15/09 (70 + 95 + 0,90) e
    // no dia seguinte ouviu "dívida de R$ 0,00 venceu no dia 10".
    const extrato = [
      lancamento('2026-08-11T18:51:13.079Z', 'debit', 61),
      lancamento('2026-08-14T21:53:33.855Z', 'debit', 24),
      lancamento('2026-08-20T19:20:52.370Z', 'debit', 18.9),
      lancamento('2026-08-26T19:33:14.612Z', 'debit', 38),
      lancamento('2026-09-03T18:34:08.222Z', 'debit', 24),
      lancamento('2026-09-15T14:26:31.082Z', 'credit', 70),
      lancamento('2026-09-15T18:41:56.529Z', 'credit', 95),
      lancamento('2026-09-15T18:44:06.904Z', 'credit', 0.9),
    ];
    const gravado = somaComoOServidor(extrato);
    expect(gravado).toBe(5.662137425588298e-15); // o que estava no banco
    fake.clientes.set('c1', cadastro({ creditBalance: gravado }));
    fake.extratos.set('c1', extrato);

    const resultado = await validateCustomerCredit({}, OWNER, TELEFONE, 30);

    expect(resultado).toMatchObject({ allowed: true, balance: 0, nextBalance: 30 });
  });

  it('dívida de verdade vencida continua bloqueando', async () => {
    const extrato = [lancamento('2026-08-20T19:20:52.370Z', 'debit', 18.9)];
    fake.clientes.set('c1', cadastro({ creditBalance: 18.9 }));
    fake.extratos.set('c1', extrato);

    const resultado = await validateCustomerCredit({}, OWNER, TELEFONE, 30);

    expect(resultado).toMatchObject({ allowed: false, reason: 'past_due', balance: 18.9 });
    expect(resultado.message).toMatch(/18,90 venceu no dia 10/);
  });

  it('compra que fecha o limite exato não passa dele por resto binário', async () => {
    // Deve R$ 0,90 (95,90 − 95 gravou 0,9000000000000057) e compra R$ 49,10
    // com limite de R$ 50: somado cru dá 50,00000000000001.
    const gravado = somaComoOServidor([
      lancamento('2026-09-15T14:00:00.000Z', 'debit', 95.9),
      lancamento('2026-09-15T15:00:00.000Z', 'credit', 95),
    ]);
    expect(gravado + 49.1).toBeGreaterThan(50);
    fake.clientes.set('c1', cadastro({ creditBalance: gravado, creditLimit: 50, creditPayDay: 0 }));

    const resultado = await validateCustomerCredit({}, OWNER, TELEFONE, 49.1);

    expect(resultado).toMatchObject({ allowed: true, balance: 0.9, nextBalance: 50 });
  });
});

describe('vencimento do Prazo', () => {
  // Datas no fuso de quem roda: o vencimento é "dia X às 23h59" do relógio da loja.
  const dia = (ano: number, mes: number, d: number, h = 12) => new Date(ano, mes - 1, d, h);
  const fimDoDia = (ano: number, mes: number, d: number) => new Date(ano, mes - 1, d, 23, 59, 59, 999);

  it('compra no próprio dia de pagamento vence no mês seguinte', () => {
    // Gostinho, 23/09: comprou 05/09 com dia de pagamento 5 e a tela dizia
    // "Vencida em 05/09/2026" — a dívida vencia no mesmo dia da compra.
    expect(dueDateFor(dia(2026, 9, 5, 13), 5)).toEqual(fimDoDia(2026, 10, 5));
  });

  it('compra antes do dia de pagamento vence no mesmo mês', () => {
    expect(dueDateFor(dia(2026, 9, 4), 8)).toEqual(fimDoDia(2026, 9, 8));
  });

  it('compra depois do dia de pagamento vence no mês seguinte, inclusive na virada do ano', () => {
    expect(dueDateFor(dia(2026, 8, 12), 10)).toEqual(fimDoDia(2026, 9, 10));
    expect(dueDateFor(dia(2026, 12, 15), 10)).toEqual(fimDoDia(2027, 1, 10));
  });

  it('em mês curto o dia de pagamento é o último dia, e comprar nele também vira o mês', () => {
    expect(dueDateFor(dia(2027, 2, 27), 30)).toEqual(fimDoDia(2027, 2, 28));
    expect(dueDateFor(dia(2027, 2, 28), 30)).toEqual(fimDoDia(2027, 3, 30));
    expect(dueDateFor(dia(2026, 11, 30), 31)).toEqual(fimDoDia(2026, 12, 31));
  });

  describe('pagou a conta antes do vencimento, o que comprar depois é do mês seguinte', () => {
    // Datas sem "Z": hora local, como o vencimento.
    const lanc = (id: string, type: 'debit' | 'credit', amount: number, date: string) =>
      ({ id, type, amount, date }) as CreditTransaction;
    const vence = (extrato: CreditTransaction[], payDay: number) => {
      const debt = unpaidDebt(extrato);
      return debt ? debtDueDate(debt, payDay) : null;
    };

    it('Camila: quitou tudo em 08/10 (dia 10) e comprou 5 minutos depois → vence 10/11', () => {
      // Gostinho, 15/10: a compra de R$ 17 vencia em 10/10 e a loja não vendia
      // mais para ela desde 11/10, com a conta paga adiantada.
      expect(vence([
        lanc('set', 'debit', 58, '2026-09-23T12:49:00'),
        lanc('out1', 'debit', 12, '2026-10-01T16:45:00'),
        lanc('out3', 'debit', 12, '2026-10-03T15:06:00'),
        lanc('pix1', 'credit', 50, '2026-10-08T13:18:19'),
        lanc('pix2', 'credit', 32, '2026-10-08T13:18:41'),
        lanc('nova', 'debit', 17, '2026-10-08T13:23:10'),
      ], 10)).toEqual(fimDoDia(2026, 11, 10));
    });

    it('comprou antes de pagar na mesma visita: a compra ainda é da conta do dia 10', () => {
      expect(vence([
        lanc('out1', 'debit', 12, '2026-10-01T16:45:00'),
        lanc('nova', 'debit', 17, '2026-10-08T13:10:00'),
        lanc('pix', 'credit', 12, '2026-10-08T13:18:00'),
      ], 10)).toEqual(fimDoDia(2026, 10, 10));
    });

    it('pagamento parcial não adianta a conta', () => {
      expect(vence([
        lanc('out1', 'debit', 30, '2026-10-01T16:45:00'),
        lanc('pix', 'credit', 20, '2026-10-08T13:18:00'),
        lanc('nova', 'debit', 17, '2026-10-08T13:23:00'),
      ], 10)).toEqual(fimDoDia(2026, 10, 10));
    });

    it('Fernanda: quitou em 09/10 a conta vencida em 10/09 e comprou em seguida → vence 10/11', () => {
      expect(vence([
        lanc('ago1', 'debit', 55, '2026-08-15T12:17:19'),
        lanc('ago2', 'debit', 45, '2026-08-27T14:34:14'),
        lanc('pix', 'credit', 100, '2026-10-09T17:48:23'),
        lanc('nova', 'debit', 38, '2026-10-09T17:48:46'),
      ], 10)).toEqual(fimDoDia(2026, 11, 10));
    });

    it('pagou no próprio dia 10 e comprou: vence 10/11, não pula dois meses', () => {
      expect(vence([
        lanc('set', 'debit', 40, '2026-09-20T10:00:00'),
        lanc('pix', 'credit', 40, '2026-10-10T10:00:00'),
        lanc('nova', 'debit', 17, '2026-10-10T10:05:00'),
      ], 10)).toEqual(fimDoDia(2026, 11, 10));
    });

    it('quitação de um ciclo anterior não muda o vencimento', () => {
      // Pagou tudo em 05/09 (conta do dia 10/09); a compra de 05/10 é da conta
      // de 10/10.
      expect(vence([
        lanc('ago', 'debit', 40, '2026-08-20T10:00:00'),
        lanc('pix', 'credit', 40, '2026-09-05T10:00:00'),
        lanc('nova', 'debit', 17, '2026-10-05T10:00:00'),
      ], 10)).toEqual(fimDoDia(2026, 10, 10));
    });

    it('nunca antecipa: compra depois do dia de pagamento segue no mês seguinte', () => {
      expect(vence([
        lanc('set', 'debit', 40, '2026-09-20T10:00:00'),
        lanc('pix', 'credit', 40, '2026-10-08T10:00:00'),
        lanc('nova', 'debit', 17, '2026-10-20T10:00:00'),
      ], 10)).toEqual(fimDoDia(2026, 11, 10));
    });

    it('primeira compra sem pagamento antes segue a regra normal', () => {
      expect(vence([lanc('nova', 'debit', 17, '2026-09-29T10:00:00')], 30)).toEqual(fimDoDia(2026, 9, 30));
    });

    it('crédito deixado antes das compras não conta como conta adiantada', () => {
      // Adiantou R$ 50, gastou R$ 30 e depois R$ 40 (sobrou R$ 20 devendo):
      // não houve pagamento entre as compras.
      expect(vence([
        lanc('adiant', 'credit', 50, '2026-10-01T10:00:00'),
        lanc('c1', 'debit', 30, '2026-10-02T10:00:00'),
        lanc('c2', 'debit', 40, '2026-10-05T10:00:00'),
      ], 10)).toEqual(fimDoDia(2026, 10, 10));
    });

    it('estorno do pagamento desfaz a quitação', () => {
      expect(vence([
        lanc('out1', 'debit', 12, '2026-10-01T16:45:00'),
        lanc('pix', 'credit', 12, '2026-10-08T13:18:00'),
        { ...lanc('estorno', 'debit', 12, '2026-10-08T13:20:00'), reversalOf: 'pix' },
        lanc('nova', 'debit', 17, '2026-10-08T13:23:00'),
      ], 10)).toEqual(fimDoDia(2026, 10, 10));
    });
  });

  describe('na trava da venda', () => {
    const OWNER = 'loja-1';
    const TELEFONE = '16999998877';
    // Extrato real: três compras no balcão em 05/09, dia de pagamento 5.
    const extrato = [
      { date: '2026-09-05T16:05:40.052Z', type: 'debit', amount: 36 },
      { date: '2026-09-05T18:28:04.780Z', type: 'debit', amount: 18 },
      { date: '2026-09-05T19:01:12.251Z', type: 'debit', amount: 20 },
    ];

    beforeEach(() => {
      fake.clientes.clear();
      fake.extratos.clear();
      fake.clientes.set('c1', {
        ownerId: OWNER,
        celular: TELEFONE,
        creditEnabled: true,
        creditLimit: 200,
        creditPayDay: 5,
        creditBalance: 74,
      });
      fake.extratos.set('c1', extrato);
      vi.useFakeTimers({ toFake: ['Date'] });
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('libera o Prazo antes do vencimento do mês seguinte', async () => {
      vi.setSystemTime(new Date('2026-09-23T19:51:00.000Z')); // 16h51 da foto

      const resultado = await validateCustomerCredit({}, OWNER, TELEFONE, 56);

      expect(resultado).toMatchObject({ allowed: true, balance: 74, nextBalance: 130 });
    });

    it('bloqueia depois do dia 5 do mês seguinte', async () => {
      vi.setSystemTime(new Date('2026-10-06T15:00:00.000Z'));

      const resultado = await validateCustomerCredit({}, OWNER, TELEFONE, 56);

      expect(resultado).toMatchObject({ allowed: false, reason: 'past_due' });
    });

    it('Camila: pagou tudo antes do dia 10 e comprou depois, a loja vende em 14/10', async () => {
      fake.clientes.set('c1', { ...fake.clientes.get('c1'), creditPayDay: 10, creditBalance: 17 });
      fake.extratos.set('c1', [
        { date: '2026-10-03T18:06:15.000Z', type: 'debit', amount: 82 },
        { date: '2026-10-08T16:18:41.000Z', type: 'credit', amount: 82 },
        { date: '2026-10-08T16:23:10.000Z', type: 'debit', amount: 17 },
      ]);
      vi.setSystemTime(new Date('2026-10-14T15:00:00.000Z'));

      const resultado = await validateCustomerCredit({}, OWNER, TELEFONE, 20);

      expect(resultado).toMatchObject({ allowed: true, balance: 17 });
    });
  });
});

describe('idade da dívida na trava da venda', () => {
  const OWNER = 'loja-1';
  const TELEFONE = '16999998877';

  beforeEach(() => {
    fake.clientes.clear();
    fake.extratos.clear();
    vi.useFakeTimers({ toFake: ['Date'] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('quem compra e paga a conta antiga na mesma visita não é barrado no dia seguinte', async () => {
    // Dia de pagamento 10. No dia 10 a cliente compra R$ 20 e depois paga os
    // R$ 50 de agosto. O saldo nunca zerou, e a regra antiga datava a dívida na
    // compra de agosto: "venceu no dia 10" já no dia 11.
    fake.clientes.set('c1', {
      ownerId: OWNER,
      celular: TELEFONE,
      creditEnabled: true,
      creditLimit: 200,
      creditPayDay: 10,
      creditBalance: 20,
    });
    fake.extratos.set('c1', [
      { date: '2026-08-12T15:00:00.000Z', type: 'debit', amount: 50 },
      { date: '2026-09-10T17:00:00.000Z', type: 'debit', amount: 20 },
      { date: '2026-09-10T17:05:00.000Z', type: 'credit', amount: 50 },
    ]);
    vi.setSystemTime(new Date('2026-09-11T15:00:00.000Z'));

    const resultado = await validateCustomerCredit({}, OWNER, TELEFONE, 30);

    expect(resultado).toMatchObject({ allowed: true, balance: 20, nextBalance: 50 });
  });

  it('quem paga só parte da conta vencida continua barrado', async () => {
    fake.clientes.set('c1', {
      ownerId: OWNER,
      celular: TELEFONE,
      creditEnabled: true,
      creditLimit: 200,
      creditPayDay: 10,
      creditBalance: 40,
    });
    fake.extratos.set('c1', [
      { date: '2026-08-12T15:00:00.000Z', type: 'debit', amount: 100 },
      { date: '2026-09-10T15:00:00.000Z', type: 'credit', amount: 60 },
    ]);
    vi.setSystemTime(new Date('2026-09-11T15:00:00.000Z'));

    const resultado = await validateCustomerCredit({}, OWNER, TELEFONE, 30);

    expect(resultado).toMatchObject({ allowed: false, reason: 'past_due', balance: 40 });
  });
});
