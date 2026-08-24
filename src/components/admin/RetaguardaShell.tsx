'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Wallet } from 'lucide-react';
import { SidebarNav } from '@/components/admin/SidebarNav';
import { useMenuLateral } from '@/contexts/MenuLateralContext';

interface RetaguardaShellProps {
  /** Item aceso no menu lateral. */
  activeTab: string;
  /** Clique num item do menu. Em /gestao troca a aba; nas telas de rota própria, navega. */
  onTabChange: (tab: string) => void;
  storeName?: string;
  storeLogo?: string;
  theme?: string;
  operatorName?: string | null;
  onLogout: () => void;
  children: React.ReactNode;
}

/**
 * A casca do painel: menu lateral + barra escura + área de conteúdo.
 *
 * Existe porque ela morava dentro da página da Retaguarda. Toda tela em rota
 * própria — Visitantes foi a primeira — nascia sem menu e sem barra, e abria
 * como se fosse de outro sistema: sem saída a não ser um botão de voltar, com
 * fundo mais claro e sem a escala de 83% que o resto do painel usa.
 *
 * Quem monta esta casca herda tudo isso de graça, inclusive o `admin-scale`.
 */
export function RetaguardaShell({
  activeTab,
  onTabChange,
  storeName,
  storeLogo,
  theme,
  operatorName,
  onLogout,
  children,
}: RetaguardaShellProps) {
  const router = useRouter();
  // O menu aberto pertence ao layout, não a esta tela: navegar para Visitantes
  // monta outro shell, e um estado local aqui faria o menu fechar sozinho.
  const menu = useMenuLateral();
  const [aberturaLocal, setAberturaLocal] = useState(false);
  const isSidebarOpen = menu ? menu.aberto : aberturaLocal;
  const setIsSidebarOpen = menu ? menu.setAberto : setAberturaLocal;

  return (
    <div className="admin-scale h-screen bg-slate-100 flex overflow-hidden">
      <SidebarNav
        activeTab={activeTab}
        setActiveTab={onTabChange}
        isOpen={isSidebarOpen}
        setIsOpen={setIsSidebarOpen}
        storeName={storeName}
        storeLogo={storeLogo}
        theme={theme}
      />
      <div className="flex-1 flex flex-col min-w-0 transition-all duration-300 relative z-0">
        {/* Dark Top Navigation Bar */}
        <div className="bg-[#2a3042] text-slate-300 h-14 flex justify-between items-center pr-4 pl-14 shrink-0 shadow-sm z-10">
          <div className="flex h-full items-center">
            <button
              onClick={() => router.push('/pdv')}
              className="px-6 h-full flex items-center gap-2 text-sm font-medium transition-colors hover:bg-white/10"
              title="Ir para a frente de caixa (pedidos, mesas, caixa)"
            >
              <Wallet className="h-4 w-4" />
              Frente de Caixa
            </button>
          </div>

          <div className="flex items-center gap-4 h-full">
            {operatorName && <span className="hidden text-xs text-slate-400 sm:inline">{operatorName}</span>}
            <button onClick={onLogout} className="text-sm font-medium hover:text-white transition-colors">
              Sair
            </button>
          </div>
        </div>

        {/* Content Area */}
        <div className="flex-1 p-2 overflow-hidden flex flex-col min-h-0">
          {children}
        </div>
      </div>
    </div>
  );
}
