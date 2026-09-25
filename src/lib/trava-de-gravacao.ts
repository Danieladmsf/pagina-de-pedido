/**
 * Uma gravação por vez.
 *
 * Nasceu do "Salvar Produto": o botão destravava assim que a foto subia, com o
 * produto ainda gravando, e o segundo clique criava outro produto do zero — 4
 * pares na Gostinho de Céu em set/2026, cada um com o estoque inicial em dobro.
 *
 * Enquanto uma gravação roda, as próximas chamadas são ignoradas (devolvem
 * false) e `aoMudar` avisa quem precisa travar o botão. A trava é síncrona:
 * vale já no segundo clique, antes de qualquer tela redesenhar. Erro na
 * gravação destrava, para a pessoa poder tentar de novo.
 *
 * Nas telas, use pelo hook `useSalvando`.
 */
export function criarTravaDeGravacao(aoMudar?: (salvando: boolean) => void) {
  let emAndamento = false;
  return {
    estaSalvando: () => emAndamento,
    async executar(gravar: () => Promise<unknown>): Promise<boolean> {
      if (emAndamento) return false;
      emAndamento = true;
      aoMudar?.(true);
      try {
        await gravar();
        return true;
      } finally {
        emAndamento = false;
        aoMudar?.(false);
      }
    },
  };
}
