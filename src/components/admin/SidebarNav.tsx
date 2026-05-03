import React, { useState } from 'react';
import { 
  LayoutDashboard, 
  Box, 
  Tag, 
  PlusCircle, 
  Users, 
  Store, 
  ChevronDown,
  ChevronRight,
  Contact,
  Percent,
  Clock,
  Bike,
  Wallet,
  Menu
} from 'lucide-react';

interface SidebarNavProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  isOpen: boolean;
  setIsOpen: (isOpen: boolean) => void;
}

export function SidebarNav({ activeTab, setActiveTab, isOpen, setIsOpen }: SidebarNavProps) {
  const [isProfileOpen, setIsProfileOpen] = useState(false);

  const navItems = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'produtos', label: 'Produtos', icon: Box },
    { id: 'categorias', label: 'Categorias', icon: Tag },
    { id: 'addons', label: 'Adicionais', icon: PlusCircle },
    { id: 'clientes', label: 'Clientes', icon: Users },
  ];

  const profileItems = [
    { id: 'perfil_geral', label: 'Dados e Contato', icon: Contact },
    { id: 'perfil_taxas', label: 'Taxas e Prazos', icon: Percent },
    { id: 'perfil_horarios', label: 'Horários', icon: Clock },
    { id: 'perfil_motoboys', label: 'Motoboys', icon: Bike },
    { id: 'perfil_pagamentos', label: 'Pagamentos', icon: Wallet },
  ];

  return (
    <>
      <div 
        className={`relative h-full bg-[#1c1c1c] text-[#f8f9fa] shadow-xl border-r border-black/20 transition-all duration-300 z-50 overflow-hidden flex flex-col shrink-0`}
        style={{ width: isOpen ? '256px' : '0px', opacity: isOpen ? 1 : 0, borderRightWidth: isOpen ? '1px' : '0px' }}
        onMouseLeave={() => {
          setIsOpen(false);
          setIsProfileOpen(false); // opcional, fecha o acordeão de perfil
        }}
      >
        <div className="flex-1 overflow-y-auto py-4 flex flex-col gap-1 px-2 custom-scrollbar">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              onClick={() => setActiveTab(item.id)}
              className={`flex items-center w-full rounded-lg transition-colors overflow-hidden shrink-0 ${
                isActive ? 'bg-emerald-500/20 text-emerald-400' : 'hover:bg-white/5 text-slate-300'
              }`}
              style={{ height: '44px' }}
            >
              <div className="w-12 h-full flex items-center justify-center shrink-0">
                <Icon className="w-5 h-5" />
              </div>
              <span className={`font-medium whitespace-nowrap transition-opacity ${isOpen ? 'opacity-100' : 'opacity-0'}`}>
                {item.label}
              </span>
            </button>
          );
        })}

        {/* Perfil expansível */}
        <div className="mt-4 pt-4 border-t border-white/10">
          <button
            onClick={() => setIsProfileOpen(!isProfileOpen)}
            className={`flex items-center w-full rounded-lg transition-colors overflow-hidden shrink-0 ${
              activeTab.startsWith('perfil_') ? 'text-emerald-400' : 'hover:bg-white/5 text-slate-300'
            }`}
            style={{ height: '44px' }}
          >
            <div className="w-12 h-full flex items-center justify-center shrink-0">
              <Store className="w-5 h-5" />
            </div>
            <span className={`flex-1 text-left font-medium whitespace-nowrap transition-opacity ${isOpen ? 'opacity-100' : 'opacity-0'}`}>
              Perfil da Loja
            </span>
            <div className="w-8 h-full flex items-center justify-center shrink-0">
              {isProfileOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
            </div>
          </button>

          {/* Sub-itens do perfil */}
          <div 
            className={`overflow-hidden transition-all duration-300 flex flex-col gap-1`}
            style={{ 
              height: isOpen && isProfileOpen ? `${profileItems.length * 40}px` : '0px',
              opacity: isOpen && isProfileOpen ? 1 : 0
            }}
          >
            {profileItems.map((subItem) => {
              const SubIcon = subItem.icon;
              const isSubActive = activeTab === subItem.id;
              return (
                <button
                  key={subItem.id}
                  onClick={() => setActiveTab(subItem.id)}
                  className={`flex items-center w-full rounded-md transition-colors overflow-hidden shrink-0 pl-10 ${
                    isSubActive ? 'bg-emerald-500/20 text-emerald-400' : 'hover:bg-white/5 text-slate-400 hover:text-slate-200'
                  }`}
                  style={{ height: '36px' }}
                >
                  <SubIcon className="w-4 h-4 mr-3 shrink-0" />
                  <span className="text-sm whitespace-nowrap">{subItem.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>

      {/* Orelha (Botão de Toggle) */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        onMouseEnter={() => !isOpen && setIsOpen(true)}
        className={`fixed top-2 z-[60] w-12 h-10 bg-[#1c1c1c] border border-[#1c1c1c] text-[#f8f9fa] flex items-center justify-end pr-3 rounded-r-full shadow-lg transition-all duration-300 cursor-pointer hover:bg-black ${isOpen ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}
        style={{ left: isOpen ? '256px' : '0px' }}
      >
        <Menu className="w-5 h-5" />
      </button>
    </>
  );
}
