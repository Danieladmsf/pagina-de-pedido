const fs = require('fs');
let c = fs.readFileSync('src/components/cart/CartDrawer.tsx', 'utf8');
c = c.replace('deliveryFee: appliedDeliveryFee,', 'deliveryFee: baseDeliveryFee,\n          payDeliveryToMotoboy: paymentMethod === \\\'conta_casa\\\' && payDeliverySeparately,');
fs.writeFileSync('src/components/cart/CartDrawer.tsx', c);
