'use client';

import React, { createContext, useContext, useState } from 'react';

interface MenuLateral {
  aberto: boolean;
  setAberto: (v: boolean) => void;
}

const MenuLateralCtx = createContext<MenuLateral | null>(null);

/**
 * Guarda se o menu lateral está aberto, ACIMA das páginas.
 *
 * Vive no layout do grupo (sistema), que não remonta ao navegar entre /pdv,
 * /gestao e /visitantes. Sem isso o menu fechava sozinho ao clicar em
 * "Visitantes": trocar de aba é só mudar um estado na mesma página, mas
 * Visitantes é rota própria — a outra página montava um segundo menu, que
 * nascia fechado. Para quem usa, um item do menu fechava o menu e os outros
 * não, sem motivo visível.
 */
export function MenuLateralProvider({ children }: { children: React.ReactNode }) {
  const [aberto, setAberto] = useState(false);
  return (
    <MenuLateralCtx.Provider value={{ aberto, setAberto }}>
      {children}
    </MenuLateralCtx.Provider>
  );
}

/** Devolve `null` fora do provider — quem chama cai no próprio estado local. */
export function useMenuLateral() {
  return useContext(MenuLateralCtx);
}
