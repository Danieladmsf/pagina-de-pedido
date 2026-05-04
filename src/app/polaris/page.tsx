'use client';

import React, { useState } from 'react';
import {
  Star,
  Zap,
  ShoppingBag,
  Bike,
  UtensilsCrossed,
  Wallet,
  BarChart3,
  Users,
  Cloud,
  Printer,
  Check,
  ArrowRight,
  Menu,
  X,
} from 'lucide-react';

const FEATURES = [
  {
    Icon: ShoppingBag,
    title: 'Cardápio Digital',
    desc: 'Cardápio com link próprio, fotos, combos, marmitas e adicionais com regras de seleção (mín./máx. e itens grátis).',
  },
  {
    Icon: Bike,
    title: 'Delivery',
    desc: 'Cálculo de taxa de entrega por raio, gestão de motoboys e fluxo do recebido até a entrega.',
  },
  {
    Icon: UtensilsCrossed,
    title: 'Mesas e Comandas',
    desc: 'Controle de mesas, abertura/fechamento de comandas e pedidos diretos do balcão.',
  },
  {
    Icon: Wallet,
    title: 'Caixa',
    desc: 'Abertura, fechamento, sangria, suprimento, lançamentos e relatório por forma de pagamento.',
  },
  {
    Icon: BarChart3,
    title: 'Dashboard',
    desc: 'Vendas, ticket médio, top produtos e gráficos com filtro por período (hoje, 7d, 30d, mês ou personalizado).',
  },
  {
    Icon: Users,
    title: 'Clientes',
    desc: 'Cadastro de clientes com histórico de pedidos, ticket médio individual e importação por CSV.',
  },
  {
    Icon: Printer,
    title: 'Impressão Térmica',
    desc: 'Cupom não-fiscal em impressoras térmicas 80mm, com layout de cozinha e cliente.',
  },
  {
    Icon: Cloud,
    title: 'Multi-dispositivo',
    desc: 'Funciona em qualquer dispositivo com navegador. Web app instalável (PWA).',
  },
];

export default function PolarisLandingPage() {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="min-h-screen bg-black text-white antialiased overflow-x-hidden">
      {/* Background glow */}
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute -top-40 -right-40 h-[500px] w-[500px] rounded-full bg-emerald-500/10 blur-[120px]" />
        <div className="absolute top-1/2 -left-40 h-[400px] w-[400px] rounded-full bg-cyan-500/10 blur-[120px]" />
        <div className="absolute bottom-0 right-1/3 h-[300px] w-[300px] rounded-full bg-violet-500/10 blur-[120px]" />
      </div>

      {/* Header */}
      <header className="relative z-50 border-b border-white/5 backdrop-blur-md bg-black/60 sticky top-0">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <a href="#" className="flex items-center gap-2">
            <div className="h-9 w-9 rounded-lg bg-gradient-to-br from-emerald-400 to-cyan-500 flex items-center justify-center shadow-lg shadow-emerald-500/30">
              <Star className="h-5 w-5 text-black fill-black" />
            </div>
            <span className="text-lg font-black tracking-tight">
              POLARIS<span className="text-emerald-400"> PDV</span>
            </span>
          </a>

          <nav className="hidden md:flex items-center gap-8 text-sm font-medium text-slate-300">
            <a href="#recursos" className="hover:text-white transition-colors">Recursos</a>
            <a href="#contato" className="hover:text-white transition-colors">Contato</a>
          </nav>

          <div className="hidden md:flex items-center gap-3">
            <a href="/login" className="text-sm font-medium text-slate-300 hover:text-white transition-colors">Entrar</a>
            <a
              href="/register"
              className="bg-gradient-to-r from-emerald-500 to-cyan-500 text-black text-sm font-bold px-4 py-2 rounded-lg hover:from-emerald-400 hover:to-cyan-400 transition-all shadow-lg shadow-emerald-500/20"
            >
              Criar conta
            </a>
          </div>

          <button onClick={() => setMenuOpen(!menuOpen)} className="md:hidden p-2 rounded-lg hover:bg-white/5">
            {menuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>

        {menuOpen && (
          <div className="md:hidden border-t border-white/5 bg-black/95 px-6 py-4 flex flex-col gap-3">
            <a href="#recursos" className="text-sm py-2">Recursos</a>
            <a href="#contato" className="text-sm py-2">Contato</a>
            <a href="/login" className="text-sm py-2">Entrar</a>
            <a href="/register" className="bg-gradient-to-r from-emerald-500 to-cyan-500 text-black text-sm font-bold px-4 py-2 rounded-lg text-center">
              Criar conta
            </a>
          </div>
        )}
      </header>

      {/* Hero */}
      <section className="relative z-10 max-w-7xl mx-auto px-6 pt-20 pb-24 md:pt-32 md:pb-40">
        <div className="flex flex-col items-center text-center max-w-4xl mx-auto">
          <h1 className="text-5xl md:text-7xl font-black tracking-tighter leading-[0.95] mb-6">
            O sistema que <span className="bg-gradient-to-r from-emerald-400 via-cyan-400 to-blue-400 bg-clip-text text-transparent">guia</span>
            <br />
            seu restaurante.
          </h1>

          <p className="text-lg md:text-xl text-slate-400 max-w-2xl mb-10 leading-relaxed">
            Cardápio digital, delivery, mesas, caixa e dashboard
            em uma única plataforma.
          </p>

          <div className="flex flex-col sm:flex-row gap-3">
            <a
              href="/register"
              className="group bg-gradient-to-r from-emerald-500 to-cyan-500 text-black font-bold px-7 py-4 rounded-xl hover:from-emerald-400 hover:to-cyan-400 transition-all shadow-lg shadow-emerald-500/30 flex items-center justify-center gap-2"
            >
              Criar conta
              <ArrowRight className="h-4 w-4 group-hover:translate-x-1 transition-transform" />
            </a>
            <a
              href="#recursos"
              className="border border-white/15 px-7 py-4 rounded-xl font-bold hover:bg-white/5 transition-colors"
            >
              Ver recursos
            </a>
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="recursos" className="relative z-10 max-w-7xl mx-auto px-6 py-24">
        <div className="text-center max-w-2xl mx-auto mb-16">
          <span className="text-xs font-bold uppercase tracking-widest text-emerald-400">Recursos</span>
          <h2 className="text-4xl md:text-5xl font-black tracking-tight mt-3 mb-4">
            Tudo num só lugar.
          </h2>
          <p className="text-slate-400 leading-relaxed">
            Os módulos disponíveis hoje na plataforma.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {FEATURES.map((f) => {
            const Icon = f.Icon;
            return (
              <div
                key={f.title}
                className="group relative rounded-2xl border border-white/10 bg-white/[0.02] p-6 hover:border-emerald-500/30 hover:bg-white/[0.04] transition-all"
              >
                <div className="h-11 w-11 rounded-xl bg-gradient-to-br from-emerald-500/20 to-cyan-500/20 border border-emerald-500/20 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                  <Icon className="h-5 w-5 text-emerald-400" />
                </div>
                <h3 className="text-lg font-bold mb-2">{f.title}</h3>
                <p className="text-sm text-slate-400 leading-relaxed">{f.desc}</p>
              </div>
            );
          })}
        </div>
      </section>

      {/* CTA */}
      <section id="contato" className="relative z-10 max-w-5xl mx-auto px-6 py-20">
        <div className="rounded-3xl bg-gradient-to-br from-emerald-500/20 via-cyan-500/10 to-blue-500/10 border border-emerald-500/20 p-12 md:p-16 text-center relative overflow-hidden">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,_rgba(16,185,129,0.15),_transparent_50%)]" />
          <div className="relative">
            <Zap className="h-10 w-10 mx-auto text-emerald-400 mb-6" />
            <h2 className="text-4xl md:text-5xl font-black tracking-tight mb-4">
              Crie sua conta.
            </h2>
            <p className="text-slate-300 max-w-xl mx-auto mb-8">
              Acesse o painel e configure sua loja em minutos.
            </p>
            <a
              href="/register"
              className="inline-flex items-center gap-2 bg-gradient-to-r from-emerald-500 to-cyan-500 text-black font-bold px-8 py-4 rounded-xl hover:from-emerald-400 hover:to-cyan-400 transition-all shadow-2xl shadow-emerald-500/40"
            >
              Cadastrar
              <ArrowRight className="h-4 w-4" />
            </a>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="relative z-10 border-t border-white/5 mt-12">
        <div className="max-w-7xl mx-auto px-6 py-12 flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-emerald-400 to-cyan-500 flex items-center justify-center">
              <Star className="h-4 w-4 text-black fill-black" />
            </div>
            <span className="font-black tracking-tight">
              POLARIS<span className="text-emerald-400"> PDV</span>
            </span>
          </div>
          <div className="flex items-center gap-6 text-xs text-slate-500">
            <a href="/login" className="hover:text-white">Entrar</a>
            <a href="/register" className="hover:text-white">Cadastrar</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
