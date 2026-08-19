/**
 * Público do cardápio: quem está online agora e quantas visitas a loja recebeu
 * na sessão de caixa aberta.
 *
 * Duas coleções, com papéis diferentes de propósito:
 * - `active_sessions`: presença VOLÁTIL. Um doc por aba aberta, com ping
 *   periódico. Serve para "quantos estão no cardápio agora" e nada mais.
 * - `store_visits`: registro APPEND-ONLY de visita, um por sessão de navegador.
 *   É o que permite contar a sessão de caixa inteira sem depender de ninguém
 *   continuar com a página aberta.
 */

/** De quanto em quanto tempo a aba do cliente avisa que continua viva. */
export const PING_INTERVALO_MS = 30_000;

/**
 * Idade máxima de um ping para o cliente ainda contar como online. Dois pings
 * perdidos de tolerância — rede de celular oscila, e um corte curto demais fazia
 * o número piscar.
 */
export const ONLINE_TTL_MS = 90_000;

/**
 * A partir daqui a sessão é lixo: a aba foi fechada sem avisar (celular, crash,
 * troca de app) e o doc ficou órfão. O painel apaga o que encontra nessa faixa.
 * Bem maior que o TTL de online para nunca apagar quem só está com a rede ruim.
 */
export const FANTASMA_TTL_MS = 10 * 60_000;

/** Teto de exclusões por rodada, para o painel não disparar centenas de deletes de uma vez. */
export const LIMPEZA_POR_RODADA = 25;

export type SessaoPresenca = { id: string; lastActive?: unknown };

/**
 * `lastActive` conviveu em dois formatos: número (Date.now() do celular do
 * cliente, formato antigo) e Timestamp do servidor (atual). O relógio do
 * aparelho podia estar adiantado e deixar a sessão "online" para sempre, por
 * isso a escrita nova é sempre do servidor — mas a leitura aceita os dois
 * enquanto houver doc antigo no banco.
 */
export function paraMillis(valor: unknown): number | null {
  if (typeof valor === 'number' && Number.isFinite(valor)) return valor;
  if (valor && typeof valor === 'object') {
    const comToDate = valor as { toDate?: () => Date; seconds?: number };
    if (typeof comToDate.toDate === 'function') {
      const data = comToDate.toDate();
      return Number.isNaN(data.getTime()) ? null : data.getTime();
    }
    if (typeof comToDate.seconds === 'number') return comToDate.seconds * 1000;
  }
  return null;
}

/**
 * Separa quem está online de quem é lixo. Sessão sem `lastActive` legível não
 * conta como online nem é apagada de imediato: pode ser um ping que ainda não
 * voltou do servidor.
 */
export function classificarSessoes(sessoes: SessaoPresenca[], agora: number) {
  const online: string[] = [];
  const fantasmas: string[] = [];

  for (const sessao of sessoes) {
    const quando = paraMillis(sessao.lastActive);
    if (quando === null) continue;
    const idade = agora - quando;
    // Relógio adiantado (idade negativa) não vira online eterno: só vale a
    // janela do TTL para frente e para trás.
    if (idade >= -ONLINE_TTL_MS && idade <= ONLINE_TTL_MS) online.push(sessao.id);
    else if (idade > FANTASMA_TTL_MS) fantasmas.push(sessao.id);
  }

  return { online, fantasmas: fantasmas.slice(0, LIMPEZA_POR_RODADA) };
}

/**
 * O ping só pode ser gravado com o ID real da loja. A resolução do link curto
 * tem fallback para o próprio slug quando a busca falha, e esse valor vazava
 * para o banco: a sessão ficava com `storeId: "2cdrdn"` e o painel, que filtra
 * pelo ownerId, nunca via aquele cliente. Sem ID resolvido, não pinga.
 */
export function ehIdDeLojaResolvido(storeId: unknown): storeId is string {
  return typeof storeId === 'string' && storeId.trim().length > 8;
}

/**
 * Uma visita por sessão de navegador: recarregar a página ou navegar entre
 * cardápio e ofertas não infla o placar. Fechar a aba e voltar depois conta de
 * novo — é uma visita nova mesmo.
 */
export function marcarVisitaDaSessao(storage: Storage | null | undefined, storeId: string): boolean {
  const chave = `visita:${storeId}`;

  // Modo privado / storage bloqueado: cai para a memória do processo, que ao
  // menos segura o recarregamento dentro da mesma aba.
  const marcarEmMemoria = () => {
    if (marcadasEmMemoria.has(chave)) return false;
    marcadasEmMemoria.add(chave);
    return true;
  };

  if (!storage) return marcarEmMemoria();
  try {
    if (storage.getItem(chave)) return false;
    storage.setItem(chave, '1');
    return true;
  } catch {
    return marcarEmMemoria();
  }
}

const marcadasEmMemoria = new Set<string>();

/** Só para os testes: zera o estado de fallback entre casos. */
export function _limparMarcasEmMemoria() {
  marcadasEmMemoria.clear();
}

/**
 * Identidade do NAVEGADOR, não da aba: fica no `localStorage` e sobrevive a
 * fechar a aba, ao pedido e ao dia seguinte. É o que separa "118 aberturas de
 * cardápio" de "quantas pessoas diferentes passaram aqui" — sem ele, a mesma
 * pessoa clicando o link do WhatsApp três vezes vira três visitantes.
 *
 * Anônimo de propósito: um id aleatório sem nada da pessoa dentro. O nome e o
 * telefone só entram quando ela mesma se apresenta no carrinho.
 */
export const CHAVE_VISITOR_ID = 'visitante:id';

let visitorIdEmMemoria: string | null = null;

function novoId(): string {
  const cripto = typeof globalThis !== 'undefined' ? (globalThis.crypto as Crypto | undefined) : undefined;
  if (cripto?.randomUUID) return cripto.randomUUID();
  return `v${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Devolve o id do visitante, criando na primeira vez. Storage bloqueado (aba
 * anônima, iOS com cookies travados) cai para a memória do processo: o número
 * ainda funciona dentro da visita, só não reconhece a pessoa amanhã.
 */
export function obterVisitorId(storage: Storage | null | undefined): string {
  if (!storage) {
    if (!visitorIdEmMemoria) visitorIdEmMemoria = novoId();
    return visitorIdEmMemoria;
  }
  try {
    const salvo = storage.getItem(CHAVE_VISITOR_ID);
    if (salvo) return salvo;
    const id = novoId();
    storage.setItem(CHAVE_VISITOR_ID, id);
    return id;
  } catch {
    if (!visitorIdEmMemoria) visitorIdEmMemoria = novoId();
    return visitorIdEmMemoria;
  }
}

/**
 * Aparelho da própria loja não conta como cliente.
 *
 * O botão "Abrir cardápio público" da Retaguarda abre uma ABA NOVA a cada
 * clique, e aba nova era visita nova: a loja inflava o próprio placar só de
 * conferir preço. Quem está logado como dono da loja é reconhecido na hora; o
 * aparelho fica marcado para continuar de fora mesmo depois, deslogado, quando
 * não dá mais para saber quem é.
 */
export const CHAVE_DISPOSITIVO_INTERNO = 'visitante:interno';

export function marcarDispositivoDaLoja(storage: Storage | null | undefined, storeId: string) {
  if (!storage || !storeId) return;
  try {
    const atual = lerDispositivosDaLoja(storage);
    if (atual.includes(storeId)) return;
    storage.setItem(CHAVE_DISPOSITIVO_INTERNO, JSON.stringify([...atual, storeId]));
  } catch {
    /* sem storage: a checagem por login ainda vale nesta visita */
  }
}

function lerDispositivosDaLoja(storage: Storage): string[] {
  try {
    const bruto = storage.getItem(CHAVE_DISPOSITIVO_INTERNO);
    if (!bruto) return [];
    const lista = JSON.parse(bruto);
    return Array.isArray(lista) ? lista.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * `true` quando a visita é da própria loja: ou quem está logado É o dono desta
 * loja, ou este aparelho já foi reconhecido antes. Confere o uid contra o id
 * DESTA loja — dono de outra loja olhando o cardápio é cliente como qualquer um.
 */
export function ehVisitaDaPropriaLoja(
  storage: Storage | null | undefined,
  storeId: string,
  uidLogado?: string | null
): boolean {
  if (!storeId) return false;
  if (uidLogado && uidLogado === storeId) return true;
  if (!storage) return false;
  return lerDispositivosDaLoja(storage).includes(storeId);
}
