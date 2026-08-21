/**
 * Marca de contato no link do cardápio.
 *
 * O problema: nenhum site consegue ler o telefone de quem abriu a página — não
 * existe essa permissão no navegador. Quem entra pelo link é anônimo, e a loja
 * vê "1 pessoa sem cadastro" mesmo tendo acabado de mandar aquele link para um
 * número que ela conhece.
 *
 * A solução: quando é a PRÓPRIA loja que manda o link (resposta automática,
 * campanha, aviso de pedido), o endereço sai com uma marca que diz "este link
 * foi para este contato". Quem clicar é reconhecido sem digitar nada.
 *
 * O que a marca NÃO é: ela não carrega o telefone à vista. É um texto cifrado
 * (ver `contato-link.server`), aberto só no servidor, e com validade curta.
 *
 * O que ela NÃO garante: link é encaminhável. Se a cliente mandar o link para
 * uma amiga, a amiga chega marcada com o contato de quem encaminhou. Por isso a
 * identidade que vem daqui é PROVÁVEL (`viaLink`) e é substituída na hora em que
 * a pessoa digita o próprio telefone no carrinho.
 *
 * Este arquivo é puro de propósito (sem `node:crypto`): ele roda no cardápio,
 * no servidor de envio e nos testes.
 */

/** Parâmetro que carrega a marca. Curto porque o cliente vê o link inteiro. */
export const MARCA_PARAM = 'c';

/** Quantos dias a marca vale. Curto: é um convite, não um cadastro. */
export const VALIDADE_PADRAO_DIAS = 7;

/**
 * Acrescenta a marca a um endereço, respeitando o que já estiver na query
 * (`?pedir=de` continua valendo).
 */
export function adicionarMarca(url: string, marca: string): string {
  if (!url || !marca) return url;
  if (url.includes(`${MARCA_PARAM}=`)) return url;
  const [semHash, hash] = url.split('#');
  const separador = semHash.includes('?') ? '&' : '?';
  const marcado = `${semHash}${separador}${MARCA_PARAM}=${encodeURIComponent(marca)}`;
  return hash ? `${marcado}#${hash}` : marcado;
}

function escaparRegex(texto: string) {
  return texto.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Marca todos os endereços do cardápio DESTA loja que aparecerem num texto.
 *
 * Trabalha em cima do texto já pronto porque as mensagens saem de quatro lugares
 * diferentes (resposta automática, avisos do PDV, campanhas, envio manual) e
 * todas passam pelo mesmo cano de envio. Casar pelo caminho da loja
 * (`/nome-da-loja-a1b2`) evita marcar link de terceiro que a loja tenha colado
 * na mensagem.
 */
export function marcarLinksDoCardapio(texto: string, caminhoDaLoja: string, marca: string): string {
  if (!texto || !caminhoDaLoja || !marca) return texto;
  const padrao = new RegExp(`https?://[^\\s]*${escaparRegex(caminhoDaLoja)}[^\\s]*`, 'g');
  return texto.replace(padrao, (url) => {
    // Pontuação final ("...cardápio: https://x/loja-a1b2.") não faz parte do
    // endereço e não pode entrar no meio da marca.
    const fim = url.match(/[.,;:!?)]+$/)?.[0] || '';
    const limpo = fim ? url.slice(0, -fim.length) : url;
    return adicionarMarca(limpo, marca) + fim;
  });
}

/** Lê a marca de um endereço aberto (o cardápio chama com os parâmetros da URL). */
export function extrairMarca(params: URLSearchParams | null | undefined): string {
  const valor = params?.get(MARCA_PARAM) || '';
  return valor.trim();
}

/**
 * Código curto que o cliente leva junto quando sai do cardápio para o WhatsApp
 * da loja.
 *
 * Serve para o outro lado do problema: a pessoa que NÃO veio por um link nosso,
 * olhou o cardápio e resolveu chamar no WhatsApp. A mensagem dela chega com o
 * código, e aí sim a loja sabe que aquele número é a visita que estava vendo os
 * produtos há dois minutos.
 *
 * Alfabeto sem 0/O/1/I/L: o cliente pode acabar digitando isso à mão.
 */
const ALFABETO = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
export const TAMANHO_DO_CODIGO = 5;

export function codigoDoVisitante(visitorId: string): string {
  if (!visitorId) return '';
  // Hash simples e estável (FNV-1a): o mesmo visitante gera sempre o mesmo
  // código, em qualquer aba, sem precisar guardar nada a mais.
  let hash = 0x811c9dc5;
  for (let i = 0; i < visitorId.length; i++) {
    hash ^= visitorId.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  let codigo = '';
  for (let i = 0; i < TAMANHO_DO_CODIGO; i++) {
    codigo += ALFABETO[hash % ALFABETO.length];
    hash = Math.floor(hash / ALFABETO.length) + (i + 1) * 0x9e3779b1;
    hash = hash >>> 0;
  }
  return codigo;
}

/** Como o código aparece na mensagem que o cliente manda para a loja. */
export function textoDoPedidoPeloWhatsapp(codigo?: string | null): string {
  const base = 'Olá! Gostaria de fazer um pedido.';
  return codigo ? `${base}\n\nCód. #${codigo}` : base;
}

/**
 * Acha o código na mensagem que chegou. Aceita com ou sem "Cód." na frente e
 * ignora o resto do texto — a pessoa pode ter escrito antes ou depois.
 */
export function extrairCodigoDaMensagem(texto: string): string {
  const achado = String(texto || '').match(
    new RegExp(`#\\s*([${ALFABETO}]{${TAMANHO_DO_CODIGO}})\\b`, 'i')
  );
  return achado ? achado[1].toUpperCase() : '';
}
