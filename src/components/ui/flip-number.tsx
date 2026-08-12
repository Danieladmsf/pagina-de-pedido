'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

const DIGITOS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];

/**
 * Placar de rolagem, no estilo painel de aeroporto: cada dígito é uma coluna de
 * 0 a 9 que desliza até parar no número certo. Feito com transform puro (o
 * projeto já tem tailwindcss-animate) — não vale carregar uma engine de animação
 * no bundle do PDV, que roda em máquina fraca de loja, para rolar um dígito.
 *
 * O deslocamento é em PORCENTAGEM, não em `em`: a coluna tem 10x a altura da
 * janela e cada dígito ocupa 10% dela, então -10% é sempre exatamente um dígito.
 * A primeira versão media em `em` e parava entre dois números — a altura real da
 * linha não batia com 1em, e o erro se multiplicava pelo valor do dígito (o "0"
 * parecia certo justamente porque o deslocamento era zero).
 *
 * Os dígitos da direita giram um pouco depois dos da esquerda, que é o que dá a
 * sensação de placar mecânico em vez de troca seca de texto.
 */
export function FlipNumber({
  value,
  className,
  digitClassName,
}: {
  value: number;
  className?: string;
  digitClassName?: string;
}) {
  const digitos = String(Math.max(0, Math.floor(value)));

  // Primeiro quadro sai parado no zero e com a transição desligada; no quadro
  // seguinte o valor real entra rolando. É o que faz o placar "carregar" ao
  // abrir a tela em vez de já aparecer com o número cravado.
  const [pronto, setPronto] = React.useState(false);
  React.useEffect(() => {
    const id = requestAnimationFrame(() => setPronto(true));
    return () => cancelAnimationFrame(id);
  }, []);

  return (
    <span className={cn('inline-flex leading-none tabular-nums', className)} role="img" aria-label={String(value)}>
      {digitos.split('').map((digito, i) => (
        <span
          key={`${digitos.length}-${i}`}
          className={cn('relative inline-block h-[1em] overflow-hidden leading-none', digitClassName)}
          aria-hidden
        >
          {/* Fantasma invisível: dá a largura natural do dígito na fonte atual. */}
          <span className="invisible">0</span>
          <span
            className="absolute left-0 top-0 h-[1000%] w-full"
            style={{
              transform: `translateY(-${(pronto ? Number(digito) : 0) * 10}%)`,
              transition: pronto ? 'transform 700ms cubic-bezier(0.22, 1, 0.36, 1)' : 'none',
              transitionDelay: `${i * 60}ms`,
            }}
          >
            {DIGITOS.map((n) => (
              <span key={n} className="flex h-[10%] w-full items-center justify-center">
                {n}
              </span>
            ))}
          </span>
        </span>
      ))}
    </span>
  );
}
