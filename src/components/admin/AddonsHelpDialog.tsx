'use client';

import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { HelpCircle } from 'lucide-react';

/* Guia visual dos Adicionais: linguagem simples, sem termos técnicos.
   Os "desenhos" são caixinhas e interruptores montados em HTML mesmo,
   para nunca quebrarem e seguirem o tema. */

function Interruptor({ ligado, rotulo }: { ligado: boolean; rotulo?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 align-middle">
      <span className={`inline-flex h-4 w-7 items-center rounded-full p-0.5 transition-colors ${ligado ? 'bg-green-500 justify-end' : 'bg-red-400 justify-start'}`}>
        <span className="h-3 w-3 rounded-full bg-white shadow" />
      </span>
      {rotulo && <span className={`text-[10px] font-bold uppercase ${ligado ? 'text-green-600' : 'text-red-500'}`}>{rotulo}</span>}
    </span>
  );
}

function Caixinha({ titulo, itens, apagada }: { titulo: string; itens: Array<{ nome: string; ligado: boolean }>; apagada?: boolean }) {
  return (
    <div className={`rounded-xl border-2 p-2.5 ${apagada ? 'border-slate-200 bg-slate-50 opacity-50' : 'border-emerald-200 bg-white'}`}>
      <p className="mb-1.5 text-[11px] font-black text-slate-700">📦 {titulo}</p>
      <div className="space-y-1">
        {itens.map((it) => (
          <div key={it.nome} className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-2 py-1">
            <span className={`text-[11px] font-medium ${it.ligado ? 'text-slate-700' : 'text-slate-400 line-through'}`}>{it.nome}</span>
            <Interruptor ligado={it.ligado} />
          </div>
        ))}
      </div>
    </div>
  );
}

function Secao({ numero, titulo, children }: { numero: string; titulo: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4">
      <h3 className="mb-2 flex items-center gap-2 text-sm font-black text-slate-800">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-600 text-[12px] text-white">{numero}</span>
        {titulo}
      </h3>
      {children}
    </section>
  );
}

export function AddonsHelpDialog() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Como funcionam os adicionais? Clique para ver o guia"
        className="flex h-7 w-7 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 transition-colors hover:bg-emerald-200"
      >
        <HelpCircle className="h-4.5 w-4.5" />
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[88dvh] overflow-y-auto sm:max-w-[640px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-lg">
              <HelpCircle className="h-5 w-5 text-emerald-600" /> Guia rápido: como funcionam os Adicionais
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 pb-2 text-sm text-slate-600">

            <Secao numero="1" titulo="A Lista Matriz é a sua despensa">
              <p className="mb-2 text-[13px]">
                Todo adicional que existe na loja mora aqui — como os ingredientes na despensa.
                É <strong>um cadastro só</strong> de cada item, com nome e preço.
              </p>
              <div className="rounded-xl border-2 border-dashed border-amber-300 bg-amber-50/60 p-2.5">
                <p className="mb-1.5 text-[11px] font-black text-amber-800">🏠 LISTA MATRIZ (despensa)</p>
                <div className="flex flex-wrap gap-1.5">
                  {['🍗 Frango', '🥤 Coca Zero', '🥤 Coca Normal', '🍟 Batata frita', '🥚 Ovo frito', '🧀 Queijo'].map(n => (
                    <span key={n} className="rounded-full bg-white px-2 py-0.5 text-[11px] font-semibold text-slate-700 ring-1 ring-amber-200">{n}</span>
                  ))}
                </div>
              </div>
            </Secao>

            <Secao numero="2" titulo="Containers são caixinhas de escolha">
              <p className="mb-2 text-[13px]">
                Uma caixinha agrupa itens da despensa para o cliente escolher.
                <strong> O mesmo item pode estar em várias caixinhas</strong> — a Coca Zero, por exemplo:
              </p>
              <div className="grid grid-cols-3 gap-2">
                <Caixinha titulo="Coca 2L" itens={[{ nome: 'Normal', ligado: true }, { nome: 'Zero', ligado: true }]} />
                <Caixinha titulo="Coca 1L" itens={[{ nome: 'Normal', ligado: true }, { nome: 'Zero', ligado: true }]} />
                <Caixinha titulo="Coca 350ml" itens={[{ nome: 'Normal', ligado: true }, { nome: 'Zero', ligado: true }]} />
              </div>
            </Secao>

            <Secao numero="3" titulo="O produto mostra as caixinhas como etapas">
              <p className="mb-2 text-[13px]">
                Quando você liga uma caixinha a um produto, ela vira uma <strong>etapa de escolha </strong>
                no pedido do cliente. Em cada etapa você define:
              </p>
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <p className="mb-2 text-[11px] font-black text-slate-500">📱 O QUE O CLIENTE VÊ NO PRODUTO:</p>
                <div className="space-y-1.5">
                  <div className="rounded-lg bg-white p-2 ring-1 ring-slate-200">
                    <div className="flex items-center justify-between">
                      <span className="text-[12px] font-bold text-slate-800">Escolha sua guarnição</span>
                      <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[9px] font-black uppercase text-amber-700">Obrigatório</span>
                    </div>
                    <p className="text-[10px] text-slate-400">Escolha de 1 a 2 · ele precisa escolher para fechar o pedido</p>
                  </div>
                  <div className="rounded-lg bg-white p-2 ring-1 ring-slate-200">
                    <div className="flex items-center justify-between">
                      <span className="text-[12px] font-bold text-slate-800">Quer turbinar? (opcional)</span>
                      <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[9px] font-bold text-slate-500">Escolha até 3</span>
                    </div>
                    <p className="text-[10px] text-slate-400">Mínimo 0 · ele pode pular esta etapa</p>
                  </div>
                </div>
              </div>
              <p className="mt-2 text-[12px]">
                <strong>Mínimo</strong> = quantos ele é obrigado a escolher (0 = pode pular). {' '}
                <strong>Máximo</strong> = até quantos pode escolher (0 = sem limite).
              </p>
            </Secao>

            <Secao numero="4" titulo="A regra de ouro: onde você desliga muda o efeito">
              <div className="grid gap-2 sm:grid-cols-2">
                <div className="rounded-xl border-2 border-red-200 bg-red-50/50 p-3">
                  <p className="mb-1 text-[12px] font-black text-red-700">🏠 Desligou na LISTA MATRIZ?</p>
                  <p className="mb-2 text-[11px]">Some de <strong>TODAS</strong> as caixinhas de uma vez.</p>
                  <p className="mb-1.5 text-[11px] font-semibold text-slate-600">Ex.: acabou o frango 🍗</p>
                  <div className="grid grid-cols-3 gap-1.5">
                    <Caixinha titulo="Marmita P" itens={[{ nome: 'Frango', ligado: false }]} apagada />
                    <Caixinha titulo="Marmita G" itens={[{ nome: 'Frango', ligado: false }]} apagada />
                    <Caixinha titulo="PF do dia" itens={[{ nome: 'Frango', ligado: false }]} apagada />
                  </div>
                </div>
                <div className="rounded-xl border-2 border-emerald-200 bg-emerald-50/50 p-3">
                  <p className="mb-1 text-[12px] font-black text-emerald-700">📦 Desligou DENTRO da caixinha?</p>
                  <p className="mb-2 text-[11px]">Some <strong>só dali</strong> — nas outras continua.</p>
                  <p className="mb-1.5 text-[11px] font-semibold text-slate-600">Ex.: Zero em falta só na 2L 🥤</p>
                  <div className="grid grid-cols-3 gap-1.5">
                    <Caixinha titulo="Coca 2L" itens={[{ nome: 'Zero', ligado: false }]} />
                    <Caixinha titulo="Coca 1L" itens={[{ nome: 'Zero', ligado: true }]} />
                    <Caixinha titulo="350ml" itens={[{ nome: 'Zero', ligado: true }]} />
                  </div>
                </div>
              </div>
            </Secao>

            <Secao numero="5" titulo="Pausar não é a mesma coisa que remover">
              <ul className="space-y-1.5 text-[12px]">
                <li className="flex items-start gap-2">
                  <Interruptor ligado={false} />
                  <span><strong>Pausar</strong> é temporário: o item fica guardado e volta com um clique. Use quando algo <em>acabou</em>.</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-red-400">🗑️</span>
                  <span><strong>A lixeira dentro da caixinha</strong> tira o item daquela caixinha (dá para colocar de volta depois pela seleção em massa). Use quando o item <em>não pertence</em> àquela escolha.</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-red-500">🗑️</span>
                  <span><strong>A lixeira na Lista Matriz</strong> apaga o item da despensa de verdade — some de tudo, para sempre.</span>
                </li>
              </ul>
            </Secao>

            <Secao numero="6" titulo="Dicas rápidas">
              <ul className="list-inside space-y-1.5 text-[12px]">
                <li>🔍 Clique no <strong>nome de um item</strong> na Lista Matriz: as caixinhas que o usam ficam laranja e sobem para o topo da lista.</li>
                <li>🔗 Com uma caixinha aberta, a <strong>coluna da direita</strong> mostra os produtos: marque para ligar a caixinha ao produto, desmarque para tirar.</li>
                <li>🏷️ O selo vermelho <strong>"Pausado"</strong> ao lado do nome = pausado na despensa (em tudo). <strong>"Pausado aqui"</strong> no interruptor = só naquela caixinha.</li>
                <li>💰 Caixinha com <strong>"Sem preço"</strong>: os itens dela não somam no valor do pedido (ex.: escolha de guarnição já inclusa no prato).</li>
              </ul>
            </Secao>

          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
