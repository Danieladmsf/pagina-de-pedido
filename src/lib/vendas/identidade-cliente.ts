import { brl } from '@/lib/utils';
import { isCreditEnabled, isValidCreditPhone, normalizeCreditPhone } from '@/lib/customer-credit';

/**
 * Quem é o cliente desta venda — e, por consequência, se o Prazo existe.
 *
 * O Prazo é fiado: sem cadastro ele é impossível. Antes desta regra o botão
 * aparecia sempre e só falhava no confirmar, jogando o operador no cadastro
 * rápido no meio do fechamento, com o cliente esperando no balcão. Agora a
 * tela deriva um estado da busca e cada estado decide o que mostrar.
 *
 * É função pura de propósito: é regra de negócio, tem que valer igual no
 * Balcão e na Mesa e ser testável sem tela.
 *
 * O QUE ELA NÃO FAZ: dívida vencida (`past_due`) depende do extrato do cliente
 * e continua sendo decidida no confirmar, por `resolveContaCasa`. A tela mostra
 * o que dá para saber sem ir ao banco; a regra final é sempre do servidor.
 */
export type EstadoIdentidade =
  /** Nada digitado — venda de balcão normal. Não precisa de botão para isso. */
  | 'anonimo'
  /** Digitou algo que ainda não é telefone válido: está no meio da digitação. */
  | 'incompleto'
  /** Telefone válido (ou só nome) sem cadastro que case. Oferece cadastrar. */
  | 'nao_encontrado'
  /** Mais de um cadastro para o mesmo telefone: não escolhemos por conta. */
  | 'conflito'
  /** Exatamente um cadastro casado. */
  | 'vinculado';

export type IdentidadeDaVenda = {
  estado: EstadoIdentidade;
  cliente: any | null;
  /** O Prazo entra na lista de formas de pagamento? */
  prazoVisivel: boolean;
  /** Entra visível porém bloqueado — o operador precisa saber que existe. */
  prazoBloqueado: boolean;
  /** Motivo pronto para a tela. `null` quando o Prazo está liberado. */
  motivoPrazo: string | null;
  /** Quanto ainda cabe no limite. `null` quando não há limite definido. */
  disponivel: number | null;
};

const semPrazo = (estado: EstadoIdentidade, cliente: any = null): IdentidadeDaVenda => ({
  estado,
  cliente,
  prazoVisivel: false,
  prazoBloqueado: false,
  motivoPrazo: null,
  disponivel: null,
});

/**
 * Cliente casado: aqui o Prazo APARECE mesmo quando não pode ser usado — com o
 * motivo. Botão que some sem explicação vira dúvida no balcão; quando a causa é
 * o próprio cliente, mostrar e explicar ensina.
 */
function comCliente(cliente: any): IdentidadeDaVenda {
  if (!isCreditEnabled(cliente)) {
    return {
      estado: 'vinculado',
      cliente,
      prazoVisivel: true,
      prazoBloqueado: true,
      motivoPrazo: 'Prazo desativado para este cliente.',
      disponivel: null,
    };
  }

  const limite = Number(cliente?.creditLimit) || 0;
  const saldo = Number(cliente?.creditBalance) || 0;
  // Limite 0 é "sem limite definido", não "limite zerado" — mesma leitura de
  // validateCreditData (`limit > 0 && limitReached`).
  const disponivel = limite > 0 ? Math.max(0, limite - saldo) : null;

  if (limite > 0 && saldo >= limite) {
    return {
      estado: 'vinculado',
      cliente,
      prazoVisivel: true,
      prazoBloqueado: true,
      motivoPrazo: `Limite esgotado: deve ${brl(saldo)} de ${brl(limite)}.`,
      disponivel: 0,
    };
  }

  return {
    estado: 'vinculado',
    cliente,
    prazoVisivel: true,
    prazoBloqueado: false,
    motivoPrazo: null,
    disponivel,
  };
}

export function resolverIdentidadeDaVenda(params: {
  nome?: string;
  telefone?: string;
  /** Cadastros da loja já sem arquivados/em unificação (useCustomerLookup). */
  clientes?: any[];
  /** Escolha explícita no autocomplete: vale mais que qualquer dedução. */
  clienteSelecionado?: any | null;
}): IdentidadeDaVenda {
  const nome = String(params.nome || '').trim();
  const telefone = String(params.telefone || '').trim();
  const clientes = Array.isArray(params.clientes) ? params.clientes : [];

  if (params.clienteSelecionado) return comCliente(params.clienteSelecionado);
  if (!nome && !telefone) return semPrazo('anonimo');

  const digitos = normalizeCreditPhone(telefone);

  // Só nome: NUNCA casamos cliente por nome — homônimo viraria um cadastro só,
  // com a dívida somada. Fica como "não encontrado" e a tela oferece cadastrar.
  if (!digitos) return semPrazo(nome ? 'nao_encontrado' : 'anonimo');

  if (!isValidCreditPhone(digitos)) return semPrazo('incompleto');

  const casados = clientes.filter(
    (cliente) => normalizeCreditPhone(String(cliente?.celular || '')) === digitos,
  );

  if (casados.length === 0) return semPrazo('nao_encontrado');
  if (casados.length > 1) return semPrazo('conflito');
  return comCliente(casados[0]);
}
