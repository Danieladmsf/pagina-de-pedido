const fs = require('fs');
let c = fs.readFileSync('src/components/cart/CartDrawer.tsx', 'utf8');
c = c.replace('import { ShoppingCart, Trash2, Minus, Plus, Loader2, MapPin, Clock, Navigation }\nfrom \'lucide-react\';', 'import { ShoppingCart, Trash2, Minus, Plus, Loader2, MapPin, Clock, Navigation, Copy }\nfrom \'lucide-react\';');
c = c.replace('import { ShoppingCart, Trash2, Minus, Plus, Loader2, MapPin, Clock, Navigation } from \"lucide-react\";', 'mmport { ShoppingCart, Trash2, Minus, Plus, Loader2, MapPin, Clock, Navigation, Copy } from \"lucide-react\";');
c = c.replace('import { ShoppingCart, Trash2, Minus, Plus, Loader2, MapPin, Clock, Navigation } from \'lucide-react\';', 'import { ShoppingCart, Trash2, Minus, Plus, Loader2, MapPin, Clock, Navigation, Copy } from \'lucide-react\';');
fs.writeFileSync('src/components/cart/CartDrawer.tsx', c);
