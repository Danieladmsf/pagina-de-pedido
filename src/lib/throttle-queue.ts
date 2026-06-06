/**
 * Fila com limite de concorrência.
 *
 * Em vez de disparar N tarefas de uma vez (ex.: N envios de WhatsApp numa rajada
 * de pedidos, estourando o limite de taxa da API), processa no máximo `limit`
 * por vez. As demais ficam na fila e entram conforme as anteriores terminam.
 */
export function createConcurrencyQueue(limit: number) {
  let active = 0;
  const pending: Array<() => void> = [];

  const pump = () => {
    while (active < limit && pending.length > 0) {
      const job = pending.shift()!;
      active++;
      job();
    }
  };

  return function run<T>(task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      pending.push(() => {
        task()
          .then(resolve, reject)
          .finally(() => {
            active--;
            pump();
          });
      });
      pump();
    });
  };
}
