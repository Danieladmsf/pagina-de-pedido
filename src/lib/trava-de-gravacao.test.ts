import { describe, expect, it } from 'vitest';
import { criarTravaDeGravacao } from './trava-de-gravacao';

/** Promessa que só termina quando o teste manda. */
function segurada() {
  let liberar!: () => void;
  let falhar!: (e: Error) => void;
  const promessa = new Promise<void>((resolve, reject) => { liberar = resolve; falhar = reject; });
  return { promessa, liberar, falhar };
}

describe('criarTravaDeGravacao', () => {
  it('segundo clique durante a gravação não grava de novo', async () => {
    const trava = criarTravaDeGravacao();
    const gravacao = segurada();
    let gravou = 0;

    const primeiro = trava.executar(async () => { gravou++; await gravacao.promessa; });
    const segundo = trava.executar(async () => { gravou++; });

    expect(await segundo).toBe(false);
    expect(trava.estaSalvando()).toBe(true);
    gravacao.liberar();
    expect(await primeiro).toBe(true);
    expect(gravou).toBe(1);
    expect(trava.estaSalvando()).toBe(false);
  });

  it('avisa quando trava e quando destrava', async () => {
    const avisos: boolean[] = [];
    const trava = criarTravaDeGravacao((salvando) => avisos.push(salvando));
    await trava.executar(async () => {});
    expect(avisos).toEqual([true, false]);
  });

  it('erro na gravação destrava e deixa tentar de novo', async () => {
    const trava = criarTravaDeGravacao();
    const gravacao = segurada();
    const primeiro = trava.executar(() => gravacao.promessa);
    gravacao.falhar(new Error('sem rede'));
    await expect(primeiro).rejects.toThrow('sem rede');
    expect(trava.estaSalvando()).toBe(false);

    let gravou = 0;
    expect(await trava.executar(async () => { gravou++; })).toBe(true);
    expect(gravou).toBe(1);
  });

  it('depois de terminar, a próxima gravação passa', async () => {
    const trava = criarTravaDeGravacao();
    let gravou = 0;
    await trava.executar(async () => { gravou++; });
    await trava.executar(async () => { gravou++; });
    expect(gravou).toBe(2);
  });
});
