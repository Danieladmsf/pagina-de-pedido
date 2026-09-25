'use client';

import { useRef, useState } from 'react';
import { criarTravaDeGravacao } from '@/lib/trava-de-gravacao';

/**
 * Trava de botão de salvar: `salvar(gravar)` ignora novos cliques enquanto a
 * gravação anterior não termina, e `salvando` fica true para o botão mostrar
 * "Salvando..." e ficar desabilitado. Regra e testes em lib/trava-de-gravacao.
 */
export function useSalvando() {
  const [salvando, setSalvando] = useState(false);
  const trava = useRef<ReturnType<typeof criarTravaDeGravacao> | null>(null);
  if (!trava.current) trava.current = criarTravaDeGravacao(setSalvando);
  return { salvando, salvar: trava.current.executar };
}
