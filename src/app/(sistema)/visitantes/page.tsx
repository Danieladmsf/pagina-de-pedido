'use client';

import { VisitantesPage } from '@/components/system/VisitantesPage';

/**
 * Rota da tela de quem passou no cardápio.
 *
 * Fica no grupo (sistema) — mesmo guard de login do PDV e da Retaguarda — e
 * NÃO atrás da senha da Retaguarda de propósito: quem está no balcão precisa
 * chamar o cliente que deixou o carrinho parado sem parar para pedir senha.
 */
export default function Page() {
  return <VisitantesPage />;
}
