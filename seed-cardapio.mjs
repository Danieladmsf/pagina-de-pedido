import { initializeApp } from 'firebase/app';
import { getFirestore, collection, doc, setDoc } from 'firebase/firestore';
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth';

const firebaseConfig = {
  projectId: 'studio-2243391254-75492',
  appId: '1:1044409297961:web:5b5d1509a9bddc8019c038',
  apiKey: 'AIzaSyAVes6z9Na9FpGkxtq-1HyD9ufrkumHYtA',
  authDomain: 'studio-2243391254-75492.firebaseapp.com',
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

const email = process.argv[2];
const password = process.argv[3];

if (!email || !password) {
  console.log('Uso: node seed-cardapio.mjs SEU_EMAIL SUA_SENHA');
  process.exit(1);
}

const CATEGORIES = [
  'Marmitex','Prato do dia','Prato Feito','Massas','Omeletes','Crepiocas','Tapiocas',
  'Lanches Naturais','Lanches Quentes','Promoção Lanches Quentes','Sucos',
  'Sucos Detox (Funcionais)','Vitaminas','Refrigerantes','Salgados','Sobremesas',
  'Bomboniere','Café','Caldos',
];

const MENU_ITEMS = [
  // MARMITEX (8)
  {n:'COMBO FEIJOADA',d:'',p:50.00,c:'Marmitex'},
  {n:'Marmitex P (1 Carne)',d:'',p:18.90,c:'Marmitex'},
  {n:'Marmitex P (2 Carne)',d:'',p:23.90,c:'Marmitex'},
  {n:'Marmitex M (1 Carne)',d:'',p:22.90,c:'Marmitex'},
  {n:'Marmitex M (2 Carne)',d:'',p:27.90,c:'Marmitex'},
  {n:'Marmitex Executiva (1 Carne)',d:'',p:27.00,c:'Marmitex'},
  {n:'Marmitex Executiva (2 Carne)',d:'',p:30.00,c:'Marmitex'},
  {n:'Marmitex M Feijoada',d:'',p:25.90,c:'Marmitex'},
  // LANCHES QUENTES (30)
  {n:'Bauru',d:'Presunto, Muçarela e Tomate.',p:15.00,c:'Lanches Quentes'},
  {n:'Misto',d:'Presunto e Mussarela.',p:12.00,c:'Lanches Quentes'},
  {n:'Americano',d:'Presunto, Mussarela, Ovo, Alface e Tomate.',p:18.00,c:'Lanches Quentes'},
  {n:'X Salada',d:'Hambúrguer, Presunto, Mussarela, Alface e Tomate.',p:18.00,c:'Lanches Quentes'},
  {n:'X Salada EGG',d:'Hambúrguer, Presunto, Mussarela, Ovo, Alface e Tomate.',p:19.00,c:'Lanches Quentes'},
  {n:'X Salada Bacon',d:'Hambúrguer, Presunto, Mussarela, Bacon, Alface e Tomate.',p:20.00,c:'Lanches Quentes'},
  {n:'X Salada EGG Bacon',d:'Hambúrguer, Presunto, Mussarela, Bacon, Ovo, Alface e Tomate.',p:21.00,c:'Lanches Quentes'},
  {n:'X Tudo',d:'Hambúrguer, Presunto, Mussarela, Bacon, Ovo, Salsicha, Alface e Tomate.',p:22.00,c:'Lanches Quentes'},
  {n:'Copa Lombo Salada',d:'Lombo, Presunto, Mussarela, Alface e Tomate.',p:20.00,c:'Lanches Quentes'},
  {n:'Copa Lombo Salada EGG',d:'Lombo, Presunto, Mussarela, Ovo, Alface e Tomate.',p:21.00,c:'Lanches Quentes'},
  {n:'Copa Lombo Salada Bacon',d:'Lombo, Presunto, Mussarela, Bacon, Alface e Tomate.',p:22.00,c:'Lanches Quentes'},
  {n:'Copa Lombo Salada Bacon EGG',d:'Lombo, Presunto, Mussarela, Bacon, Ovo, Alface e Tomate.',p:23.00,c:'Lanches Quentes'},
  {n:'Copa Lombo Tudo',d:'Lombo, Presunto, Mussarela, Bacon, Ovo, Salsicha, Alface e Tomate.',p:25.00,c:'Lanches Quentes'},
  {n:'X Linguiça Salada',d:'Linguiça, Presunto, Mussarela, Alface e Tomate.',p:19.00,c:'Lanches Quentes'},
  {n:'X Linguiça Salada EGG',d:'Linguiça, Presunto, Mussarela, Ovo, Alface e Tomate.',p:20.00,c:'Lanches Quentes'},
  {n:'X Linguiça Bacon',d:'Linguiça, Presunto, Mussarela, Bacon, Alface e Tomate.',p:21.00,c:'Lanches Quentes'},
  {n:'X Linguiça EGG Bacon',d:'Linguiça, Presunto, Mussarela, Bacon, Ovo, Alface e Tomate.',p:22.00,c:'Lanches Quentes'},
  {n:'X Linguiça Tudo',d:'Linguiça, Presunto, Mussarela, Bacon, Ovo, Salsicha, Alface e Tomate.',p:23.00,c:'Lanches Quentes'},
  {n:'Frango Salada',d:'Frango, Presunto, Mussarela, Alface e Tomate.',p:21.00,c:'Lanches Quentes'},
  {n:'Frango Salada EGG',d:'Frango, Presunto, Mussarela, Ovo, Alface e Tomate.',p:22.00,c:'Lanches Quentes'},
  {n:'Frango Salada Bacon',d:'Frango, Presunto, Mussarela, Bacon, Alface e Tomate.',p:23.00,c:'Lanches Quentes'},
  {n:'Frango Salada EGG Bacon',d:'Frango, Presunto, Mussarela, Bacon, Ovo, Alface e Tomate.',p:24.00,c:'Lanches Quentes'},
  {n:'Frango Tudo',d:'Frango, Presunto, Mussarela, Bacon, Ovo, Salsicha, Alface e Tomate.',p:25.00,c:'Lanches Quentes'},
  {n:'Filé Salada',d:'Contra filé, presunto, queijo, alface e tomate.',p:25.00,c:'Lanches Quentes'},
  {n:'Filé Salada EGG',d:'Contra filé, presunto, queijo, ovo, alface e tomate.',p:27.00,c:'Lanches Quentes'},
  {n:'Filé Salada Bacon',d:'Contra filé, presunto, queijo, bacon, alface, tomate.',p:29.00,c:'Lanches Quentes'},
  {n:'Filé Salada EGG Bacon',d:'Contra Filé, presunto, queijo, ovo, bacon, alface, tomate.',p:31.00,c:'Lanches Quentes'},
  {n:'Carne Queijo Acebolado',d:'Contra filé, Queijo, cebola.',p:30.00,c:'Lanches Quentes'},
  {n:'Filé tudo',d:'Contra filé, presunto, queijo, ovo, bacon, salsicha, alface e tomate.',p:35.00,c:'Lanches Quentes'},
  {n:'X Burguer',d:'Hambúrguer e queijo',p:15.00,c:'Lanches Quentes'},
  // PROMOÇÃO LANCHES QUENTES (6)
  {n:'Copa Lombo salada',d:'Promoção',p:25.00,c:'Promoção Lanches Quentes'},
  {n:'X tudo',d:'Promoção',p:27.00,c:'Promoção Lanches Quentes'},
  {n:'X linguiça salada',d:'Promoção',p:24.00,c:'Promoção Lanches Quentes'},
  {n:'Frango salada',d:'Promoção',p:26.00,c:'Promoção Lanches Quentes'},
  {n:'X salada',d:'Promoção',p:23.00,c:'Promoção Lanches Quentes'},
  {n:'2 X tudo',d:'Promoção',p:50.00,c:'Promoção Lanches Quentes'},
  // SALGADOS (13)
  {n:'PF Pão de queijo',d:'',p:3.50,c:'Salgados'},
  {n:'Croissant de chocolate',d:'',p:8.00,c:'Salgados'},
  {n:'Salgados fritos',d:'',p:6.50,c:'Salgados'},
  {n:'Torta de sardinha',d:'',p:7.00,c:'Salgados'},
  {n:'Salgados Assados',d:'',p:6.50,c:'Salgados'},
  {n:'Pizzas',d:'',p:8.00,c:'Salgados'},
  {n:'Croissant presunto e queijo',d:'',p:8.00,c:'Salgados'},
  {n:'Croissant quatro queijos',d:'',p:7.00,c:'Salgados'},
  {n:'Croissant frango',d:'',p:8.00,c:'Salgados'},
  {n:'Folheado de Ricota',d:'',p:7.00,c:'Salgados'},
  {n:'Folheado de peito de peru',d:'',p:7.00,c:'Salgados'},
  {n:'Folheado de Presunto e queijo',d:'',p:7.00,c:'Salgados'},
  {n:'Empadas',d:'',p:8.00,c:'Salgados'},
  // SUCOS (2)
  {n:'Promoção Suco de Limão',d:'',p:9.00,c:'Sucos'},
  {n:'Suco 500 ml',d:'',p:12.00,c:'Sucos'},
  // SOBREMESAS (4)
  {n:'Salada de Frutas',d:'Laranja, mamão, maçã, pera, banana, manga e uva.',p:15.00,c:'Sobremesas'},
  {n:'Açai',d:'',p:18.00,c:'Sobremesas'},
  {n:'Pedaço bolo fubá c/laranja',d:'',p:5.00,c:'Sobremesas'},
  {n:'Pudim de leite condensado',d:'',p:6.00,c:'Sobremesas'},
  // CAFÉ (10)
  {n:'Pão de Queijo',d:'',p:4.00,c:'Café'},
  {n:'Pão de Queijo Recheado',d:'',p:6.00,c:'Café'},
  {n:'Pão na Chapa com Manteiga',d:'',p:5.00,c:'Café'},
  {n:'Pão na chapa com queijo',d:'',p:10.00,c:'Café'},
  {n:'Pão com ovo',d:'',p:12.00,c:'Café'},
  {n:'Pão com ovo e queijo',d:'',p:15.00,c:'Café'},
  {n:'Café',d:'',p:3.50,c:'Café'},
  {n:'Pingado',d:'',p:7.00,c:'Café'},
  {n:'Capuccino Quente',d:'',p:8.00,c:'Café'},
  {n:'Capuccino Gelado',d:'',p:10.00,c:'Café'},
  // REFRIGERANTES (15)
  {n:'Coca cola 1L',d:'Consumo no local',p:10.00,c:'Refrigerantes'},
  {n:'Bioleve',d:'',p:4.00,c:'Refrigerantes'},
  {n:'Refrigerante lata 350ml',d:'',p:6.50,c:'Refrigerantes'},
  {n:'Coca cola 220ml',d:'',p:5.00,c:'Refrigerantes'},
  {n:'Coca-Cola KS',d:'Consumo no local',p:5.00,c:'Refrigerantes'},
  {n:'Coca-Cola 600ml',d:'',p:8.00,c:'Refrigerantes'},
  {n:'Coca-Cola 2Lts',d:'',p:13.00,c:'Refrigerantes'},
  {n:'Jaboti 600ml',d:'Consumo no local',p:5.00,c:'Refrigerantes'},
  {n:'Jaboti 250ml',d:'',p:3.50,c:'Refrigerantes'},
  {n:'Jaboti 2Lts',d:'',p:7.00,c:'Refrigerantes'},
  {n:'Água com Gás',d:'',p:4.00,c:'Refrigerantes'},
  {n:'Água sem Gás',d:'',p:4.00,c:'Refrigerantes'},
  {n:'Limoneto H2OH',d:'',p:7.00,c:'Refrigerantes'},
  {n:'Suco Nativo',d:'',p:3.50,c:'Refrigerantes'},
  {n:'Guarana Antarctica 300ml (Retornavel)',d:'Consumo no local',p:4.50,c:'Refrigerantes'},
  // LANCHES NATURAIS (1)
  {n:'Lanche Natural',d:'',p:10.00,c:'Lanches Naturais'},
  // PRATO DO DIA (43)
  {n:'PF: File de Frango a Parmegiana',d:'',p:26.90,c:'Prato do dia'},
  {n:'PF: Quibe assado',d:'',p:20.90,c:'Prato do dia'},
  {n:'PF: Pernil Suina Acebolada',d:'',p:19.90,c:'Prato do dia'},
  {n:'Pedaço de quibe',d:'',p:8.00,c:'Prato do dia'},
  {n:'PF: Moqueca',d:'',p:26.90,c:'Prato do dia'},
  {n:'PF: Peixe frito',d:'',p:22.90,c:'Prato do dia'},
  {n:'Porção de moqueca',d:'',p:20.00,c:'Prato do dia'},
  {n:'PF: Fricasse Frango',d:'',p:18.90,c:'Prato do dia'},
  {n:'PF: Carne de Panela c/ Batata',d:'',p:22.90,c:'Prato do dia'},
  {n:'PF: Feijão gordo',d:'',p:22.90,c:'Prato do dia'},
  {n:'PF: Tirinha de Frango Acebolada',d:'',p:18.90,c:'Prato do dia'},
  {n:'PF : Calabresa Acebolada',d:'',p:18.90,c:'Prato do dia'},
  {n:'PF: Feijoada',d:'',p:25.90,c:'Prato do dia'},
  {n:'Pf : Sobrecoxa com Quiabo ao molho',d:'',p:19.90,c:'Prato do dia'},
  {n:'PF: Copa Lombo em tiras Aceboladas',d:'',p:21.90,c:'Prato do dia'},
  {n:'PF: Meio d Asa Frango e sobrecoxa refogada suculenta',d:'',p:18.90,c:'Prato do dia'},
  {n:'Unidade panqueca',d:'',p:10.00,c:'Prato do dia'},
  {n:'PF: Carne Suina em cubos',d:'',p:21.90,c:'Prato do dia'},
  {n:'PF: Almôndega ao molho',d:'',p:20.90,c:'Prato do dia'},
  {n:'PF: Ponta de Peito de panela',d:'',p:22.90,c:'Prato do dia'},
  {n:'PF: Costela Bovina cm Mandioca',d:'',p:22.90,c:'Prato do dia'},
  {n:'PF : Nhoqque c/ Coxinha Asa Frango Frita',d:'',p:22.90,c:'Prato do dia'},
  {n:'PF : Macarrão ao Sugo c/ Coxinha Frango Frita',d:'',p:20.90,c:'Prato do dia'},
  {n:'PF: Panqueca',d:'',p:22.90,c:'Prato do dia'},
  {n:'Unidade charuto',d:'',p:10.00,c:'Prato do dia'},
  {n:'PF: Filé de Frango a Milanesa',d:'',p:20.90,c:'Prato do dia'},
  {n:'PF: Carne Moída c/ Legumes',d:'',p:20.90,c:'Prato do dia'},
  {n:'PF: Peixe c/ batata ao molho',d:'',p:24.90,c:'Prato do dia'},
  {n:'PF: Lasanha ao Molho Rose',d:'',p:20.90,c:'Prato do dia'},
  {n:'PF : Sobrecoxa c/ Macarrão ao Sugo',d:'',p:20.90,c:'Prato do dia'},
  {n:'Porção de Maionese 300grs',d:'',p:24.00,c:'Prato do dia'},
  {n:'PF : Strogonoff de Carne',d:'',p:22.90,c:'Prato do dia'},
  {n:'PF : Macarrão ao Sugo c/ Sobrecoxa',d:'',p:22.90,c:'Prato do dia'},
  {n:'Torta de sardinha',d:'',p:7.00,c:'Prato do dia'},
  {n:'Capeletti de carne ao molho Bolonhesa',d:'',p:19.90,c:'Prato do dia'},
  {n:'PF : Nhoqque c/ Sobrecoxa Frango Assada',d:'',p:22.90,c:'Prato do dia'},
  {n:'PF: Charuto',d:'',p:22.90,c:'Prato do dia'},
  {n:'PF: Carré Suino Assado c/ Vinagrete',d:'',p:22.90,c:'Prato do dia'},
  {n:'PF: Tiras de carne Acebolado',d:'',p:22.90,c:'Prato do dia'},
  {n:'PF : Strogonoff de Frango',d:'',p:19.90,c:'Prato do dia'},
  {n:'PF: Lasanha ao molho rose presunto e queijo',d:'',p:22.90,c:'Prato do dia'},
  {n:'PF : Nhoqque c/ Tirinha Carne Acebolada e Salada',d:'',p:22.90,c:'Prato do dia'},
  {n:'Pedaço individual lasanha',d:'',p:15.00,c:'Prato do dia'},
  // PRATO FEITO (11)
  {n:'PF: Filé de frango',d:'Arroz, feijão, filé de frango grelhado, um acompanhamento e salada',p:20.90,c:'Prato Feito'},
  {n:'PF: Filé de peixe',d:'Arroz, feijão, filé de tilápia grelhado, um acompanhamento e salada',p:28.90,c:'Prato Feito'},
  {n:'PF: Linguiça',d:'Arroz, feijão, linguiça, um acompanhamento e salada',p:20.90,c:'Prato Feito'},
  {n:'PF: sem carne',d:'Arroz, feijão, dois acompanhamentos e salada',p:17.90,c:'Prato Feito'},
  {n:'Salada no prato',d:'',p:30.00,c:'Prato Feito'},
  {n:'PF: Copa Lombo',d:'Arroz, feijão, copa lombo grelhado, um acompanhamento e salada',p:21.90,c:'Prato Feito'},
  {n:'PF: Contra filé',d:'Arroz, feijão, bife de contra filé grelhado, um acompanhamento e salada',p:28.90,c:'Prato Feito'},
  {n:'PF: Kids c/ Nuggets',d:'',p:17.90,c:'Prato Feito'},
  {n:'PF: Omelete',d:'Omelete simples (sem recheio), Arroz, Feijão e salada',p:16.90,c:'Prato Feito'},
  {n:'PF: Kids c/ hamburguer',d:'Arroz, feijão, hambúrguer, queijo, batata frita + salada',p:17.90,c:'Prato Feito'},
  {n:'Add Prato',d:'Somente PDV',p:0,c:'Prato Feito'},
  // BOMBONIERE (16)
  {n:'Bomboniere',d:'',p:0.20,c:'Bomboniere'},
  {n:'Azedinha',d:'',p:3.00,c:'Bomboniere'},
  {n:'Balas',d:'',p:0.20,c:'Bomboniere'},
  {n:'Trident',d:'',p:3.00,c:'Bomboniere'},
  {n:'Halls',d:'',p:2.00,c:'Bomboniere'},
  {n:'Suflair',d:'',p:8.00,c:'Bomboniere'},
  {n:'Kit kat',d:'',p:7.00,c:'Bomboniere'},
  {n:'Doce Ninho',d:'',p:2.50,c:'Bomboniere'},
  {n:'Pingo Leite',d:'',p:2.50,c:'Bomboniere'},
  {n:'Paçoca',d:'',p:3.50,c:'Bomboniere'},
  {n:'Pé de Moça',d:'',p:3.50,c:'Bomboniere'},
  {n:'Paçoquita',d:'',p:0.50,c:'Bomboniere'},
  {n:'Trento',d:'',p:4.00,c:'Bomboniere'},
  {n:'Stikadinho',d:'',p:2.00,c:'Bomboniere'},
  {n:'Sonho de valsa',d:'',p:2.50,c:'Bomboniere'},
  {n:'Ouro branco',d:'',p:2.50,c:'Bomboniere'},
  // CALDOS (1)
  {n:'Caldo de mandioca',d:'',p:20.00,c:'Caldos'},
  // MASSAS (1)
  {n:'Nhoque',d:'',p:20.00,c:'Massas'},
  // OMELETES (1)
  {n:'Omelete',d:'',p:18.00,c:'Omeletes'},
  // CREPIOCAS (1)
  {n:'Crepioca',d:'',p:20.00,c:'Crepiocas'},
  // TAPIOCAS (2)
  {n:'Escolha sua tapioca doce',d:'',p:25.00,c:'Tapiocas'},
  {n:'Tapioca',d:'',p:18.00,c:'Tapiocas'},
  // SUCOS DETOX (1)
  {n:'Sucos Funcionais (Detox)',d:'',p:15.00,c:'Sucos Detox (Funcionais)'},
  // VITAMINAS (3)
  {n:'Promoção vitamina Mista com Laranja 500 ml',d:'',p:9.00,c:'Vitaminas'},
  {n:'Promoção vitamina de Abacate 500ml',d:'',p:10.00,c:'Vitaminas'},
  {n:'Vitaminas 500 ml',d:'',p:15.00,c:'Vitaminas'},
];

async function seed() {
  console.log('Fazendo login...');
  const cred = await signInWithEmailAndPassword(auth, email, password);
  const uid = cred.user.uid;
  console.log('Login OK! UID:', uid);
  console.log(`Total: ${CATEGORIES.length} categorias | ${MENU_ITEMS.length} produtos`);

  const categoryMap = {};
  for (let i = 0; i < CATEGORIES.length; i++) {
    const ref = doc(collection(db, 'categories'));
    await setDoc(ref, { id:ref.id, name:CATEGORIES[i], ownerId:uid, displayOrder:i, description:'' });
    categoryMap[CATEGORIES[i]] = ref.id;
    console.log(`Cat [${i+1}/${CATEGORIES.length}] ${CATEGORIES[i]}`);
  }

  let ok = 0;
  for (let i = 0; i < MENU_ITEMS.length; i++) {
    const it = MENU_ITEMS[i];
    const catId = categoryMap[it.c];
    if (!catId) { console.log(`SKIP: "${it.n}" cat "${it.c}" not found`); continue; }
    const ref = doc(collection(db, 'menuItems'));
    await setDoc(ref, { id:ref.id, name:it.n, description:it.d, price:it.p, categoryId:catId, ownerId:uid, isAvailable:true, isRecommended:false, imageUrl:'', addonIds:[] });
    ok++;
    console.log(`Item [${ok}/${MENU_ITEMS.length}] ${it.n} - R$ ${it.p.toFixed(2)}`);
  }

  console.log(`\nCONCLUIDO! ${CATEGORIES.length} categorias + ${ok} produtos criados.`);
  process.exit(0);
}

seed().catch(e => { console.error('ERRO:', e.message); process.exit(1); });
