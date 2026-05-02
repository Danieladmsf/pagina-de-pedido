const fs = require('fs');

const raw = `Suco 500 ml
12,00
0,00
0,00

Opção	Preço	Preço a antigo
Açai
0,00
0,00

Abacaxi
3,00
0,00`;

const lines = raw.split('\n').map(l => l.trim());
let currentItem = null;
let mode = 'products';
const items = [];

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  if (!line) continue;
  if (line.includes('Opção\tPreço')) {
    mode = 'options';
    continue;
  }
  
  if (mode === 'products') {
    const name = line;
    let priceLine = '';
    const nextLine = lines[i+1] || '';
    if (nextLine.match(/^\d+,\d\d$/)) {
      priceLine = nextLine;
      i += 3;
    }
    const price = parseFloat(priceLine.replace('.', '').replace(',', '.'));
    currentItem = { name, price, options: [] };
    items.push(currentItem);
  } else if (mode === 'options') {
    const name = line;
    const nextLine = lines[i+1] || '';
    if (!nextLine.match(/^\d+,\d\d$/)) {
      console.log('SWITCHED TO PRODUCTS AT: ', name, nextLine);
      mode = 'products';
      i--; 
      continue;
    }
    const priceLine = nextLine;
    const price = parseFloat(priceLine.replace('.', '').replace(',', '.'));
    i += 2; 
    if (currentItem) currentItem.options.push({ name, price });
  }
}

console.log(JSON.stringify(items, null, 2));
