const fs = require('fs');
let c = fs.readFileSync('src/components/cart/CartDrawer.tsx', 'utf8');
c = c.replace('themeId?: string | null;\n', 'themeId?: string | null;\n  pixKey?: string;\n  pixName?: string;\n  storePhone?: string;\n');
fs.writeFileSync('src/components/cart/CartDrawer.tsx', c);
