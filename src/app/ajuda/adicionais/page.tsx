'use client';

/* Página de ajuda dos Adicionais — guia visual com réplicas da interface
   real (3 colunas, interruptores, modal do cliente), desenhadas em HTML/SVG
   para nunca quebrarem e seguirem o tema. Linguagem simples, sem termos
   técnicos. */

import React from 'react';
import Link from 'next/link';
import {
  HelpCircle, ArrowLeft, ArrowRight, ArrowDown, Search, Plus, Trash2, Pencil,
  Check, Bookmark, Smartphone, Store, Package, UtensilsCrossed, AlertTriangle,
} from 'lucide-react';

/* ───────────────────────── peças visuais reutilizáveis ───────────────────── */

function Interruptor({ ligado, rotulo, tamanho = 'md' }: { ligado: boolean; rotulo?: string; tamanho?: 'sm' | 'md' }) {
  const t = tamanho === 'sm' ? { trilho: 'h-3.5 w-6 p-0.5', bola: 'h-2.5 w-2.5' } : { trilho: 'h-5 w-9 p-0.5', bola: 'h-4 w-4' };
  return (
    <span className="inline-flex items-center gap-1.5 align-middle">
      <span className={`inline-flex items-center rounded-full transition-colors ${t.trilho} ${ligado ? 'justify-end bg-green-500' : 'justify-start bg-red-400'}`}>
        <span className={`rounded-full bg-white shadow ${t.bola}`} />
      </span>
      {rotulo && <span className={`text-[10px] font-bold uppercase ${ligado ? 'text-green-600' : 'text-red-500'}`}>{rotulo}</span>}
    </span>
  );
}

function ItemLinha({ nome, ligado, preco }: { nome: string; ligado: boolean; preco?: string }) {
  return (
    <div className={`flex items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 ${ligado ? 'bg-white' : 'bg-slate-100'}`}>
      <span className={`truncate text-[12px] font-semibold ${ligado ? 'text-slate-700' : 'text-slate-400 line-through'}`}>{nome}</span>
      <span className="flex shrink-0 items-center gap-2">
        {preco && <span className={`text-[11px] font-bold ${ligado ? 'text-emerald-600' : 'text-slate-300'}`}>{preco}</span>}
        <Interruptor ligado={ligado} tamanho="sm" />
      </span>
    </div>
  );
}

function Caixinha({ titulo, itens, apagada, destaque }: {
  titulo: string;
  itens: Array<{ nome: string; ligado: boolean; preco?: string }>;
  apagada?: boolean;
  destaque?: boolean;
}) {
  return (
    <div className={`rounded-2xl border-2 p-3 shadow-sm transition-all ${
      apagada ? 'border-slate-200 bg-slate-50 opacity-50'
      : destaque ? 'border-orange-400 bg-orange-50'
      : 'border-emerald-200 bg-emerald-50/40'
    }`}>
      <p className="mb-2 flex items-center gap-1.5 text-[12px] font-black text-slate-700">
        <Package className={`h-3.5 w-3.5 ${destaque ? 'text-orange-500' : 'text-emerald-500'}`} /> {titulo}
      </p>
      <div className="space-y-1">
        {itens.map((it) => <ItemLinha key={it.nome} {...it} />)}
      </div>
    </div>
  );
}

function Callout({ n }: { n: number }) {
  return (
    <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-orange-500 text-[11px] font-black text-white shadow ring-2 ring-white">{n}</span>
  );
}

function Secao({ id, numero, titulo, lead, children }: {
  id: string; numero: string; titulo: string; lead?: string; children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-24">
      <div className="mb-4 flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-600 text-base font-black text-white shadow">{numero}</span>
        <div>
          <h2 className="text-xl font-black tracking-tight text-slate-800">{titulo}</h2>
          {lead && <p className="mt-0.5 text-sm text-slate-500">{lead}</p>}
        </div>
      </div>
      {children}
    </section>
  );
}

const SetaDireita = () => (
  <div className="hidden items-center justify-center md:flex">
    <ArrowRight className="h-7 w-7 text-emerald-400" strokeWidth={3} />
  </div>
);
const SetaBaixo = () => (
  <div className="flex items-center justify-center py-1 md:hidden">
    <ArrowDown className="h-6 w-6 text-emerald-400" strokeWidth={3} />
  </div>
);

/* ───────────────────────────────── página ────────────────────────────────── */

export default function AjudaAdicionaisPage() {
  const indice = [
    ['mapa', 'O mapa geral'],
    ['despensa', 'A despensa (Lista Matriz)'],
    ['caixinhas', 'As caixinhas (containers)'],
    ['tela', 'A tela, parte por parte'],
    ['regra', 'A regra de ouro'],
    ['cliente', 'O que o cliente vê'],
    ['lixeira', 'Pausar × remover'],
  ] as const;

  return (
    <div className="min-h-screen bg-gradient-to-b from-emerald-50/60 via-white to-white">
      {/* topo fixo */}
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-100 text-emerald-600"><HelpCircle className="h-5 w-5" /></span>
            <div>
              <h1 className="text-lg font-black leading-tight text-slate-800">Guia dos Adicionais</h1>
              <p className="text-[11px] text-slate-400">Despensa, caixinhas e o pedido do cliente — sem complicação</p>
            </div>
          </div>
          <Link href="/" className="flex items-center gap-1.5 rounded-full border border-slate-200 px-3 py-1.5 text-xs font-bold text-slate-600 transition-colors hover:border-emerald-300 hover:text-emerald-700">
            <ArrowLeft className="h-3.5 w-3.5" /> Voltar ao PDV
          </Link>
        </div>
      </header>

      <div className="mx-auto flex max-w-5xl gap-8 px-4 py-8">
        {/* índice lateral (desktop) */}
        <nav className="sticky top-24 hidden h-fit w-48 shrink-0 lg:block">
          <p className="mb-2 text-[10px] font-black uppercase tracking-widest text-slate-400">Neste guia</p>
          <ul className="space-y-1 border-l-2 border-slate-100">
            {indice.map(([id, label]) => (
              <li key={id}>
                <a href={`#${id}`} className="-ml-0.5 block border-l-2 border-transparent py-1 pl-3 text-[12px] font-semibold text-slate-500 transition-colors hover:border-emerald-400 hover:text-emerald-700">
                  {label}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        {/* conteúdo */}
        <main className="min-w-0 flex-1 space-y-12 pb-20">

          {/* ── 0. mapa geral ── */}
          <Secao id="mapa" numero="1" titulo="O mapa geral" lead="Todo o sistema de adicionais cabe nesta linha: o item nasce na despensa, entra em caixinhas, as caixinhas viram etapas do produto e o cliente escolhe.">
            <div className="rounded-3xl border border-emerald-100 bg-white p-5 shadow-sm">
              <div className="grid items-stretch gap-2 md:grid-cols-[1fr_auto_1fr_auto_1fr_auto_1fr]">
                <div className="rounded-2xl border-2 border-amber-300 bg-amber-50 p-3 text-center">
                  <Store className="mx-auto mb-1 h-6 w-6 text-amber-600" />
                  <p className="text-[12px] font-black text-amber-800">DESPENSA</p>
                  <p className="text-[11px] text-amber-700/80">Lista Matriz: cada item cadastrado uma vez</p>
                </div>
                <SetaDireita /><SetaBaixo />
                <div className="rounded-2xl border-2 border-emerald-300 bg-emerald-50 p-3 text-center">
                  <Package className="mx-auto mb-1 h-6 w-6 text-emerald-600" />
                  <p className="text-[12px] font-black text-emerald-800">CAIXINHAS</p>
                  <p className="text-[11px] text-emerald-700/80">Containers: grupos de escolha (o mesmo item pode estar em várias)</p>
                </div>
                <SetaDireita /><SetaBaixo />
                <div className="rounded-2xl border-2 border-violet-300 bg-violet-50 p-3 text-center">
                  <UtensilsCrossed className="mx-auto mb-1 h-6 w-6 text-violet-600" />
                  <p className="text-[12px] font-black text-violet-800">PRODUTO</p>
                  <p className="text-[11px] text-violet-700/80">Cada caixinha vinculada vira uma etapa de escolha</p>
                </div>
                <SetaDireita /><SetaBaixo />
                <div className="rounded-2xl border-2 border-sky-300 bg-sky-50 p-3 text-center">
                  <Smartphone className="mx-auto mb-1 h-6 w-6 text-sky-600" />
                  <p className="text-[12px] font-black text-sky-800">CLIENTE</p>
                  <p className="text-[11px] text-sky-700/80">Escolhe nas etapas e fecha o pedido</p>
                </div>
              </div>
            </div>
          </Secao>

          {/* ── 1. despensa ── */}
          <Secao id="despensa" numero="2" titulo="A despensa (Lista Matriz)" lead="Pense na Lista Matriz como a despensa da loja: é o único lugar onde o item existe de verdade, com nome e preço. As caixinhas só pegam emprestado.">
            <div className="rounded-3xl border-2 border-dashed border-amber-300 bg-amber-50/50 p-5">
              <p className="mb-3 flex items-center gap-2 text-sm font-black text-amber-800"><Store className="h-4 w-4" /> LISTA MATRIZ — a despensa</p>
              <div className="grid gap-1.5 sm:grid-cols-2">
                <ItemLinha nome="🍗 Filé de frango" ligado preco="R$ 9,00" />
                <ItemLinha nome="🥤 Coca Zero" ligado preco="R$ 6,00" />
                <ItemLinha nome="🥤 Coca Normal" ligado preco="R$ 6,00" />
                <ItemLinha nome="🍟 Batata frita" ligado preco="R$ 8,00" />
                <ItemLinha nome="🥚 Ovo frito" ligado preco="R$ 3,50" />
                <ItemLinha nome="🧀 Farofa" ligado preco="R$ 3,50" />
              </div>
              <p className="mt-3 rounded-xl bg-white/70 p-3 text-[13px] text-amber-900">
                💡 Mudou o preço aqui? Muda em todo lugar. Apagou aqui? Some de todo lugar.
                <strong> Um cadastro só, sem cópias</strong> — por isso nunca crie dois "Filé de frango".
              </p>
            </div>
          </Secao>

          {/* ── 2. caixinhas ── */}
          <Secao id="caixinhas" numero="3" titulo="As caixinhas (containers)" lead="Uma caixinha agrupa itens da despensa para virar uma escolha. O MESMO item pode morar em várias caixinhas ao mesmo tempo — e é aqui que mora a pegadinha.">
            <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
              {/* diagrama: um item -> três caixinhas */}
              <div className="mb-2 flex justify-center">
                <span className="rounded-full border-2 border-amber-300 bg-amber-50 px-4 py-1.5 text-sm font-black text-amber-800 shadow-sm">🥤 Coca Zero <span className="font-semibold text-amber-600">(1 cadastro na despensa)</span></span>
              </div>
              <svg viewBox="0 0 600 60" className="mx-auto block h-12 w-full max-w-xl" aria-hidden>
                <path d="M300 4 C300 30 110 26 105 56" fill="none" stroke="#34d399" strokeWidth="2.5" strokeDasharray="5 4" />
                <path d="M300 4 L300 56" fill="none" stroke="#34d399" strokeWidth="2.5" strokeDasharray="5 4" />
                <path d="M300 4 C300 30 490 26 495 56" fill="none" stroke="#34d399" strokeWidth="2.5" strokeDasharray="5 4" />
              </svg>
              <div className="grid gap-3 sm:grid-cols-3">
                <Caixinha titulo="Coca 2L" itens={[{ nome: 'Normal', ligado: true }, { nome: 'Zero', ligado: true }]} />
                <Caixinha titulo="Coca 1L" itens={[{ nome: 'Normal', ligado: true }, { nome: 'Zero', ligado: true }]} />
                <Caixinha titulo="Coca 350ml" itens={[{ nome: 'Normal', ligado: true }, { nome: 'Zero', ligado: true }]} />
              </div>
              <p className="mt-4 rounded-xl bg-emerald-50 p-3 text-[13px] text-emerald-900">
                ✅ É uma Coca Zero só — aparecendo em três escolhas diferentes. Nada foi copiado:
                se o preço mudar na despensa, muda nas três caixinhas ao mesmo tempo.
              </p>
            </div>
          </Secao>

          {/* ── 3. a tela ── */}
          <Secao id="tela" numero="4" titulo="A tela de Adicionais, parte por parte" lead="A aba Adicionais do PDV tem três colunas. Esta é uma miniatura dela, com cada parte numerada:">
            <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
              {/* réplica em miniatura da tela real */}
              <div className="grid md:grid-cols-[180px_1fr_190px]">
                {/* coluna 1 */}
                <div className="relative border-b border-slate-200 bg-white p-3 md:border-b-0 md:border-r">
                  <div className="absolute -left-1 -top-1"><Callout n={1} /></div>
                  <p className="mb-2 text-[11px] font-black text-slate-500">Containers</p>
                  <div className="space-y-1.5">
                    <span className="block rounded-lg bg-emerald-600 px-2.5 py-1.5 text-[11px] font-bold text-white">Lista Matriz</span>
                    <span className="flex items-center justify-between rounded-lg border border-slate-200 px-2.5 py-1.5 text-[11px] font-semibold text-slate-600">Coca 2L <span className="rounded-full bg-slate-100 px-1.5 text-[9px]">2</span></span>
                    <span className="flex items-center justify-between rounded-lg border border-orange-300 bg-orange-50 px-2.5 py-1.5 text-[11px] font-semibold text-orange-700">Marmita P <span className="flex items-center gap-1"><span className="rounded-full bg-orange-100 px-1.5 text-[9px]">8</span><Pencil className="h-2.5 w-2.5" /></span></span>
                    <span className="flex items-center justify-between rounded-lg border border-slate-200 px-2.5 py-1.5 text-[11px] font-semibold text-slate-600">Guarnições <span className="rounded-full bg-slate-100 px-1.5 text-[9px]">13</span></span>
                  </div>
                </div>
                {/* coluna 2 */}
                <div className="relative border-b border-slate-200 p-3 md:border-b-0 md:border-r">
                  <div className="absolute -left-1 -top-1 md:left-auto md:-top-1"><Callout n={2} /></div>
                  <div className="mb-2 flex items-center gap-1.5">
                    <span className="flex flex-1 items-center gap-1 rounded-lg border border-slate-200 px-2 py-1 text-[10px] text-slate-400"><Search className="h-3 w-3" /> Buscar adicionais...</span>
                    <span className="rounded-lg bg-emerald-600 px-2 py-1 text-[10px] font-bold text-white"><Plus className="inline h-3 w-3" /> Novo</span>
                  </div>
                  <div className="space-y-1">
                    <ItemLinha nome="Coca Normal" ligado preco="R$ 6,00" />
                    <ItemLinha nome="Coca Zero" ligado={false} preco="R$ 6,00" />
                    <ItemLinha nome="Guaraná" ligado preco="R$ 5,50" />
                  </div>
                </div>
                {/* coluna 3 */}
                <div className="relative bg-slate-50/60 p-3">
                  <div className="absolute -left-1 -top-1"><Callout n={3} /></div>
                  <p className="mb-1 text-[11px] font-black text-slate-600">Produtos que usam &quot;Coca 2L&quot;</p>
                  <div className="space-y-1">
                    <label className="flex items-center gap-1.5 rounded bg-emerald-50 px-2 py-1 text-[11px] font-semibold text-slate-700"><span className="flex h-3.5 w-3.5 items-center justify-center rounded-sm bg-emerald-600 text-white"><Check className="h-2.5 w-2.5" /></span> Combo Família</label>
                    <label className="flex items-center gap-1.5 rounded px-2 py-1 text-[11px] text-slate-400"><span className="h-3.5 w-3.5 rounded-sm border border-slate-300 bg-white" /> PF Strogonoff</label>
                  </div>
                </div>
              </div>
            </div>
            {/* legenda */}
            <div className="mt-3 grid gap-2 sm:grid-cols-3">
              <div className="flex items-start gap-2 rounded-2xl border border-slate-200 bg-white p-3">
                <Callout n={1} />
                <p className="text-[12px] text-slate-600"><strong>Suas caixinhas.</strong> Clique para abrir uma. A "Lista Matriz" no topo é a despensa inteira.</p>
              </div>
              <div className="flex items-start gap-2 rounded-2xl border border-slate-200 bg-white p-3">
                <Callout n={2} />
                <p className="text-[12px] text-slate-600"><strong>Os itens da caixinha aberta</strong> (ou da despensa), com busca e os interruptores de ligar/desligar.</p>
              </div>
              <div className="flex items-start gap-2 rounded-2xl border border-slate-200 bg-white p-3">
                <Callout n={3} />
                <p className="text-[12px] text-slate-600"><strong>Os produtos que usam a caixinha aberta.</strong> Marcou = o produto ganha essa etapa de escolha.</p>
              </div>
            </div>
            <p className="mt-3 flex items-start gap-2 rounded-2xl border border-orange-200 bg-orange-50 p-3 text-[13px] text-orange-900">
              <Bookmark className="mt-0.5 h-4 w-4 shrink-0 text-orange-500" />
              <span><strong>Truque do laranja:</strong> na Lista Matriz, clique no <em>nome</em> de um item — as caixinhas que o usam acendem em laranja e pulam para o topo da lista. Perfeito para responder "onde essa Coca Zero aparece?".</span>
            </p>
          </Secao>

          {/* ── 4. regra de ouro ── */}
          <Secao id="regra" numero="5" titulo="A regra de ouro do interruptor" lead="O MESMO interruptor faz coisas diferentes dependendo de onde você está. Essa é a parte mais importante do guia:">
            <div className="grid gap-4 md:grid-cols-2">
              {/* global */}
              <div className="overflow-hidden rounded-3xl border-2 border-red-200 bg-white shadow-sm">
                <div className="bg-red-50 px-4 py-3">
                  <p className="flex items-center gap-2 text-sm font-black text-red-700"><Store className="h-4 w-4" /> Desligou na DESPENSA (Lista Matriz)</p>
                  <p className="text-[12px] text-red-600/80">Some de <strong>todas</strong> as caixinhas de uma vez</p>
                </div>
                <div className="space-y-3 p-4">
                  <div className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2">
                    <span className="text-[13px] font-bold text-slate-700">🍗 Filé de frango <span className="font-semibold text-slate-400">(acabou!)</span></span>
                    <Interruptor ligado={false} rotulo="Pausado" />
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <Caixinha titulo="Marmita P" itens={[{ nome: 'Frango', ligado: false }]} apagada />
                    <Caixinha titulo="Marmita G" itens={[{ nome: 'Frango', ligado: false }]} apagada />
                    <Caixinha titulo="PF do dia" itens={[{ nome: 'Frango', ligado: false }]} apagada />
                  </div>
                  <p className="rounded-xl bg-red-50 p-2.5 text-[12px] text-red-800">
                    Use quando o item <strong>acabou de verdade</strong>: um clique e ele some de todos os
                    produtos ao mesmo tempo. Chegou frango? Outro clique e volta tudo.
                  </p>
                </div>
              </div>
              {/* local */}
              <div className="overflow-hidden rounded-3xl border-2 border-emerald-300 bg-white shadow-sm">
                <div className="bg-emerald-50 px-4 py-3">
                  <p className="flex items-center gap-2 text-sm font-black text-emerald-700"><Package className="h-4 w-4" /> Desligou DENTRO de uma caixinha</p>
                  <p className="text-[12px] text-emerald-600/80">Some <strong>só daquela</strong> caixinha — nas outras continua</p>
                </div>
                <div className="space-y-3 p-4">
                  <div className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2">
                    <span className="text-[13px] font-bold text-slate-700">🥤 Coca Zero <span className="font-semibold text-slate-400">(em falta só na 2L)</span></span>
                    <Interruptor ligado={false} rotulo="Pausado aqui" />
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <Caixinha titulo="Coca 2L" itens={[{ nome: 'Zero', ligado: false }]} />
                    <Caixinha titulo="Coca 1L" itens={[{ nome: 'Zero', ligado: true }]} />
                    <Caixinha titulo="350ml" itens={[{ nome: 'Zero', ligado: true }]} />
                  </div>
                  <p className="rounded-xl bg-emerald-50 p-2.5 text-[12px] text-emerald-800">
                    Use quando o problema é <strong>só naquela escolha</strong>. O interruptor mostra
                    "Ativo aqui / Pausado aqui" para lembrar que o efeito é local.
                  </p>
                </div>
              </div>
            </div>
          </Secao>

          {/* ── 5. cliente ── */}
          <Secao id="cliente" numero="6" titulo="O que o cliente vê (e por que o botão trava)" lead="Cada caixinha ligada ao produto vira uma etapa. Se a etapa tem um Mínimo, o cliente é OBRIGADO a escolher — e o botão fica cinza até ele escolher.">
            <div className="grid items-start gap-4 md:grid-cols-2">
              {/* celular: faltando escolha */}
              <div className="mx-auto w-full max-w-[290px]">
                <div className="rounded-[2rem] border-[6px] border-slate-800 bg-white p-3 shadow-xl">
                  <p className="mb-2 text-center text-[13px] font-black text-slate-800">PF Strogonoff · R$ 19,90</p>
                  <div className="space-y-2">
                    <div className="rounded-xl border border-slate-200 p-2">
                      <div className="mb-1 flex items-center justify-between">
                        <span className="text-[11px] font-bold text-slate-700">Escolha sua guarnição</span>
                        <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[8px] font-black uppercase text-amber-700">Obrigatório</span>
                      </div>
                      <div className="space-y-1">
                        <div className="flex items-center justify-between rounded bg-slate-50 px-2 py-1 text-[11px] text-slate-600">Farofa <span className="text-slate-300">−  0  +</span></div>
                        <div className="flex items-center justify-between rounded bg-slate-50 px-2 py-1 text-[11px] text-slate-600">Batata frita <span className="text-slate-300">−  0  +</span></div>
                      </div>
                    </div>
                    <div className="rounded-xl bg-red-50 px-2 py-1.5 text-center text-[10px] font-bold text-red-600">⚠ Selecione ao menos 1 em: Escolha sua guarnição</div>
                    <div className="rounded-xl bg-slate-300 py-2 text-center text-[12px] font-black text-slate-500">Adicionar</div>
                  </div>
                </div>
                <p className="mt-2 text-center text-[12px] font-bold text-red-500">Botão travado: falta escolher na etapa obrigatória</p>
              </div>
              {/* celular: liberado */}
              <div className="mx-auto w-full max-w-[290px]">
                <div className="rounded-[2rem] border-[6px] border-slate-800 bg-white p-3 shadow-xl">
                  <p className="mb-2 text-center text-[13px] font-black text-slate-800">PF Strogonoff · R$ 19,90</p>
                  <div className="space-y-2">
                    <div className="rounded-xl border border-emerald-300 bg-emerald-50/40 p-2">
                      <div className="mb-1 flex items-center justify-between">
                        <span className="text-[11px] font-bold text-slate-700">Escolha sua guarnição</span>
                        <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[8px] font-black uppercase text-emerald-700">✓ ok</span>
                      </div>
                      <div className="space-y-1">
                        <div className="flex items-center justify-between rounded bg-white px-2 py-1 text-[11px] font-semibold text-emerald-700">Farofa <span className="text-emerald-600 font-black">−  1  +</span></div>
                        <div className="flex items-center justify-between rounded bg-slate-50 px-2 py-1 text-[11px] text-slate-600">Batata frita <span className="text-slate-300">−  0  +</span></div>
                      </div>
                    </div>
                    <div className="rounded-xl bg-emerald-600 py-2 text-center text-[12px] font-black text-white">Adicionar • R$ 19,90</div>
                  </div>
                </div>
                <p className="mt-2 text-center text-[12px] font-bold text-emerald-600">Escolheu 1 → botão liberado</p>
              </div>
            </div>
            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              <div className="rounded-2xl border border-slate-200 bg-white p-3 text-[13px] text-slate-600">
                <p className="font-black text-slate-800">Mínimo</p>
                Quantos o cliente <strong>precisa</strong> escolher para fechar o pedido. <strong>0 = pode pular a etapa.</strong> Configure ao editar o produto, no cabeçalho de cada etapa.
              </div>
              <div className="rounded-2xl border border-slate-200 bg-white p-3 text-[13px] text-slate-600">
                <p className="font-black text-slate-800">Máximo</p>
                Até quantos pode escolher. <strong>0 = sem limite.</strong> Com máximo 1, escolher outro item troca a seleção automaticamente.
              </div>
            </div>
          </Secao>

          {/* ── 6. pausar x remover ── */}
          <Secao id="lixeira" numero="7" titulo="Pausar não é remover" lead="Três ações parecidas, três efeitos bem diferentes:">
            <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
              <div className="grid divide-y divide-slate-100">
                <div className="grid items-center gap-3 p-4 sm:grid-cols-[auto_1fr_auto]">
                  <Interruptor ligado={false} />
                  <div>
                    <p className="text-[13px] font-black text-slate-800">Interruptor (pausar)</p>
                    <p className="text-[12px] text-slate-500">Temporário. O item fica guardado e volta com um clique. Use quando algo <em>acabou</em>.</p>
                  </div>
                  <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-black uppercase text-emerald-700">Reversível na hora</span>
                </div>
                <div className="grid items-center gap-3 p-4 sm:grid-cols-[auto_1fr_auto]">
                  <Trash2 className="h-5 w-5 text-red-400" />
                  <div>
                    <p className="text-[13px] font-black text-slate-800">Lixeira dentro da caixinha</p>
                    <p className="text-[12px] text-slate-500">Tira o item <em>daquela caixinha</em>. Ele continua na despensa e nas outras caixinhas. Use quando o item <em>não pertence</em> àquela escolha.</p>
                  </div>
                  <span className="rounded-full bg-amber-50 px-2.5 py-1 text-[10px] font-black uppercase text-amber-700">Dá para recolocar</span>
                </div>
                <div className="grid items-center gap-3 p-4 sm:grid-cols-[auto_1fr_auto]">
                  <Trash2 className="h-5 w-5 text-red-600" />
                  <div>
                    <p className="text-[13px] font-black text-slate-800">Lixeira na Lista Matriz</p>
                    <p className="text-[12px] text-slate-500">Apaga o item da despensa <em>de verdade</em> — some de todas as caixinhas e produtos, para sempre.</p>
                  </div>
                  <span className="rounded-full bg-red-50 px-2.5 py-1 text-[10px] font-black uppercase text-red-600">Permanente</span>
                </div>
              </div>
            </div>
            <p className="mt-4 flex items-start gap-2 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-[13px] text-slate-600">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
              <span>
                <strong>Para não esquecer:</strong> selo vermelho <strong>"Pausado"</strong> ao lado do nome = pausado na despensa (sumiu de tudo).
                Interruptor <strong>"Pausado aqui"</strong> = pausado só na caixinha aberta. Na dúvida, abra a Lista Matriz — ela é a verdade.
              </span>
            </p>
          </Secao>
        </main>
      </div>
    </div>
  );
}
