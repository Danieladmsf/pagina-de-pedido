const fs = require('fs');

const raw = fs.readFileSync('./raw_menu.txt', 'utf8');
const lines = raw.split('\n').map(l => l.trim());

const categoriesList = [
  'Marmitex', 'Prato do dia', 'Prato Feito', 'Massas', 'Omeletes', 'Crepiocas', 'Tapiocas', 
  'Lanches Naturais', 'Lanches Quentes', 'Promoção Lanches Quentes', 'Sucos', 'Sucos Detox (Funcionais)', 
  'Vitaminas', 'Refrigerantes', 'Salgados', 'Sobremesas', 'Bomboniere', 'Café', 'Caldos'
];

// Override exato item-a-item — copiado da lista Bysell
const categoryOverrides = {
  // Marmitex
  'combo feijoada': 'Marmitex',
  'marmitex m feijoada': 'Marmitex',
  // Prato Feito (APENAS estes PFs específicos)
  'pf: kids c/ nuggets': 'Prato Feito',
  'pf: kids c/ nuggets': 'Prato Feito',
  'pf: omelete': 'Prato Feito',
  'pf: sem carne': 'Prato Feito',
  'pf: copa lombo': 'Prato Feito',
  'pf: linguiça': 'Prato Feito',
  'pf: filé de peixe': 'Prato Feito',
  'pf: filé de frango': 'Prato Feito',
  'pf: contra filé': 'Prato Feito',
  'add prato': 'Prato Feito',
  'salada no prato': 'Prato Feito',
  // Prato do dia (itens que cairiam em outra cat pela heurística)
  'porção de maionese 300grs': 'Prato do dia',
  'porção de moqueca': 'Prato do dia',
  'unidade panqueca': 'Prato do dia',
  'unidade charuto': 'Prato do dia',
  'pedaço de quibe': 'Prato do dia',
  'pedaço individual lasanha': 'Prato do dia',
  'capeletti de carne ao molho bolonhesa': 'Prato do dia',
  'torta de sardinha': 'Prato do dia',
  // Promoção Lanches Quentes (nomes exatos, case-sensitive, checados separadamente)
  // -- removidos daqui, vão para caseSensitiveOverrides
  // Caldos
  'caldo de mandioca': 'Caldos',
  // Refrigerantes (itens que cairiam em outra cat)
  'suco nativo': 'Refrigerantes',
  // Bomboniere
  'azedinha': 'Bomboniere',
  // Salgados
  'pf pão de queijo': 'Salgados',
};

// Overrides case-sensitive para itens que diferem do principal apenas por maiúscula
const caseSensitiveOverrides = {
  '2 X tudo': 'Promoção Lanches Quentes',
  'Copa Lombo salada': 'Promoção Lanches Quentes',
  'X tudo': 'Promoção Lanches Quentes',
  'X linguiça salada': 'Promoção Lanches Quentes',
  'Frango salada': 'Promoção Lanches Quentes',
  'X salada': 'Promoção Lanches Quentes',
};

function getCategory(name, price) {
  // 0. Override case-sensitive primeiro (promoções)
  if (caseSensitiveOverrides[name]) return caseSensitiveOverrides[name];
  const n = name.toLowerCase();
  // 1. Override exato primeiro
  if (categoryOverrides[n]) return categoryOverrides[n];
  // 2. Regras por palavra-chave
  if (n.includes('marmitex')) return 'Marmitex';
  if (n.startsWith('bomboniere')) return 'Bomboniere';
  // PF vai para PRATO DO DIA por padrão (igual Bysell)
  if (n.includes('pf:') || n.includes('pf ')) return 'Prato do dia';
  if (n.includes('omelete')) return 'Omeletes';
  if (n.includes('crepioca')) return 'Crepiocas';
  if (n.includes('tapioca')) return 'Tapiocas';
  if (n.includes('lanche natural')) return 'Lanches Naturais';
  if (n.includes('funcional') || n.includes('detox')) return 'Sucos Detox (Funcionais)';
  if (n.includes('suco')) return 'Sucos';
  if (n.includes('vitamina')) return 'Vitaminas';
  if (n.match(/refrigerante|coca|sprite|fanta|guarana|schweppes|jaboti|água|limoneto|bioleve/)) return 'Refrigerantes';
  if (n.match(/salgado|coxinha|pastel|quibe|esfiha|empada|hamburguer|doguinho|pizza|enroladinho|pão de batata|croissant|folheado|calabresa$/)) return 'Salgados';
  if (n.match(/salada de frutas|açai|açaí|pudim|bolo/)) return 'Sobremesas';
  if (n.match(/bomboniere|bala|trident|halls|suflair|kit kat|ninho|pingo|paçoca|pé de moça|paçoquita|trento|stikadinho|sonho de valsa|ouro branco/)) return 'Bomboniere';
  if (n.match(/café|capuccino|pingado|pão de queijo|pão na chapa|pão com ovo/)) return 'Café';
  if (n.includes('nhoque') || n.includes('lasanha')) return 'Massas';
  // Lanches quentes
  if (n.match(/^x |^copa lombo|^frango |^filé |^file |^carne queijo|^bauru|^misto$|^americano/)) return 'Lanches Quentes';
  return 'Prato do dia'; // fallback
}

const items = [];
let currentItem = null;
let mode = 'products'; 

for (let i = 0; i < lines.length; i++) {
  let line = lines[i];
  if (!line) continue;
  if (line.includes('Produto\tPreço\tPreço a partir\tValor antigo')) continue;
  if (line === 'ㅤ') {
    line = 'Tapioca Salgada';
    lines[i] = 'Tapioca Salgada';
  }
  
  if (line.includes('Opção\tPreço\tPreço a antigo') || line.includes('Opção	Preço	Preço a antigo')) {
    mode = 'options';
    continue;
  }
  
  if (mode === 'products') {
    const name = line;
    let description = '';
    let priceLine = '';
    
    const nextLine = lines[i+1] || '';
    if (nextLine.match(/^\d+,\d\d$/)) {
      priceLine = nextLine;
      i += 3; // skip price, a partir, antigo
    } else {
      description = nextLine;
      priceLine = lines[i+2] || '0,00';
      i += 4; 
    }
    
    const price = parseFloat(priceLine.replace('.', '').replace(',', '.'));
    
    currentItem = {
      name,
      description,
      price,
      category: getCategory(name, price),
      options: []
    };
    items.push(currentItem);
  } else if (mode === 'options') {
    const name = line;
    let hasDescription = false;
    let isProduct = false;
    
    if (!lines[i+1]?.match(/^\d+,\d\d$/)) {
      hasDescription = true;
    }
    
    if (!hasDescription) {
      const p1 = !!lines[i+1]?.match(/^\d+,\d\d$/);
      const p2 = !!lines[i+2]?.match(/^\d+,\d\d$/);
      const p3 = !!lines[i+3]?.match(/^\d+,\d\d$/);
      if (p1 && p2 && p3) isProduct = true;
    } else {
      const p1 = !!lines[i+2]?.match(/^\d+,\d\d$/);
      const p2 = !!lines[i+3]?.match(/^\d+,\d\d$/);
      const p3 = !!lines[i+4]?.match(/^\d+,\d\d$/);
      if (p1 && p2 && p3) isProduct = true;
    }

    if (isProduct) {
      mode = 'products';
      i--; 
      continue;
    }
    
    let optPrice = 0;
    if (!hasDescription) {
      optPrice = parseFloat(lines[i+1].replace('.', '').replace(',', '.'));
      i += 2; 
    } else {
      optPrice = parseFloat(lines[i+2].replace('.', '').replace(',', '.'));
      i += 3; 
    }
    
    if (currentItem && !currentItem.options.find(o => o.name === name)) {
      currentItem.options.push({ name, price: isNaN(optPrice) ? 0 : optPrice });
    }
  }
}

const finalItems = [];
const globalAddonsMap = {};

items.forEach(item => {
  if (item.price === 0 && item.options.length > 0) {
    // Split into individual items
    item.options.forEach(opt => {
      finalItems.push({
        name: `${item.name} - ${opt.name}`.replace('Salgados Assados - ', '').replace('Pizzas - ', 'Pizza ').replace('Escolha sua tapioca doce - ', 'Tapioca Doce '),
        description: item.description,
        price: opt.price,
        category: item.category,
        isMarmita: false,
        addonGroups: []
      });
    });
  } 
  else if (item.category === 'Marmitex' || item.category === 'Prato Feito' || item.category === 'Prato do dia') {
    finalItems.push({
      name: item.name,
      description: item.description,
      price: item.price,
      category: item.category,
      isMarmita: true,
      addonGroups: item.options.length > 0 ? [{
        name: 'Opções e Acompanhamentos',
        min: 0,
        max: item.options.length,
        addonIds: [] 
      }] : [],
      optionsRaw: item.options 
    });
  } 
  else {
    finalItems.push({
      name: item.name,
      description: item.description,
      price: item.price,
      category: item.category,
      isMarmita: false,
      addonGroups: item.options.length > 0 ? [{
        name: 'Adicionais / Variações',
        min: 0,
        max: item.options.length,
        addonIds: []
      }] : [],
      optionsRaw: item.options 
    });
  }
});

// Generate Addons
finalItems.forEach(item => {
  if (item.optionsRaw) {
    item.optionsRaw.forEach(opt => {
      const key = `${opt.name}-${opt.price}`;
      if (!globalAddonsMap[key]) {
        globalAddonsMap[key] = {
          id: `addon_${Object.keys(globalAddonsMap).length + 1}`,
          name: opt.name,
          price: isNaN(opt.price) ? 0 : opt.price,
          group: item.isMarmita ? 'Opções PF/Marmitex' : 'Adicionais Extras'
        };
      }
      item.addonGroups[0].addonIds.push(globalAddonsMap[key].id);
    });
    delete item.optionsRaw;
  }
});

const cleanedItems = finalItems.filter(i => i.name !== '0,00' && i.name !== '' && !isNaN(i.price));

// Remover duplicatas: "Bomboniere - Balas" quando "Balas" já existe como produto separado
const bombDupeNames = cleanedItems
  .filter(i => i.name.startsWith('Bomboniere - '))
  .map(i => i.name);

const withoutBombDupes = cleanedItems.filter(i => {
  if (!i.name.startsWith('Bomboniere - ')) return true;
  const baseName = i.name.replace('Bomboniere - ', '');
  const existsAlone = cleanedItems.some(o => o.name === baseName && !o.name.startsWith('Bomboniere - '));
  return !existsAlone; // keep only if standalone doesn't exist
});

// Remover duplicatas por nome (manter o primeiro)
const seen = new Set();
const dedupedItems = withoutBombDupes.filter(i => {
  if (seen.has(i.name)) return false;
  seen.add(i.name);
  return true;
});

fs.writeFileSync('./public/menu.json', JSON.stringify({
  categories: categoriesList,
  items: dedupedItems,
  addons: Object.values(globalAddonsMap)
}, null, 2));

console.log('Parsed successfully. Found ' + dedupedItems.length + ' products and ' + Object.keys(globalAddonsMap).length + ' addons.');
