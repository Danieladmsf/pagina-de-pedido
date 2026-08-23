'use client';

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { doc, getDoc, increment, serverTimestamp, setDoc } from 'firebase/firestore';
import type { Firestore } from 'firebase/firestore';
import {

  docIdVisitante,
  empilharEvento,
  resumirCarrinho,
  type CarrinhoDoVisitante,
  type EventoVisitante,
} from '@/lib/visitantes';
import { normalizeCreditPhone } from '@/lib/customer-credit';
import { codigoDoVisitante } from '@/lib/contato-link';

/**
 * Grava o que a pessoa fez no cardápio: quais produtos abriu, o que ficou no
 * carrinho e se o pedido saiu. É o que transforma "118 visitas" em uma fila de
 * trabalho com nome e telefone.
 *
 * Regras de convivência com o resto:
 * - Escreve UM documento por (loja, visitante), sempre com merge. O placar
 *   (`store_visits`) continua intocado e append-only — este hook não conta
 *   visita, só descreve quem já foi contado.
 * - Aparelho da própria loja não entra (`ativo: false`), então conferir preço no
 *   balcão não vira cliente fantasma na tela da dona.
 * - Carrinho é gravado com atraso: a pessoa mexendo na quantidade dispararia uma
 *   escrita por toque.
 */

/** Espera antes de gravar o carrinho — o suficiente para a pessoa parar de mexer. */
const ATRASO_DO_CARRINHO_MS = 2_500;

export interface DadosDeIdentidade {
  nome?: string | null;
  telefone?: string | null;
  /** ID completo do doc em `clientes`, quando o cardápio já resolveu o vínculo. */
  clienteId?: string | null;
}

export interface VisitorTracker {
  verProduto: (item: any) => void;
  /** A pessoa procurou algo que o cardápio não tem. */
  buscouSemResultado: (termo: string) => void;
  atualizarCarrinho: (itens: any[]) => void;
  identificar: (dados: DadosDeIdentidade) => void;
  registrarPedido: (dados: DadosDeIdentidade & { orderId: string; valor: number }) => void;
}

interface Opcoes {
  db: Firestore | null | undefined;
  storeId: string | null | undefined;
  visitorId: string | null;
  /** `false` para aparelho da loja: o tracker vira um objeto que não faz nada. */
  ativo: boolean;
  /** Marca uma sessão nova (uma por aba/visita), para contar quantas vezes voltou. */
  sessaoNova: boolean;
  /** De onde a pessoa veio (`?via=`), já normalizado. Vazio = link sem marca. */
  origem?: string;
}

/** Tamanho máximo do termo gravado — busca é palavra, não redação. */
const LIMITE_DO_TERMO = 40;

const vazio: VisitorTracker = {
  verProduto: () => {},
  buscouSemResultado: () => {},
  atualizarCarrinho: () => {},
  identificar: () => {},
  registrarPedido: () => {},
};

export function useVisitorTracking({ db, storeId, visitorId, ativo, sessaoNova, origem = '' }: Opcoes): VisitorTracker {
  // Estado local do documento. Começa do que já existe no banco (a pessoa pode
  // ter passado ontem) para a linha do tempo não ser apagada a cada visita.
  const linha = useRef<EventoVisitante[]>([]);
  const identidade = useRef<DadosDeIdentidade>({});
  const timerCarrinho = useRef<ReturnType<typeof setTimeout> | null>(null);
  const carrinhoPendente = useRef<CarrinhoDoVisitante | null>(null);
  const jaTeveItem = useRef(false);
  // A leitura inicial é assíncrona. Até ela voltar, a linha do tempo local
  // está incompleta — gravá-la apagaria o que a pessoa já tinha feito antes
  // (visto no teste real: abrir um produto, recarregar e mexer no carrinho
  // fazia o produto sumir do histórico).
  const pronto = useRef(false);

  const ref = useMemo(() => {
    if (!db || !storeId || !visitorId || !ativo) return null;
    return doc(db, 'store_visitors', docIdVisitante(storeId, visitorId));
  }, [db, storeId, visitorId, ativo]);

  const gravar = useCallback(
    (campos: Record<string, unknown>, primeiraVisita = false) => {
      if (!ref || !storeId || !visitorId) return;
      const base: Record<string, unknown> = {
        storeId,
        visitorId,
        ultimaVez: serverTimestamp(),
        ...campos,
      };
      // Enquanto o histórico não chegou, o resto (carrinho, identidade, pedido)
      // pode ir; a linha do tempo espera para não sobrescrever o que já existe.
      if (!pronto.current) delete base.linhaDoTempo;
      // `primeiraVez` só vai quando temos CERTEZA de que o documento é novo. A
      // regra do Firestore não deixa reescrever esse campo, e mandá-lo por
      // suposição (leitura falhou) derrubaria a gravação inteira.
      if (primeiraVisita) base.primeiraVez = serverTimestamp();
      // Falha de escrita não pode atrapalhar quem está comprando: o cardápio
      // segue funcionando sem o registro.
      setDoc(ref, base, { merge: true }).catch(() => {});
    },
    [ref, storeId, visitorId]
  );

  // Abertura da visita: lê o que já existe e registra a passagem.
  useEffect(() => {
    if (!ref || !storeId || !visitorId) return;
    let vivo = true;

    (async () => {
      let existente: any = null;
      let leituraOk = true;
      try {
        const snap = await getDoc(ref);
        existente = snap.exists() ? snap.data() : null;
      } catch {
        leituraOk = false; // offline/regra: segue sem o histórico, o merge conserta
      }
      if (!vivo) return;

      // O que já estava gravado vem primeiro; o que a pessoa fez enquanto a
      // leitura voltava entra depois, na ordem em que aconteceu.
      const anteriores = Array.isArray(existente?.linhaDoTempo) ? existente.linhaDoTempo : [];
      linha.current = linha.current.reduce((acc, ev) => empilharEvento(acc, ev), anteriores);
      pronto.current = true;
      identidade.current = {
        nome: existente?.nome ?? null,
        telefone: existente?.telefone ?? null,
        clienteId: existente?.clienteId ?? null,
      };

      const campos: Record<string, unknown> = {};
      // `increment` em vez de somar no cliente: duas abas abertas não se
      // atropelam e o contador não depende da leitura ter dado certo.
      if (sessaoNova) campos.sessoes = increment(1);
      // Código curto desta visita: é por ele que a loja liga a mensagem que
      // chega no WhatsApp à pessoa que estava olhando os produtos.
      const codigo = codigoDoVisitante(visitorId);
      if (codigo && existente?.codigo !== codigo) campos.codigo = codigo;
      // Carrinho de uma visita antiga não pode aparecer como oportunidade de
      // hoje: quem voltou amanhã começa com a sacola limpa na tela da dona.
      if (sessaoNova && existente?.carrinho) campos.carrinho = { itens: [], valor: 0, emMs: Date.now() };
      // De onde a pessoa veio. A PRIMEIRA origem entra uma vez e não se
      // reescreve (é quem trouxe a pessoa para a loja); a última acompanha a
      // visita de agora. Sem as duas, quem descobriu a loja no Instagram e
      // voltou pelo link do WhatsApp aparece como mérito do WhatsApp.
      if (origem) {
        if (!existente?.origemPrimeira) campos.origemPrimeira = origem;
        if (existente?.origemUltima !== origem) campos.origemUltima = origem;
      }
      // `primeiraVez` pode faltar mesmo em documento que já existe: a
      // identificação pelo aparelho (cliente que já pediu antes) cria o perfil
      // antes desta leitura terminar. A regra deixa preencher quem não tem.
      if (linha.current.length > 0) campos.linhaDoTempo = linha.current;
      gravar(campos, leituraOk && !existente?.primeiraVez);
    })();

    return () => {
      vivo = false;
    };
    // `sessaoNova` é decidido uma vez por visita, fora do React.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ref, storeId, visitorId, gravar]);

  // Carrinho pendente é enviado ao sair da página — senão o abandono real (a
  // pessoa fecha a aba com a sacola cheia) chegaria só até a última pausa.
  useEffect(() => {
    if (!ref) return;
    const enviarAgora = () => {
      if (!carrinhoPendente.current) return;
      const carrinho = carrinhoPendente.current;
      carrinhoPendente.current = null;
      if (timerCarrinho.current) clearTimeout(timerCarrinho.current);
      gravar({ carrinho, linhaDoTempo: linha.current });
    };
    window.addEventListener('pagehide', enviarAgora);
    window.addEventListener('beforeunload', enviarAgora);
    return () => {
      window.removeEventListener('pagehide', enviarAgora);
      window.removeEventListener('beforeunload', enviarAgora);
      enviarAgora();
    };
  }, [ref, gravar]);

  const verProduto = useCallback(
    (item: any) => {
      if (!ref || !item?.id) return;
      const antes = linha.current;
      linha.current = empilharEvento(antes, {
        tipo: 'viu',
        at: Date.now(),
        produtoId: String(item.id),
        produtoNome: String(item.name || item.nome || ''),
        valor: Number(item.promoPrice ?? item.price) || 0,
      });
      if (linha.current === antes) return; // mesmo produto de novo: nada mudou
      gravar({ linhaDoTempo: linha.current });
    },
    [ref, gravar]
  );

  /**
   * Busca que não achou nada é pedido de produto com as palavras do cliente.
   *
   * Quem chama é a tela, depois que a pessoa PARA de digitar — senão "brigadeiro"
   * viraria onze eventos, um por letra, e a linha do tempo (40 posições) seria
   * consumida por uma pessoa só.
   */
  const buscouSemResultado = useCallback(
    (termo: string) => {
      const limpo = String(termo || '').trim().slice(0, LIMITE_DO_TERMO);
      if (!ref || limpo.length < 3) return;
      const antes = linha.current;
      linha.current = empilharEvento(antes, { tipo: 'busca', at: Date.now(), termo: limpo });
      if (linha.current === antes) return; // mesma busca de novo: nada mudou
      gravar({ linhaDoTempo: linha.current });
    },
    [ref, gravar]
  );

  const atualizarCarrinho = useCallback(
    (itens: any[]) => {
      if (!ref) return;
      // Carrinho vazio antes de ter tido item é a montagem da página, não um
      // abandono desfeito: gravar aqui apagaria a sacola que a pessoa deixou
      // ontem toda vez que ela abrisse o cardápio de novo.
      const temItem = (itens || []).some((i) => (Number(i?.quantity) || 0) > 0);
      if (!temItem && !jaTeveItem.current) return;
      if (temItem) jaTeveItem.current = true;

      const carrinho = { ...resumirCarrinho(itens), emMs: Date.now() };
      carrinhoPendente.current = carrinho;
      if (timerCarrinho.current) clearTimeout(timerCarrinho.current);
      timerCarrinho.current = setTimeout(() => {
        carrinhoPendente.current = null;
        linha.current = empilharEvento(linha.current, {
          tipo: 'carrinho',
          at: Date.now(),
          valor: carrinho.valor,
        });
        gravar({ carrinho, linhaDoTempo: linha.current });
      }, ATRASO_DO_CARRINHO_MS);
    },
    [ref, gravar]
  );

  const identificar = useCallback(
    (dados: DadosDeIdentidade) => {
      if (!ref) return;
      const nome = (dados.nome || '').trim();
      const telefone = normalizeCreditPhone(dados.telefone || '');
      const clienteId = dados.clienteId || '';

      const campos: Record<string, unknown> = {};
      if (nome && nome !== identidade.current.nome) campos.nome = nome;
      if (telefone && telefone !== identidade.current.telefone) campos.telefone = telefone;
      // O vínculo é por ID; nome e telefone ficam só para a dona ler e ligar.
      if (clienteId && clienteId !== identidade.current.clienteId) campos.clienteId = clienteId;
      if (Object.keys(campos).length === 0) return;

      identidade.current = {
        nome: nome || identidade.current.nome,
        telefone: telefone || identidade.current.telefone,
        clienteId: clienteId || identidade.current.clienteId,
      };
      // Telefone digitado pela pessoa é identidade CONFIRMADA: derruba o
      // "provável" que tinha vindo da marca do link.
      if (campos.telefone) campos.viaLink = false;
      gravar(campos);
    },
    [ref, gravar]
  );

  const registrarPedido = useCallback(
    ({ orderId, valor, ...dados }: DadosDeIdentidade & { orderId: string; valor: number }) => {
      if (!ref) return;
      const agora = Date.now();
      linha.current = empilharEvento(linha.current, { tipo: 'pedido', at: agora, valor, orderId });

      const nome = (dados.nome || '').trim();
      const telefone = normalizeCreditPhone(dados.telefone || '');
      if (timerCarrinho.current) clearTimeout(timerCarrinho.current);
      carrinhoPendente.current = null;

      gravar({
        ...(nome ? { nome } : {}),
        ...(telefone ? { telefone } : {}),
        ...(dados.clienteId ? { clienteId: dados.clienteId } : {}),
        linhaDoTempo: linha.current,
        // A sacola virou pedido: some da fila de oportunidades.
        carrinho: { itens: [], valor: 0, emMs: agora },
        pedidos: increment(1),
        ultimoPedidoId: orderId,
        ultimoPedidoValor: valor,
        ultimoPedidoMs: agora,
      });
      jaTeveItem.current = false;
    },
    [ref, gravar]
  );

  const tracker = useMemo<VisitorTracker>(
    () => ({ verProduto, buscouSemResultado, atualizarCarrinho, identificar, registrarPedido }),
    [verProduto, buscouSemResultado, atualizarCarrinho, identificar, registrarPedido]
  );

  return ref ? tracker : vazio;
}
