const fs = require('fs');
let c = fs.readFileSync('src/components/cart/CartDrawer.tsx', 'utf8');
c = c.replace('enableInventory,\n  themeId,\n}: CartDrawerProps' , 'enableInventory,\n  themeId,\n  pixKey,\n  pixName,\n  storePhone,\n}: CartDrawerProps');
fs.writeFileSync('src/components/cart/CartDrawer.tsx', c);
