'use client';

/**
 * Comprovantes do CAIXA: abertura, operação (sangria/suprimento/venda) e
 * fechamento. Antes viviam dentro do `CaixaTab.tsx` — o de fechamento ficava
 * 700 linhas longe dos irmãos, no meio de um componente de 2500 linhas, e era o
 * único cupom do sistema que ainda montava HTML solto.
 *
 * A divisão é a mesma do cupom de pedido e do de encomenda: a tela apura os
 * números (regra de negócio do caixa, que depende do estado do componente) e
 * este módulo só desenha. A caixa do cupom vem de `receipt-print.ts`.
 */

import {
  buildReceiptDocument,
  esc,
  printReceipt,
  resolvePrinterSize,
} from './receipt-print';
import { brl } from '@/lib/utils';

/** Estilo próprio dos comprovantes do caixa (o resto vem da base). */
const CAIXA_CSS = `
  .header { text-align: center; margin-bottom: 4px; }
  .header h1 { font-size: 14px; font-weight: bold; text-transform: uppercase; }
  .header p { font-size: 11px; }
  .sep { text-align: center; margin: 4px 0; letter-spacing: -1px; }
  .section { margin: 4px 0; }
  .title { font-weight: bold; text-transform: uppercase; margin-bottom: 4px; }
  .row { display: flex; justify-content: space-between; padding: 1px 0; }
  .bold { font-weight: bold; }
  table { width: 100%; border-collapse: collapse; margin-top: 4px; }
  th, td { text-align: left; padding: 2px 4px 2px 0; font-size: 11px; vertical-align: top; }
  td:first-child { white-space: nowrap; padding-right: 8px; }
  th { border-bottom: 1px dashed #000; font-weight: bold; }
  .r { text-align: right; padding-right: 0; }
  .resumo { margin-top: 4px; }
  .resumo .row { padding: 1px 0; }
  .total-final { font-size: 14px; font-weight: bold; border-top: 1px solid #000; padding-top: 4px; margin-top: 4px; }
  .footer { text-align: center; margin-top: 16px; font-size: 10px; }
`;

const SEP = '================================';
const SEP_DASH = '--------------------------------';

function nomeDaLoja(storeInfo: any): string {
  return storeInfo?.general?.name || storeInfo?.storeName || 'Loja';
}

function agoraBR() {
  const d = new Date();
  return {
    data: d.toLocaleDateString('pt-BR'),
    hora: d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
  };
}

/**
 * O separador do rodapé acompanha o do comprovante: abertura e operação usam a
 * régua de "=", o fechamento usa a de "-" do começo ao fim.
 */
function rodape(storeInfo: any, sep: string): string {
  return `
      <div class="footer">
        <p>${sep}</p>
        <p>Documento gerado automaticamente</p>
        <p>${esc(nomeDaLoja(storeInfo))}</p>
      </div>`;
}

/** Fecha o corpo num documento de cupom com a base compartilhada. */
function documento(storeInfo: any, title: string, body: string): string {
  return buildReceiptDocument({
    size: resolvePrinterSize(storeInfo),
    title,
    lineHeight: '1.4',
    css: CAIXA_CSS,
    body,
  });
}

/** Manda pro papel — QZ Tray, ou navegador se ele não estiver rodando. */
function imprimir(storeInfo: any, html: string): void {
  printReceipt({ html, printerSize: resolvePrinterSize(storeInfo) });
}

// ─────────────────────────────── Abertura ───────────────────────────────

export type AberturaCaixaData = {
  storeInfo: any;
  sessao: number | string;
  saldoInicial: number;
};

export function buildAberturaCaixaHtml(opts: AberturaCaixaData): string {
  const { storeInfo, sessao, saldoInicial } = opts;
  const { data, hora } = agoraBR();
  const storeName = nomeDaLoja(storeInfo);

  return documento(storeInfo, 'Abertura de Caixa', `
      <div class="header">
        <h1>${esc(storeName)}</h1>
      </div>
      <p class="sep">${SEP}</p>
      <div style="text-align:center; padding:6px 0; border:2px solid #000; margin:4px 0; font-size:16px; font-weight:bold; letter-spacing:2px;">
        ★ ABERTURA DE CAIXA ★
      </div>
      <p class="sep">${SEP}</p>
      <div class="section">
        <div class="row"><span>Sessão</span><span class="bold">${esc(sessao)}</span></div>
        <div class="row"><span>Data</span><span>${data}</span></div>
        <div class="row"><span>Hora</span><span>${hora}</span></div>
      </div>
      <p class="sep">${SEP_DASH}</p>
      <div class="section">
        <div class="row total-final"><span>Saldo Inicial</span><span>${brl(saldoInicial)}</span></div>
      </div>
      <p class="sep">${SEP_DASH}</p>
      <div class="section">
        <div class="row"><span>Operador</span><span>${esc(storeInfo?.general?.name || 'Principal')}</span></div>
      </div>${rodape(storeInfo, SEP)}
  `);
}

export function printAberturaCaixa(opts: AberturaCaixaData): void {
  imprimir(opts.storeInfo, buildAberturaCaixaHtml(opts));
}

// ─────────────────────────────── Operação ───────────────────────────────

export type TipoOperacaoCaixa = 'sangria' | 'suprimento' | 'venda';

const TITULO_OPERACAO: Record<string, string> = {
  sangria: '▼ SANGRIA DE CAIXA ▼',
  suprimento: '▲ SUPRIMENTO DE CAIXA ▲',
  venda: '$ VENDA MANUAL $',
};

const LEGENDA_VALOR: Record<string, string> = {
  sangria: '(−) Valor Retirado',
  suprimento: '(+) Valor Adicionado',
};

export type OperacaoCaixaData = {
  storeInfo: any;
  tipo: TipoOperacaoCaixa | string;
  titulo: string;
  valor: number;
  formaPagamento: string;
  sessao?: number | string;
};

export function buildOperacaoCaixaHtml(opts: OperacaoCaixaData): string {
  const { storeInfo, tipo, titulo, valor, formaPagamento, sessao } = opts;
  const { data, hora } = agoraBR();
  const storeName = nomeDaLoja(storeInfo);
  const label = TITULO_OPERACAO[tipo] || tipo.toUpperCase();
  const forma = (formaPagamento === 'conta_casa' ? 'Prazo' : formaPagamento || '').toUpperCase();

  return documento(storeInfo, TITULO_OPERACAO[tipo] || 'Operação', `
      <div class="header">
        <h1>${esc(storeName)}</h1>
      </div>
      <p class="sep">${SEP}</p>
      <div style="text-align:center; padding:8px 0; border:2px solid #000; margin:4px 0; font-size:14px; font-weight:bold; letter-spacing:1px;">
        ${esc(label)}
      </div>
      <p class="sep">${SEP}</p>
      <div class="section">
        <div class="row"><span>Sessão</span><span class="bold">${esc(sessao || '-')}</span></div>
        <div class="row"><span>Data</span><span>${data}</span></div>
        <div class="row"><span>Hora</span><span>${hora}</span></div>
      </div>
      <p class="sep">${SEP_DASH}</p>
      <div class="section">
        <div class="row"><span class="bold">Descrição:</span></div>
        <div style="padding:4px 8px; margin:4px 0; background:#f0f0f0; border-radius:2px; font-weight:bold; font-size:12px;">
          ${esc(titulo)}
        </div>
      </div>
      <p class="sep">${SEP_DASH}</p>
      <div class="section">
        <div class="row"><span>Forma de Pgto.</span><span class="bold">${esc(forma)}</span></div>
      </div>
      <p class="sep">${SEP_DASH}</p>
      <div style="text-align:center; padding:8px 0; margin:4px 0; border:1px solid #000;">
        <div style="font-size:11px; text-transform:uppercase;">${LEGENDA_VALOR[tipo] || 'Valor da Venda'}</div>
        <div style="font-size:18px; font-weight:bold; margin-top:2px;">${brl(valor)}</div>
      </div>${rodape(storeInfo, SEP)}
  `);
}

export function printOperacaoCaixa(opts: OperacaoCaixaData): void {
  imprimir(opts.storeInfo, buildOperacaoCaixaHtml(opts));
}

// ────────────────────────────── Fechamento ──────────────────────────────

/** Linha de motoboy/freelancer já apurada pela tela. */
export type LinhaPagamentoCaixa = {
  nome: string;
  devido: number;
  pago: number;
  restante: number;
};

export type LinhaSangriaCaixa = {
  hora: string;
  titulo: string;
  valor: number;
};

export type TotaisFechamentoCaixa = {
  totalDinheiro: number;
  totalPix: number;
  totalDebito: number;
  totalCredito: number;
  totalPrazo: number;
  saldoInicial: number;
  totalSuprimentoDinheiro: number;
  totalSangriaDinheiro: number;
};

export type FechamentoCaixaData = {
  storeInfo: any;
  /** Ausente vira "-" no cupom (caixa histórico sem sessão gravada). */
  sessao?: number | string;
  isFechado: boolean;
  /** "Fechado em"/"Data" já formatado pela tela (vem do caixa ou de agora). */
  dataHora: string;
  /** Preenchido só quando é 2ª via de um caixa já fechado. */
  reimpressaoEm?: string | null;
  totais: TotaisFechamentoCaixa;
  /**
   * O total que o bloco RESUMO DE VENDAS nunca imprimiu: as cinco formas saíam
   * soltas e quem conferia somava à mão. Opcional para o cupom antigo (e os
   * testes dele) continuarem válidos sem a linha.
   */
  vendas?: {
    totalVendas: number;
    fiadoRecebido: number;
    totalRecebido: number;
    porOrigem: { pedido: number; encomenda: number; avulsa: number };
  };
  vendasCanceladas: { quantidade: number; total: number };
  taxaGarcom: { valor: number; label: string; pedidos: number };
  totalMotoboys: number;
  totalFreelancers: number;
  /** Quanto tem que haver na gaveta depois de todas as saídas. */
  valorEsperado: number;
  motoboys: LinhaPagamentoCaixa[];
  freelancers: LinhaPagamentoCaixa[];
  sangriasDinheiro: LinhaSangriaCaixa[];
  /** O que foi contado na gaveta de verdade, quando já existe. */
  apuracao?: { apurado: number; diferenca: number } | null;
};

function tabelaPagamentos(titulo: string, linhas: LinhaPagamentoCaixa[], totalPago: number): string {
  if (!linhas.length) return '';
  return `
        <div class="section">
          <p class="title">${esc(titulo)}</p>
          <table>
            <thead><tr><th>Nome</th><th class="r">Devido</th><th class="r">Pago</th><th class="r">Rest.</th></tr></thead>
            <tbody>
              ${linhas.map((l) => `<tr><td>${esc(l.nome)}</td><td class="r">${brl(l.devido)}</td><td class="r">${brl(l.pago)}</td><td class="r bold">${brl(l.restante)}</td></tr>`).join('')}
            </tbody>
          </table>
          <div class="row bold"><span>Pago no fechamento</span><span>${brl(totalPago)}</span></div>
        </div>
        <p class="sep">${SEP_DASH}</p>
      `;
}

export function buildFechamentoCaixaHtml(data: FechamentoCaixaData): string {
  const {
    storeInfo, sessao, isFechado, dataHora, reimpressaoEm, totais, vendas, vendasCanceladas,
    taxaGarcom, totalMotoboys, totalFreelancers, valorEsperado,
    motoboys, freelancers, sangriasDinheiro, apuracao,
  } = data;

  /**
   * O fecho do resumo de vendas. A encomenda aparece na própria linha porque
   * numa confeitaria ela é o ticket alto do dia, e o fiado recebido fica fora
   * do total de vendas (a venda foi contada no dia da compra) mas dentro do
   * total recebido, que é o dinheiro que passou pelo caixa hoje.
   */
  const totalVendasBlock = vendas ? `
        <div class="row bold" style="border-top:1px dashed #000; margin-top:3px; padding-top:3px;">
          <span>TOTAL DE VENDAS</span><span>${brl(vendas.totalVendas)}</span>
        </div>
        ${vendas.porOrigem.encomenda > 0 ? `
          <div class="row"><span>&nbsp;&nbsp;· Balcão e delivery</span><span>${brl(vendas.porOrigem.pedido + vendas.porOrigem.avulsa)}</span></div>
          <div class="row"><span>&nbsp;&nbsp;· Encomendas</span><span>${brl(vendas.porOrigem.encomenda)}</span></div>
        ` : ''}
        ${vendas.fiadoRecebido > 0 ? `
          <div class="row"><span>(+) Fiado recebido (compras anteriores)</span><span>${brl(vendas.fiadoRecebido)}</span></div>
          <div class="row bold"><span>TOTAL RECEBIDO NO CAIXA</span><span>${brl(vendas.totalRecebido)}</span></div>
        ` : ''}
      ` : '';

  const motoboyBlock = tabelaPagamentos('MOTOBOYS / ENTREGAS', motoboys, totalMotoboys);
  const freelancerBlock = tabelaPagamentos('FREELANCERS / EXTRAS', freelancers, totalFreelancers);

  const sangriasBlock = sangriasDinheiro.length ? `
      <div class="section">
        <p class="title">SANGRIAS EM DINHEIRO</p>
        <table>
          <thead><tr><th>Hora</th><th>Titulo</th><th class="r">Valor</th></tr></thead>
          <tbody>
            ${sangriasDinheiro.map((l) => `
              <tr>
                <td>${esc(l.hora)}</td>
                <td>${esc(l.titulo)}</td>
                <td class="r">${brl(Math.abs(l.valor))}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
        <div class="row bold"><span>Total sangrias em dinheiro</span><span>${brl(Math.abs(totais.totalSangriaDinheiro))}</span></div>
      </div>
      <p class="sep">${SEP_DASH}</p>
    ` : '';

  const apuracaoBlock = apuracao ? `
      <div class="section" style="margin-top: 8px; border-top: 1px dashed #000; padding-top: 4px;">
        <div class="row"><span>Apurado na Gaveta Fisicamente</span><span>${brl(apuracao.apurado)}</span></div>
        ${apuracao.diferenca !== 0 ? `
          <div class="row bold"><span>Diferença (${apuracao.diferenca > 0 ? 'Sobra' : 'Quebra'})</span><span>${brl(apuracao.diferenca)}</span></div>
        ` : ''}
      </div>
    ` : '';

  return documento(storeInfo, 'Fechamento de Caixa', `
      <div class="header">
        <h1>${esc(nomeDaLoja(storeInfo))}</h1>
        <p>FECHAMENTO DE CAIXA</p>
        <p>Sessão: ${esc(sessao || '-')}</p>
        <p>${isFechado ? 'Fechado em' : 'Data'}: ${esc(dataHora)}</p>
        ${reimpressaoEm ? `<p style="font-weight:bold;margin-top:2px;">(REIMPRESSÃO: ${esc(reimpressaoEm)})</p>` : ''}
      </div>

      <p class="sep">${SEP_DASH}</p>

      <div class="section">
        <p class="title">RESUMO DE VENDAS</p>
        <div class="row"><span>Dinheiro</span><span>${brl(totais.totalDinheiro)}</span></div>
        <div class="row"><span>Pix</span><span>${brl(totais.totalPix)}</span></div>
        <div class="row"><span>Débito</span><span>${brl(totais.totalDebito)}</span></div>
        <div class="row"><span>Crédito</span><span>${brl(totais.totalCredito)}</span></div>
        <div class="row"><span>Prazo</span><span>${brl(totais.totalPrazo)}</span></div>
        ${totalVendasBlock}
        ${vendasCanceladas.quantidade > 0 ? `<div class="row"><span>Vendas canceladas (${vendasCanceladas.quantidade}) — não somam</span><span>${brl(vendasCanceladas.total)}</span></div>` : ''}
      </div>

      <p class="sep">${SEP_DASH}</p>

      <div class="section">
        <p class="title">APURAÇÃO DE DINHEIRO (GAVETA)</p>
        <div class="row"><span>Saldo Inicial (Troco)</span><span>${brl(Math.abs(totais.saldoInicial))}</span></div>
        <div class="row"><span>(+) Vendas em dinheiro</span><span>${brl(totais.totalDinheiro)}</span></div>
        <div class="row"><span>(+) Suprimentos (Entrada)</span><span>${brl(Math.abs(totais.totalSuprimentoDinheiro))}</span></div>
        <div class="row"><span>(-) Sangrias (Retirada)</span><span style="color: #000;">${brl(Math.abs(totais.totalSangriaDinheiro))}</span></div>
        ${taxaGarcom.valor > 0 ? `<div class="row"><span>(-) Taxa Garçom (Paga agora)</span><span>${brl(taxaGarcom.valor)}</span></div>` : ''}
        ${totalMotoboys > 0 ? `<div class="row"><span>(-) Motoboys (Pagos agora)</span><span>${brl(totalMotoboys)}</span></div>` : ''}
        ${totalFreelancers > 0 ? `<div class="row"><span>(-) Freelancers (Pagos agora)</span><span>${brl(totalFreelancers)}</span></div>` : ''}
        <div class="row total-final" style="margin-top: 6px; font-size: 14px;"><span>(=) VALOR ESPERADO</span><span>${brl(valorEsperado)}</span></div>
      </div>

      <p class="sep">${SEP_DASH}</p>

      ${(sangriasBlock || motoboyBlock || freelancerBlock) ? `
      <p style="text-align:center;font-weight:bold;font-size:10px;margin:8px 0 4px 0;">--- EXTRATOS DETALHADOS ---</p>
      ` : ''}

      ${sangriasBlock}

      ${taxaGarcom.valor > 0 ? `
      <div class="section">
        <p class="title">TAXA DE SERVIÇO</p>
        <div class="row"><span>Taxa: ${esc(taxaGarcom.label)} · ${taxaGarcom.pedidos} ped.</span><span>${brl(taxaGarcom.valor)}</span></div>
      </div>
      <p class="sep">${SEP_DASH}</p>
      ` : ''}

      ${motoboyBlock}
      ${freelancerBlock}

      ${apuracaoBlock}${rodape(storeInfo, SEP_DASH)}
  `);
}

export function printFechamentoCaixa(data: FechamentoCaixaData): void {
  imprimir(data.storeInfo, buildFechamentoCaixaHtml(data));
}
