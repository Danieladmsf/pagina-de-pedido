const fs = require('fs');
let c = fs.readFileSync('src/components/cart/CartDrawer.tsx', 'utf8');
c = c.replace('const [cashChange, setCashChange] = useState(\'\');', 'const [cashChange, setCashChange] = useState(\'\');\n  const [payDeliverySeparately, setPayDeliverySeparately] = useState(false);');
c = c.replace('const appliedDeliveryFee = orderType === \'delivery\' && !isFreeDelivery ? (dynamicFee !== null ? dynamicFee : deliveryFee) : 0;', 'const baseDeliveryFee = orderType === \'delivery\' && !isFreeDelivery ? (dynamicFee !== null ? dynamicFee : deliveryFee) : 0;\n  const appliedDeliveryFee = (paymentMethod === \'conta_casa\' && payDeliverySeparately) ? 0 : baseDeliveryFee;');
fs.writeFileSync('src/components/cart/CartDrawer.tsx', c);

