import { describe, expect, it, beforeAll } from 'vitest';

import {
  MARCA_PARAM,
  adicionarMarca,
  codigoDoVisitante,
  extrairCodigoDaMensagem,
  extrairMarca,
  marcarLinksDoCardapio,
  textoDoPedidoPeloWhatsapp,
} from './contato-link';

/**
 * O que estes testes protegem: as duas pontas que dão nome a quem entra pelo
 * link — a marca que a loja manda e o código que o cliente traz de volta.
 *
 * Um erro aqui não quebra tela nenhuma: ele silenciosamente liga o telefone de
 * uma pessoa à visita de outra. Por isso a maioria dos casos aqui é sobre NÃO
 * identificar quando há qualquer dúvida.
 */

describe('adicionarMarca', () => {
  it('entra como primeira pergunta quando o link é limpo', () => {
    expect(adicionarMarca('https://x.com/loja-a1b2', 'M4RC4')).toBe('https://x.com/loja-a1b2?c=M4RC4');
  });

  it('convive com o parâmetro de opções do link', () => {
    expect(adicionarMarca('https://x.com/loja-a1b2?pedir=de', 'M4RC4')).toBe(
      'https://x.com/loja-a1b2?pedir=de&c=M4RC4'
    );
  });

  it('não marca duas vezes', () => {
    const uma = adicionarMarca('https://x.com/loja-a1b2', 'M4RC4');
    expect(adicionarMarca(uma, 'OUTRA')).toBe(uma);
  });

  it('preserva a âncora no fim do endereço', () => {
    expect(adicionarMarca('https://x.com/loja-a1b2#cardapio', 'M4RC4')).toBe(
      'https://x.com/loja-a1b2?c=M4RC4#cardapio'
    );
  });

  it('sem marca, devolve o link intacto', () => {
    expect(adicionarMarca('https://x.com/loja-a1b2', '')).toBe('https://x.com/loja-a1b2');
  });
});

describe('marcarLinksDoCardapio', () => {
  const caminho = '/gostinho-do-ceu-5n3mkc';

  it('marca o link da loja no meio da mensagem', () => {
    const texto = 'Olá! Faça seu pedido:\nhttps://app.com/gostinho-do-ceu-5n3mkc\n\nAté já!';
    expect(marcarLinksDoCardapio(texto, caminho, 'M4RC4')).toContain(
      'https://app.com/gostinho-do-ceu-5n3mkc?c=M4RC4'
    );
  });

  it('não encosta em link de terceiro', () => {
    const texto = 'Veja no instagram.com/loja e peça em https://app.com/gostinho-do-ceu-5n3mkc';
    const marcado = marcarLinksDoCardapio(texto, caminho, 'M4RC4');
    expect(marcado).toContain('instagram.com/loja e peça');
    expect(marcado).toContain('gostinho-do-ceu-5n3mkc?c=M4RC4');
  });

  it('não engole a pontuação do fim da frase', () => {
    const texto = 'Peça aqui: https://app.com/gostinho-do-ceu-5n3mkc.';
    expect(marcarLinksDoCardapio(texto, caminho, 'M4RC4')).toBe(
      'Peça aqui: https://app.com/gostinho-do-ceu-5n3mkc?c=M4RC4.'
    );
  });

  it('mantém o parâmetro de opções que já estava no link', () => {
    const texto = 'https://app.com/gostinho-do-ceu-5n3mkc?pedir=de';
    expect(marcarLinksDoCardapio(texto, caminho, 'M4RC4')).toBe(
      'https://app.com/gostinho-do-ceu-5n3mkc?pedir=de&c=M4RC4'
    );
  });

  it('mensagem sem link nenhum passa igual', () => {
    const texto = 'Seu pedido saiu para entrega!';
    expect(marcarLinksDoCardapio(texto, caminho, 'M4RC4')).toBe(texto);
  });

  it('link de OUTRA loja não é marcado com o contato desta', () => {
    const texto = 'https://app.com/outra-loja-9z9z9z';
    expect(marcarLinksDoCardapio(texto, caminho, 'M4RC4')).toBe(texto);
  });
});

describe('extrairMarca', () => {
  it('lê o parâmetro do endereço aberto', () => {
    expect(extrairMarca(new URLSearchParams(`?${MARCA_PARAM}=M4RC4`))).toBe('M4RC4');
  });
  it('sem parâmetro, string vazia', () => {
    expect(extrairMarca(new URLSearchParams('?pedir=de'))).toBe('');
    expect(extrairMarca(null)).toBe('');
  });
});

describe('codigoDoVisitante', () => {
  it('mesmo visitante, mesmo código', () => {
    const id = 'c77c14b3-3540-45e0-a859-225bae293ce6';
    expect(codigoDoVisitante(id)).toBe(codigoDoVisitante(id));
  });

  it('visitantes diferentes recebem códigos diferentes', () => {
    const codigos = new Set(
      Array.from({ length: 200 }, (_, i) => codigoDoVisitante(`visitante-${i}-abcdef`))
    );
    // Colisão eventual é tratada na leitura (código ambíguo não identifica
    // ninguém), mas não pode ser a regra.
    expect(codigos.size).toBeGreaterThan(190);
  });

  it('não usa caracteres que se confundem ao ler (0, O, 1, I, L)', () => {
    for (let i = 0; i < 50; i++) {
      expect(codigoDoVisitante(`x${i}`)).toMatch(/^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{5}$/);
    }
  });

  it('sem visitante não inventa código', () => {
    expect(codigoDoVisitante('')).toBe('');
  });
});

describe('mensagem do WhatsApp', () => {
  it('leva o código quando existe', () => {
    expect(textoDoPedidoPeloWhatsapp('7K2M9')).toContain('#7K2M9');
  });

  it('sem código, é a mensagem de sempre', () => {
    expect(textoDoPedidoPeloWhatsapp(null)).toBe('Olá! Gostaria de fazer um pedido.');
  });

  it('a loja acha o código na mensagem que chega', () => {
    expect(extrairCodigoDaMensagem(textoDoPedidoPeloWhatsapp('7K2M9'))).toBe('7K2M9');
  });

  it('acha mesmo com o cliente escrevendo antes e depois', () => {
    expect(extrairCodigoDaMensagem('boa noite, quero pedir Cód. #7K2M9 obrigada')).toBe('7K2M9');
  });

  it('mensagem comum não vira código', () => {
    expect(extrairCodigoDaMensagem('Oi, vocês estão abertos?')).toBe('');
    expect(extrairCodigoDaMensagem('meu pedido #12 chegou errado')).toBe('');
    expect(extrairCodigoDaMensagem('')).toBe('');
  });
});

describe('marca cifrada (servidor)', () => {
  const LOJA = '5Hg3VG3qYAZNsobVnReK9aPntjx1';
  let criarBruto: (loja: string, t: string, d: number) => string;
  let lerBruto: (loja: string, m: string) => { telefone: string; venceEm: Date } | null;
  const criar = (t: string, d: number) => criarBruto(LOJA, t, d);
  const ler = (m: string) => lerBruto(LOJA, m);

  beforeAll(async () => {
    process.env.WAPI_API_KEY = 'segredo-de-teste';
    const mod = await import('./contato-link.server');
    criarBruto = mod.criarMarcaDeContato;
    lerBruto = mod.lerMarcaDeContato;
  });

  it('vai e volta com o mesmo telefone', () => {
    const marca = criar('16999998888', 7);
    expect(ler(marca)?.telefone).toBe('16999998888');
  });

  it('aceita telefone com máscara e com o 55 na frente', () => {
    expect(ler(criar('(16) 99999-8888', 7))?.telefone).toBe('16999998888');
    expect(ler(criar('5516999998888', 7))?.telefone).toBe('16999998888');
  });

  it('funciona com número de 10 dígitos', () => {
    expect(ler(criar('1633334444', 7))?.telefone).toBe('1633334444');
  });

  it('não deixa o telefone à vista na marca', () => {
    expect(criar('16999998888', 7)).not.toContain('16999998888');
  });

  it('cabe no link (marca curta)', () => {
    expect(criar('16999998888', 7).length).toBeLessThanOrEqual(36);
  });

  it('marca adulterada não abre', () => {
    const marca = criar('16999998888', 7);
    const mexida = marca.slice(0, -2) + (marca.endsWith('AA') ? 'BB' : 'AA');
    expect(ler(mexida)).toBeNull();
  });

  it('marca vencida não identifica ninguém', () => {
    expect(ler(criar('16999998888', -1))).toBeNull();
  });

  it('lixo no lugar da marca não derruba nada', () => {
    expect(ler('')).toBeNull();
    expect(ler('não-é-marca')).toBeNull();
    expect(ler('AAAA')).toBeNull();
  });

  it('duas marcas do mesmo número são diferentes entre si', () => {
    expect(criar('16999998888', 7)).not.toBe(criar('16999998888', 7));
  });

  it('marca de uma loja não abre em outra', () => {
    const marca = criarBruto(LOJA, '16999998888', 7);
    expect(lerBruto('gT3lDZMY7uR2pV8NDxc5a5UOYkP2', marca)).toBeNull();
  });
});
