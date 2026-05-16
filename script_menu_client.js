const fs = require('fs');
let c = fs.readFileSync('src/components/MenuPageClient.tsx', 'utf8');
c = c.replace('enableInventory={(storeProfile?>general?>enableInventory || false)}\n              themeId={(storeProfile as any)?.theme}\n', 'enableInventory={(storeProfile?.general?.enableInventory || false)}\n              themeId={(storeProfile as any)?.theme}\n              pixKey={storeProfile?.creditPixKey}\n              pixName={storeProfile?.creditPixName}\n              storePhone={storeProfile?.general?.phone}\n');
fs.writeFileSync('src/components/MenuPageClient.tsx', c);
