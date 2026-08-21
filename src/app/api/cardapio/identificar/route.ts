import { NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { getOptionalAdminDb } from '@/lib/firebase-admin';
import { lerMarcaDeContato } from '@/lib/contato-link.server';
import { docIdVisitante } from '@/lib/visitantes';
import { getPhoneVariants, matchUniqueActiveCustomerByPhone } from '@/lib/customer-credit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Reconhece quem entrou no cardápio pelo link que a própria loja mandou.
 *
 * O cardápio manda a MARCA (texto cifrado que veio na URL) e o id do visitante.
 * Quem abre a marca é o servidor, e é ele que grava a identidade — assim o
 * telefone nunca chega ao navegador de quem clicou. Se o link foi encaminhado
 * para outra pessoa, quem chega é marcado como identidade PROVÁVEL (`viaLink`),
 * e some assim que a pessoa digitar o próprio telefone no carrinho.
 *
 * Falha sempre em silêncio (`{ ok: false }`): não existe erro aqui que valha
 * atrapalhar quem está tentando fazer um pedido.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null);
    const storeId = String(body?.storeId || '').trim();
    const visitorId = String(body?.visitorId || '').trim();
    const marca = String(body?.marca || '').trim();

    if (!storeId || storeId.length <= 8 || !visitorId || !marca) {
      return NextResponse.json({ ok: false });
    }

    // A loja entra na chave da marca: marca de outra loja simplesmente não abre.
    const contato = lerMarcaDeContato(storeId, marca);
    if (!contato) return NextResponse.json({ ok: false });

    const db = getOptionalAdminDb();
    if (!db) return NextResponse.json({ ok: false });

    const ref = db.collection('store_visitors').doc(docIdVisitante(storeId, visitorId));
    const atual = await ref.get();
    const dados = atual.exists ? atual.data() || {} : {};

    // Identidade digitada pela pessoa vale mais que a do link. Só sobrescreve o
    // que veio de outro link (ou o que ainda não existe).
    if (dados.telefone && dados.viaLink !== true) return NextResponse.json({ ok: true });

    const cliente = await acharCliente(db, storeId, contato.telefone);

    await ref.set(
      {
        storeId,
        visitorId,
        telefone: contato.telefone,
        viaLink: true,
        // Vínculo por ID; o nome vai junto só para a loja ler na tela.
        ...(cliente ? { clienteId: cliente.id, nome: cliente.nome } : {}),
        ...(atual.exists ? {} : { primeiraVez: FieldValue.serverTimestamp() }),
        ultimaVez: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false });
  }
}

/**
 * Acha o cadastro pelo telefone — e só aceita quando há UM candidato. Dois
 * cadastros com o mesmo número é conflito de dado do dono, não coisa para o
 * servidor escolher no chute (ver as convenções de integridade do projeto).
 */
async function acharCliente(db: any, storeId: string, telefone: string) {
  try {
    const variantes = getPhoneVariants(telefone).slice(0, 30);
    if (!variantes.length) return null;

    const snap = await db.collection('clientes').where('celular', 'in', variantes).get();
    const daLoja = snap.docs
      .filter((d: any) => d.get('ownerId') === storeId)
      .map((d: any) => ({ id: d.id, data: d.data() }));

    const achado = matchUniqueActiveCustomerByPhone(daLoja as any, telefone);
    if (achado.kind !== 'unique') return null;

    const cliente = (achado as any).customer;
    return { id: cliente.id as string, nome: String(cliente.data?.nome || '') };
  } catch {
    // Sem o cadastro a visita ainda é reconhecida pelo telefone; o nome aparece
    // quando a tela cruzar com a lista de clientes.
    return null;
  }
}
