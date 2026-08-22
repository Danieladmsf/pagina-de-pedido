'use client';

import React, { useState } from 'react';
import { Star, Menu, X } from 'lucide-react';

// Único pedaço interativo da landing (o menu sanfona do celular). O resto da
// página é server component de propósito: o HTML precisa chegar pronto ao
// Google, que antes recebia um <body> vazio porque a tela inteira era client.
export function LandingHeader() {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <header className="relative z-50 border-b border-white/5 backdrop-blur-md bg-black/60 sticky top-0">
      <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
        <a href="/polaris" className="flex items-center gap-2">
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

        <button
          onClick={() => setMenuOpen(!menuOpen)}
          className="md:hidden p-2 rounded-lg hover:bg-white/5"
          aria-label={menuOpen ? 'Fechar menu' : 'Abrir menu'}
          aria-expanded={menuOpen}
        >
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
  );
}
