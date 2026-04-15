
"use client"

import React, { createContext, useContext, useState, useEffect } from 'react';
import { CartItem, MenuItem } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';

interface CartContextType {
  cart: CartItem[];
  addToCart: (item: MenuItem, quantity: number, customization?: CartItem['customization']) => void;
  removeFromCart: (cartId: string) => void;
  updateQuantity: (cartId: string, quantity: number) => void;
  clearCart: () => void;
  totalItems: number;
  totalPrice: number;
}

const CartContext = createContext<CartContextType | undefined>(undefined);

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [cart, setCart] = useState<CartItem[]>([]);
  const { toast } = useToast();

  const addToCart = (item: MenuItem, quantity: number, customization?: CartItem['customization']) => {
    const cartId = Math.random().toString(36).substring(7);
    const newItem: CartItem = { ...item, cartId, quantity, customization };
    setCart(prev => [...prev, newItem]);
    toast({
      title: "Item adicionado!",
      description: `${quantity}x ${item.name} adicionado ao carrinho.`
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

  const clearCart = () => setCart([]);

  const itemUnitPrice = (item: CartItem) => {
    const addonsTotal = (item.customization?.addons || []).reduce((a, b) => a + (b.price || 0), 0);
    return item.price + addonsTotal;
  };

  const totalItems = cart.reduce((acc, item) => acc + item.quantity, 0);
  const totalPrice = cart.reduce((acc, item) => acc + (itemUnitPrice(item) * item.quantity), 0);

  return (
    <CartContext.Provider value={{ cart, addToCart, removeFromCart, updateQuantity, clearCart, totalItems, totalPrice }}>
      {children}
    </CartContext.Provider>
  );
}

export const useCart = () => {
  const context = useContext(CartContext);
  if (!context) throw new Error("useCart must be used within a CartProvider");
  return context;
};
