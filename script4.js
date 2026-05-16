const fs = require('fs');
let c = fs.readFileSync('src/components/cart/CartDrawer.tsx', 'utf8');
c = c.replace('payDeliveryToMotoboy: paymentMethod === \\\'conta_casa\\\' && payDeliverySeparately,', 'payDeliveryToMotoboy: paymentMethod === \'conta_casa\' && payDeliverySeparately,');
fs.writeFileSync('src/components/cart/CartDrawer.tsx', c);
