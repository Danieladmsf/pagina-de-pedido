import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Scroll-spy para os seletores de produto do admin (Novo Pedido, Mesa,
 * Delivery). A lista rola dentro de um container interno (overflow-y-auto),
 * entao o rastreio e feito relativo a esse container, e nao a window — igual
 * ao comportamento do cardapio do cliente, mas adaptado para o scroll local.
 *
 * - Clicar numa categoria rola ate a secao correspondente.
 * - Rolar a lista atualiza a pill ativa conforme a secao visivel.
 *
 * `groupIds` deve refletir a ordem das secoes renderizadas (apenas as que
 * existem na tela). Marque cada secao com `ref={setSectionRef(id)}` e cada
 * pill com `data-cat-tab={id}`. O container usa um callback ref para
 * reativar o rastreio quando ele monta dentro de um dialogo.
 */
export function useCategoryScrollSpy(groupIds: string[]) {
  // Node state (e nao ref puro) para o efeito reagir quando o container
  // monta/desmonta — ex.: o dialogo "Adicionar / Remover Itens" do Delivery.
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const scrollContainerRef = useCallback((node: HTMLDivElement | null) => {
    containerRef.current = node;
    setContainer(node);
  }, []);

  const categoryBarRef = useRef<HTMLDivElement | null>(null);
  const sectionRefs = useRef<Record<string, HTMLElement | null>>({});
  const isProgrammaticScroll = useRef(false);
  const [activeCategory, setActiveCategory] = useState<string>('all');

  const setSectionRef = useCallback(
    (id: string) => (el: HTMLElement | null) => {
      sectionRefs.current[id] = el;
    },
    []
  );

  const bringPillIntoView = useCallback((id: string) => {
    const bar = categoryBarRef.current;
    if (!bar) return;
    const tab = bar.querySelector(`[data-cat-tab="${id}"]`) as HTMLElement | null;
    if (!tab) return;
    // Calcula via getBoundingClientRect (robusto independ. do offsetParent):
    // centro da pill relativo ao conteudo rolavel da barra.
    const barRect = bar.getBoundingClientRect();
    const tabRect = tab.getBoundingClientRect();
    const tabCenterInContent = tabRect.left - barRect.left + bar.scrollLeft + tabRect.width / 2;
    const left = tabCenterInContent - bar.clientWidth / 2;
    bar.scrollTo({ left, behavior: 'smooth' });
  }, []);

  const scrollToCategory = useCallback(
    (id: string) => {
      const node = containerRef.current;
      if (!node) return;
      isProgrammaticScroll.current = true;
      setActiveCategory(id);
      bringPillIntoView(id);
      if (id === 'all') {
        node.scrollTo({ top: 0, behavior: 'smooth' });
      } else {
        const section = sectionRefs.current[id];
        if (section) {
          const top =
            section.getBoundingClientRect().top -
            node.getBoundingClientRect().top +
            node.scrollTop;
          node.scrollTo({ top, behavior: 'smooth' });
        }
      }
      window.setTimeout(() => {
        isProgrammaticScroll.current = false;
      }, 700);
    },
    [bringPillIntoView]
  );

  const groupKey = groupIds.join('|');
  useEffect(() => {
    if (!container || groupIds.length === 0) return;

    let ticking = false;
    const handleScroll = () => {
      if (ticking || isProgrammaticScroll.current) return;
      ticking = true;
      requestAnimationFrame(() => {
        const containerTop = container.getBoundingClientRect().top;
        const offset = 8; // linha logo abaixo do topo do container
        let closestId: string = groupIds[0];
        let closestDistance = Infinity;

        for (const id of groupIds) {
          const el = sectionRefs.current[id];
          if (!el) continue;
          const relTop = el.getBoundingClientRect().top - containerTop;
          const distance = Math.abs(relTop - offset);
          if (relTop <= offset + 48 && distance < closestDistance) {
            closestDistance = distance;
            closestId = id;
          }
        }

        // No topo do container, destaca "Todos".
        if (container.scrollTop <= 4) closestId = 'all';

        setActiveCategory(prev => {
          if (prev !== closestId) {
            bringPillIntoView(closestId);
            return closestId;
          }
          return prev;
        });
        ticking = false;
      });
    };

    const timer = window.setTimeout(handleScroll, 300);
    container.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      window.clearTimeout(timer);
      container.removeEventListener('scroll', handleScroll);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [container, groupKey, bringPillIntoView]);

  return { scrollContainerRef, categoryBarRef, setSectionRef, scrollToCategory, activeCategory };
}
