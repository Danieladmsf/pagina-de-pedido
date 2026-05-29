
"use client"

import React, { createContext, useContext, useState, useEffect } from 'react';
import { CartItem, MenuItem } from '@/lib/types';

interface CartContextType {
  cart: CartItem[];
  addToCart: (item: MenuItem, quantity: number, customization?: CartItem['customization']) => void;
  removeFromCart: (cartId: string) => void;
  updateQuantity: (cartId: string, quantity: number) => void;
  updateItemNotes: (cartId: string, notes: string) => void;
  clearCart: () => void;
  totalItems: number;
  totalPrice: number;
}

const CartContext = createContext<CartContextType | undefined>(undefined);

function areCustomizationsEqual(c1?: CartItem['customization'], c2?: CartItem['customization']): boolean {
  const hasC1 = c1 && (c1.notes || (c1.addons && c1.addons.length > 0));
  const hasC2 = c2 && (c2.notes || (c2.addons && c2.addons.length > 0));
  if (!hasC1 && !hasC2) return true;
  if (!hasC1 || !hasC2) return false;

  if ((c1?.notes || '') !== (c2?.notes || '')) return false;

  const addons1 = c1?.addons || [];
  const addons2 = c2?.addons || [];
  if (addons1.length !== addons2.length) return false;

  const ids1 = addons1.map(a => a.id).sort();
  const ids2 = addons2.map(a => a.id).sort();
  for (let i = 0; i < ids1.length; i++) {
    if (ids1[i] !== ids2[i]) return false;
  }

  return true;
}

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [cart, setCart] = useState<CartItem[]>([]);

  const addToCart = (item: MenuItem, quantity: number, customization?: CartItem['customization']) => {
    setCart(prev => {
      const existingIndex = prev.findIndex(i => i.id === item.id && areCustomizationsEqual(i.customization, customization));
      if (existingIndex > -1) {
        return prev.map((i, idx) => idx === existingIndex ? { ...i, quantity: i.quantity + quantity } : i);
      } else {
        const cartId = Math.random().toString(36).substring(7);
        const newItem: CartItem = { ...item, cartId, quantity, customization };
        return [...prev, newItem];
      }
    });
  };

  const removeFromCart = (cartId: string) => {
    setCart(prev => prev.filter(item => item.cartId !== cartId));
  };

  const updateQuantity = (cartId: string, quantity: number) => {
    if (quantity <= 0) {
      removeFromCart(cartId);
      return;
    }
    setCart(prev => prev.map(item => item.cartId === cartId ? { ...item, quantity } : item));
  };

  const updateItemNotes = (cartId: string, notes: string) => {
    setCart(prev => prev.map(item => {
      if (item.cartId !== cartId) return item;
      return {
        ...item,
        customization: {
          ...(item.customization || {}),
          notes,
        },
      };
    }));
  };

  const clearCart = () => setCart([]);

  const itemUnitPrice = (item: CartItem) => {
    const addonsTotal = (item.customization?.addons || []).reduce((a, b) => a + (b.price || 0), 0);
    return item.price + addonsTotal;
  };

  const totalItems = cart.reduce((acc, item) => acc + item.quantity, 0);
  const totalPrice = cart.reduce((acc, item) => acc + (itemUnitPrice(item) * item.quantity), 0);

  return (
    <CartContext.Provider value={{ cart, addToCart, removeFromCart, updateQuantity, updateItemNotes, clearCart, totalItems, totalPrice }}>
      {children}
    </CartContext.Provider>
  );
}

export const useCart = () => {
  const context = useContext(CartContext);
  if (!context) throw new Error("useCart must be used within a CartProvider");
  return context;
};
