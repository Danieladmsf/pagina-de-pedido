const fs = require('fs');
let c = fs.readFileSync('src/components/cart/CartDrawer.tsx', 'utf8');
c = c.replace(
  const [paymentMethod, setPaymentMethod] = useState('');\r\n  const [cashChange, setCashChange] = useState('');,
  const [paymentMethod, setPaymentMethod] = useState('');\r\n  const [cashChange, setCashChange] = useState('');\r\n  const [payDeliverySeparately, setPayDeliverySeparately] = useState(false);
);
c = c.replace(
  const appliedDeliveryFee = orderType === 'delivery' && !isFreeDelivery ? (dynamicFee !== null ? dynamicFee : deliveryFee) : 0;,
  const baseDeliveryFee = orderType === 'delivery' && !isFreeDelivery ? (dynamicFee !== null ? dynamicFee : deliveryFee) : 0;\r\n  const appliedDeliveryFee = (paymentMethod === 'conta_casa' && payDeliverySeparately) ? 0 : baseDeliveryFee;
);
fs.writeFileSync('src/components/cart/CartDrawer.tsx', c);
