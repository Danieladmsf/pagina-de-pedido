/**
 * Visitantes do cardápio: quem passou, o que olhou, o que deixou no carrinho e
 * se fechou o pedido.
 *
 * A contagem de visitas (`store_visits`) responde QUANTAS; esta camada responde
 * QUEM e O QUÊ. São dados diferentes de propósito:
 *
 * - `store_visits`: append-only, um doc por sessão de navegador. É o placar.
 * - `store_visitors`: um doc por (loja, visitante), reescrito conforme a pessoa
 *   navega. Guarda o estado ATUAL (carrinho de agora, últimos produtos vistos)
 *   e os contadores de vida (quantas sessões, quantos pedidos). É o que sustenta
 *   as fotos no card e a tela de oportunidades.
 *
 * Por que um doc só por pessoa em vez de uma coleção de eventos: a loja abre o
 * painel e quer ver 100 pessoas, não 1.000 eventos. Uma leitura por pessoa
 * responde tudo; a linha do tempo mora dentro do próprio doc, limitada aos
 * últimos eventos.
 *
 * Aqui só mora regra pura (sem Firestore) para poder ser testada sozinha.
 */

/** Eventos guardados na linha do tempo do visitante. */
export type TipoEvento = 'viu' | 'carrinho' | 'pedido' | 'whatsapp';

export interface EventoVisitante {
  tipo: TipoEvento;
  /**
   * Millis do relógio do CLIENTE. Serve para ordenar os eventos entre si e
   * mostrar o intervalo dentro da visita — nunca para filtrar por período: para
   * isso vale `ultimaVez`, que é hora do servidor. Celular com relógio errado
   * já causou "online eterno" uma vez (ver lib/audience.ts).
   */
  at: number;
  produtoId?: string;
  produtoNome?: string;
  valor?: number;
  orderId?: string;
}

export interface ItemDoCarrinho {
  id: string;
  nome: string;
  qtd: number;
  valor: number;
}

export interface CarrinhoDoVisitante {
  itens: ItemDoCarrinho[];
  valor: number;
  /** Millis do cliente, só para exibir "parado há X min". */
  emMs?: number;
}

export interface Visitante {
  /** `${storeId}__${visitorId}` — o mesmo id que o documento tem no Firestore. */
  id: string;
  storeId: string;
  visitorId: string;
  /** Timestamp do servidor (aceita o formato do Firestore ou millis). */
  primeiraVez?: unknown;
  ultimaVez?: unknown;
  sessoes?: number;
  /** Identidade, quando a pessoa já se apresentou (pedido feito ou telefone salvo). */
  nome?: string;
  telefone?: string;
  /** ID completo do doc em `clientes`. Vínculo por id, nunca por nome. */
  clienteId?: string;
  linhaDoTempo?: EventoVisitante[];
  carrinho?: CarrinhoDoVisitante;
  pedidos?: number;
  ultimoPedidoId?: string;
  ultimoPedidoValor?: number;
  ultimoPedidoMs?: number;
  /**
   * Identidade PROVÁVEL: veio da marca do link que a loja mandou, não da pessoa
   * digitando. Link é encaminhável — quem recebeu de uma amiga chega com o
   * contato de quem encaminhou. Vale para chamar, não para cobrar.
   */
  viaLink?: boolean;
  /** Código curto que o cliente leva ao sair do cardápio para o WhatsApp da loja. */
  codigo?: string;
}

/** Quantos eventos ficam guardados por pessoa. */
export const LIMITE_LINHA_DO_TEMPO = 40;

/** Quantas fotos aparecem empilhadas no card do placar. */
export const LIMITE_AVATARES = 4;

/**
 * Um documento por (loja, visitante). O id carrega as duas partes para a regra
 * do Firestore conseguir amarrar o que está sendo escrito ao próprio caminho —
 * sem isso, qualquer um poderia escrever no perfil de outro visitante.
 */
export function docIdVisitante(storeId: string, visitorId: string): string {
  return `${storeId}__${visitorId}`;
}

/** Aceita Timestamp do Firestore, Date ou millis. Devolve null para o resto. */
export function paraMillis(valor: unknown): number | null {
  if (valor instanceof Date) return Number.isNaN(valor.getTime()) ? null : valor.getTime();
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

/** Só quem deixou nome ou telefone tem rosto e pode ser chamado no WhatsApp. */
export function ehIdentificado(v: Visitante): boolean {
  return Boolean((v.nome && v.nome.trim()) || (v.telefone && v.telefone.trim()));
}

/** Iniciais para o avatar quando não há foto do WhatsApp. */
export function iniciais(nome?: string): string {
  const partes = (nome || '').trim().split(/\s+/).filter(Boolean);
  if (partes.length === 0) return '?';
  if (partes.length === 1) return partes[0].slice(0, 2).toUpperCase();
  return (partes[0][0] + partes[partes.length - 1][0]).toUpperCase();
}

export function primeiroNome(nome?: string): string {
  const partes = (nome || '').trim().split(/\s+/).filter(Boolean);
  return partes[0] || '';
}

/**
 * O que a pessoa está fazendo, na ordem em que a dona precisa agir:
 * - `comprou`: fechou pedido nesta sessão de caixa. Nada a fazer.
 * - `abandonou`: montou carrinho e não fechou. É a ligação que vale dinheiro.
 * - `olhou`: abriu produtos, mas não chegou a montar carrinho.
 * - `passou`: entrou e saiu.
 */
export type EstadoVisitante = 'comprou' | 'abandonou' | 'olhou' | 'passou';

export function estadoDoVisitante(v: Visitante, inicioMs: number): EstadoVisitante {
  const pedidoMs = typeof v.ultimoPedidoMs === 'number' ? v.ultimoPedidoMs : null;
  const carrinhoMs = v.carrinho?.emMs ?? null;
  const temCarrinho = (v.carrinho?.itens?.length ?? 0) > 0 && (v.carrinho?.valor ?? 0) > 0;

  // Comprou depois de montar o carrinho? Então o carrinho virou pedido.
  // Se voltou e montou outro carrinho DEPOIS de comprar, é oportunidade nova.
  if (pedidoMs !== null && pedidoMs >= inicioMs) {
    if (temCarrinho && carrinhoMs !== null && carrinhoMs > pedidoMs) return 'abandonou';
    return 'comprou';
  }
  if (temCarrinho) return 'abandonou';
  if ((v.linhaDoTempo || []).some((e) => e.tipo === 'viu')) return 'olhou';
  return 'passou';
}

/**
 * Quanto vale falar com essa pessoa agora. Carrinho abandonado manda: é dinheiro
 * escolhido, com nome e telefone. Depois vem quem olhou bastante e não montou
 * nada. Quem já comprou sai da fila.
 */
export function valorDaOportunidade(v: Visitante, inicioMs: number): number {
  const estado = estadoDoVisitante(v, inicioMs);
  if (estado === 'abandonou') return 1_000_000 + (v.carrinho?.valor ?? 0);
  if (estado === 'olhou') return 1_000 + (v.linhaDoTempo || []).filter((e) => e.tipo === 'viu').length;
  if (estado === 'passou') return 1;
  return 0;
}

/**
 * Fila de trabalho da dona: oportunidade primeiro; empate desempata por quem
 * mexeu por último. Identificado ganha de anônimo no mesmo patamar — só dá para
 * ligar para quem deixou telefone.
 */
export function ordenarPorOportunidade(visitantes: Visitante[], inicioMs: number): Visitante[] {
  return [...visitantes].sort((a, b) => {
    const va = valorDaOportunidade(a, inicioMs);
    const vb = valorDaOportunidade(b, inicioMs);
    if (va !== vb) return vb - va;
    const ia = ehIdentificado(a) ? 1 : 0;
    const ib = ehIdentificado(b) ? 1 : 0;
    if (ia !== ib) return ib - ia;
    return (paraMillis(b.ultimaVez) ?? 0) - (paraMillis(a.ultimaVez) ?? 0);
  });
}

/**
 * As fotos do card: gente com nome, mais recente primeiro. Sem identidade não
 * entra na pilha — um círculo de "?" não diz nada para quem olha de longe.
 */
export function visitantesParaAvatares(visitantes: Visitante[], limite = LIMITE_AVATARES): Visitante[] {
  return visitantes
    .filter(ehIdentificado)
    .sort((a, b) => (paraMillis(b.ultimaVez) ?? 0) - (paraMillis(a.ultimaVez) ?? 0))
    .slice(0, limite);
}

export interface ResumoDoDia {
  pessoas: number;
  identificadas: number;
  comprando: number;
  abandonados: number;
  valorAbandonado: number;
  olhando: number;
  /** Pedidos fechados dividido por pessoas que passaram, em %. */
  conversao: number;
}

export function resumoDoDia(visitantes: Visitante[], inicioMs: number): ResumoDoDia {
  let identificadas = 0;
  let comprando = 0;
  let abandonados = 0;
  let valorAbandonado = 0;
  let olhando = 0;

  for (const v of visitantes) {
    if (ehIdentificado(v)) identificadas += 1;
    const estado = estadoDoVisitante(v, inicioMs);
    if (estado === 'comprou') comprando += 1;
    else if (estado === 'abandonou') {
      abandonados += 1;
      valorAbandonado += v.carrinho?.valor ?? 0;
    } else if (estado === 'olhou') olhando += 1;
  }

  const pessoas = visitantes.length;
  return {
    pessoas,
    identificadas,
    comprando,
    abandonados,
    valorAbandonado: Math.round(valorAbandonado * 100) / 100,
    olhando,
    conversao: pessoas > 0 ? Math.round((comprando / pessoas) * 100) : 0,
  };
}

export interface LinhaDeProduto {
  id: string;
  nome: string;
  vistas: number;
  pessoas: number;
  noCarrinho: number;
  valorParado: number;
}

/**
 * O que o cardápio inteiro está mostrando e o que está travando na hora de
 * fechar. `pessoas` conta gente, não cliques: um produto que uma pessoa abriu 9
 * vezes não é o mesmo que 9 pessoas abrindo uma vez.
 */
export function rankingDeProdutos(visitantes: Visitante[]): LinhaDeProduto[] {
  const mapa = new Map<string, LinhaDeProduto & { _pessoas: Set<string> }>();

  const garantir = (id: string, nome: string) => {
    let linha = mapa.get(id);
    if (!linha) {
      linha = { id, nome, vistas: 0, pessoas: 0, noCarrinho: 0, valorParado: 0, _pessoas: new Set() };
      mapa.set(id, linha);
    }
    if (nome && !linha.nome) linha.nome = nome;
    return linha;
  };

  for (const v of visitantes) {
    for (const evento of v.linhaDoTempo || []) {
      if (evento.tipo !== 'viu' || !evento.produtoId) continue;
      const linha = garantir(evento.produtoId, evento.produtoNome || '');
      linha.vistas += 1;
      linha._pessoas.add(v.id);
    }
    for (const item of v.carrinho?.itens || []) {
      if (!item.id) continue;
      const linha = garantir(item.id, item.nome || '');
      linha.noCarrinho += item.qtd;
      linha.valorParado += item.valor;
    }
  }

  return [...mapa.values()]
    .map(({ _pessoas, ...linha }) => ({
      ...linha,
      pessoas: _pessoas.size,
      valorParado: Math.round(linha.valorParado * 100) / 100,
    }))
    .sort((a, b) => b.vistas - a.vistas || b.pessoas - a.pessoas);
}

/**
 * Carrinho da pessoa em forma de resumo: só o necessário para a dona saber o
 * que ela ia levar e por quanto. Guardar a linha inteira do carrinho (adicionais,
 * observações, imagem) encheria o documento sem ajudar a decidir.
 */
export function resumirCarrinho(itens: any[] | null | undefined): CarrinhoDoVisitante {
  const resumo: ItemDoCarrinho[] = [];
  let valor = 0;

  for (const item of itens || []) {
    const qtd = Number(item?.quantity) || 0;
    if (qtd <= 0) continue;
    const unitario = Number(item?.promoPrice ?? item?.price) || 0;
    const adicionais = (item?.customization?.addons || []).reduce(
      (soma: number, addon: any) => soma + (Number(addon?.price) || 0),
      0
    );
    const total = Math.round((unitario + adicionais) * qtd * 100) / 100;
    valor += total;
    resumo.push({
      id: String(item?.id ?? ''),
      nome: String(item?.name ?? item?.nome ?? 'Item'),
      qtd,
      valor: total,
    });
  }

  return { itens: resumo, valor: Math.round(valor * 100) / 100 };
}

/**
 * Empilha um evento novo na linha do tempo, cortando o excesso pelo começo.
 * Ver o mesmo produto duas vezes seguidas não vira dois eventos — a pessoa
 * abrindo e fechando o mesmo item encheria a linha sem dizer nada de novo.
 */
export function empilharEvento(
  linha: EventoVisitante[] | undefined,
  evento: EventoVisitante,
  limite = LIMITE_LINHA_DO_TEMPO
): EventoVisitante[] {
  const atual = linha || [];
  const ultimo = atual[atual.length - 1];
  if (
    ultimo &&
    ultimo.tipo === evento.tipo &&
    ultimo.produtoId === evento.produtoId &&
    ultimo.orderId === evento.orderId
  ) {
    return atual;
  }
  return [...atual, evento].slice(-limite);
}

/**
 * A pessoa chamou a loja no WhatsApp saindo do cardápio (o código dela voltou
 * numa mensagem). Muda o que a dona faz: em vez de puxar conversa, é só abrir a
 * que já está lá esperando.
 */
export function chamouNoWhatsapp(v: Visitante): boolean {
  return (v.linhaDoTempo || []).some((e) => e.tipo === 'whatsapp');
}

/** Eventos da sessão de caixa atual, do mais novo para o mais velho. */
export function eventosDaSessao(v: Visitante, inicioMs: number): EventoVisitante[] {
  const ultima = paraMillis(v.ultimaVez);
  // Relógio do cliente pode estar deslocado: alinhamos a linha do tempo pelo
  // último evento com a hora do SERVIDOR, então "16:42" na tela é hora real.
  const eventos = v.linhaDoTempo || [];
  const ultimoEvento = eventos.length ? eventos[eventos.length - 1].at : null;
  const ajuste = ultima !== null && ultimoEvento !== null ? ultima - ultimoEvento : 0;

  return eventos
    .map((e) => ({ ...e, at: e.at + ajuste }))
    .filter((e) => e.at >= inicioMs)
    .reverse();
}

/**
 * Chave da PESSOA por trás do documento.
 *
 * Cada navegador tem o seu `visitorId` (ver `obterVisitorId`), e o cardápio
 * aberto DE DENTRO do WhatsApp costuma perder o storage a cada clique no link:
 * a mesma cliente vira um documento novo por abertura. Enquanto ninguém tinha
 * nome isso passava despercebido; com o link marcado (`viaLink`) cada uma
 * dessas aberturas chega identificada, e a mesma pessoa aparecia sete vezes na
 * fila — com a mesma foto empilhada sete vezes no placar.
 *
 * A ordem é a da confiança: o id do cadastro primeiro, o telefone depois. Nome
 * NUNCA é chave (ver as convenções de integridade do projeto) e, sem
 * identidade, cada `visitorId` continua valendo por uma pessoa — é tudo o que
 * se sabe dele.
 */
export function chaveDaPessoa(v: Visitante): string {
  const clienteId = (v.clienteId || '').trim();
  if (clienteId) return `cliente:${clienteId}`;
  // Mesma regra de `normalizeCreditPhone` (só dígitos, +55 fora), repetida aqui
  // de propósito: este arquivo é puro e não carrega o Firestore junto.
  const telefone = (v.telefone || '').replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, '');
  if (telefone.length === 10 || telefone.length === 11) return `tel:${telefone}`;
  return `visita:${v.visitorId || v.id}`;
}

/**
 * Junta os documentos da mesma pessoa num visitante só, do mais recente para o
 * mais antigo.
 *
 * É fusão de LEITURA: nada é reescrito no banco e nenhum documento é apagado —
 * conflito de dado é decisão do dono, não do app. O documento mais recente é o
 * representante (é o que tem a sacola de agora); o resto entra somando.
 */
export function agruparPorPessoa(visitantes: Visitante[]): Visitante[] {
  const grupos = new Map<string, Visitante[]>();
  for (const v of visitantes) {
    const chave = chaveDaPessoa(v);
    const atual = grupos.get(chave);
    if (atual) atual.push(v);
    else grupos.set(chave, [v]);
  }
  return [...grupos.values()]
    .map(fundirVisitas)
    .sort((a, b) => (paraMillis(b.ultimaVez) ?? 0) - (paraMillis(a.ultimaVez) ?? 0));
}

/** Hora do servidor da visita — a única comparável entre aparelhos diferentes. */
const horaDaVisita = (v: Visitante) => paraMillis(v.ultimaVez) ?? 0;

function fundirVisitas(docs: Visitante[]): Visitante {
  if (docs.length === 1) return docs[0];

  const ordenados = [...docs].sort((a, b) => horaDaVisita(b) - horaDaVisita(a));
  const recente = ordenados[0];
  const antigo = ordenados[ordenados.length - 1];

  // A linha do tempo de cada aparelho vem no relógio DELE. Alinhamos cada uma
  // pela hora de servidor da própria visita antes de juntar — sem isso, um
  // celular adiantado jogaria os eventos dele para o fim da lista de todo mundo.
  const eventos: EventoVisitante[] = [];
  for (const doc of ordenados) {
    const linha = doc.linhaDoTempo || [];
    if (linha.length === 0) continue;
    const ajuste = horaDaVisita(doc) - linha[linha.length - 1].at;
    for (const evento of linha) eventos.push({ ...evento, at: evento.at + ajuste });
  }
  eventos.sort((a, b) => a.at - b.at);

  const comCliente = ordenados.find((d) => (d.clienteId || '').trim());
  const comNome = ordenados.find((d) => (d.nome || '').trim());
  const comTelefone = ordenados.find((d) => (d.telefone || '').trim());
  // Telefone digitado em QUALQUER uma das visitas derruba o "provável" do link:
  // a pessoa já se apresentou, não é mais palpite de quem recebeu o endereço.
  const confirmou = ordenados.some((d) => (d.telefone || '').trim() && d.viaLink !== true);

  const comPedido = ordenados.reduce<Visitante | null>(
    (melhor, d) => ((d.ultimoPedidoMs ?? 0) > (melhor?.ultimoPedidoMs ?? 0) ? d : melhor),
    null
  );
  const comSacola = ordenados.find(
    (d) => (d.carrinho?.itens?.length ?? 0) > 0 && (d.carrinho?.valor ?? 0) > 0
  );
  // Sacola e pedido podem ter vindo de aberturas diferentes, cada uma com o seu
  // relógio: quem decide é a hora do SERVIDOR. Sacola de uma visita anterior ao
  // pedido é a sacola que virou aquele pedido — não é oportunidade parada.
  const pedidoMs = comPedido?.ultimoPedidoMs ?? 0;
  const sacolaValeu = comSacola && horaDaVisita(comSacola) >= horaDaVisita(comPedido ?? comSacola);
  const carrinho: CarrinhoDoVisitante = sacolaValeu
    ? {
        ...comSacola!.carrinho!,
        // O estado é decidido comparando com `ultimoPedidoMs`, e os dois millis
        // vêm de aparelhos diferentes: fixamos a sacola à frente do pedido para
        // o veredito acompanhar a hora de servidor que já foi comparada acima.
        emMs: Math.max(comSacola!.carrinho?.emMs ?? horaDaVisita(comSacola!), pedidoMs + 1),
      }
    : { itens: [], valor: 0, emMs: pedidoMs || horaDaVisita(recente) };

  return {
    ...recente,
    nome: comNome?.nome ?? recente.nome,
    telefone: comTelefone?.telefone ?? recente.telefone,
    clienteId: comCliente?.clienteId ?? recente.clienteId,
    viaLink: confirmou ? false : ordenados.some((d) => d.viaLink === true),
    primeiraVez: antigo.primeiraVez ?? recente.primeiraVez,
    ultimaVez: recente.ultimaVez,
    // Cada documento é pelo menos uma abertura do cardápio: quem perdeu o
    // storage no meio do caminho não pode perder a visita junto.
    sessoes: ordenados.reduce((soma, d) => soma + Math.max(1, Number(d.sessoes) || 0), 0),
    pedidos: ordenados.reduce((soma, d) => soma + (Number(d.pedidos) || 0), 0),
    linhaDoTempo: eventos.slice(-LIMITE_LINHA_DO_TEMPO),
    carrinho,
    ultimoPedidoId: comPedido?.ultimoPedidoId,
    ultimoPedidoValor: comPedido?.ultimoPedidoValor,
    ultimoPedidoMs: comPedido?.ultimoPedidoMs,
  };
}
