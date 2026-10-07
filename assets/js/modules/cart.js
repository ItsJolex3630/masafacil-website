import { DELIVERY_ZONES } from '../data/deliveryZones.js';

const state = {
  items: {}, // { [itemId]: { quantity, item } }
  deliveryType: 'delivery', // 'delivery' | 'pickup'
  selectedZoneId: 'zona-1',
  customerName: '',
  customerAddress: '',
  paymentMethod: 'pago-movil',
  notes: ''
};

const listeners = new Set();

export function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notify() {
  listeners.forEach(fn => fn(state));
}

export function addToCart(item) {
  const existing = state.items[item.id];
  if (existing) {
    existing.quantity += 1;
  } else {
    state.items[item.id] = {
      quantity: 1,
      item
    };
  }
  notify();
}

export function removeFromCart(itemId) {
  delete state.items[itemId];
  notify();
}

export function incrementQuantity(itemId) {
  if (state.items[itemId]) {
    state.items[itemId].quantity += 1;
    notify();
  }
}

export function decrementQuantity(itemId) {
  if (state.items[itemId]) {
    state.items[itemId].quantity -= 1;
    if (state.items[itemId].quantity <= 0) {
      delete state.items[itemId];
    }
    notify();
  }
}

export function setDeliveryType(type) {
  state.deliveryType = type;
  notify();
}

export function setSelectedZone(zoneId) {
  state.selectedZoneId = zoneId;
  notify();
}

export function setCustomerName(name) {
  state.customerName = name;
}

export function setCustomerAddress(addr) {
  state.customerAddress = addr;
}

export function setPaymentMethod(method) {
  state.paymentMethod = method;
}

export function setNotes(notes) {
  state.notes = notes;
}

export function getCartItems() {
  return Object.values(state.items);
}

export function getCartCount() {
  return Object.values(state.items).reduce((sum, it) => sum + it.quantity, 0);
}

export function getSubtotal() {
  return Object.values(state.items).reduce((sum, it) => sum + it.item.price * it.quantity, 0);
}

export function getDeliveryFee() {
  if (state.deliveryType === 'pickup') return 0;
  const zone = DELIVERY_ZONES.find(z => z.id === state.selectedZoneId);
  return zone ? zone.fee : 0;
}

export function getTotal() {
  return getSubtotal() + getDeliveryFee();
}

export function getSelectedZone() {
  return DELIVERY_ZONES.find(z => z.id === state.selectedZoneId) || DELIVERY_ZONES[0];
}

export function getDeliveryType() {
  return state.deliveryType;
}

export function getState() {
  return state;
}

export function formatCurrency(n) {
  return `$${n.toFixed(2).replace('.', ',')}`;
}

export function generateWhatsAppMessage() {
  const items = getCartItems();
  const subtotal = getSubtotal();
  const deliveryFee = getDeliveryFee();
  const total = getTotal();
  const zone = getSelectedZone();
  
  let lines = [];
  lines.push('🥟 *NUEVO PEDIDO · MASA FÁCIL* 🥟');
  lines.push('---------------------------------');
  
  if (state.customerName) {
    lines.push(`👤 *Cliente:* ${state.customerName}`);
  }
  
  const modalidad = state.deliveryType === 'pickup' ? 'Retiro en Local (Pick Up)' : `Delivery (${zone.name.replace(/[^\w\s,:]/g, '').trim()})`;
  lines.push(`📍 *Modalidad:* ${modalidad}`);
  
  if (state.deliveryType === 'delivery' && state.customerAddress) {
    lines.push(`🏠 *Dirección:* ${state.customerAddress}`);
  }
  
  const paymentMap = {
    'pago-movil': 'Pago Móvil',
    'efectivo': 'Efectivo $ USD',
    'zelle': 'Zelle',
    'punto': 'Punto de Venta'
  };
  lines.push(`💳 *Pago:* ${paymentMap[state.paymentMethod] || state.paymentMethod}`);
  
  lines.push('');
  lines.push('📋 *DETALLE DEL PEDIDO:*');
  
  items.forEach(it => {
    const item = it.item;
    const qty = it.quantity;
    const lineTotal = (item.price * qty).toFixed(2).replace('.', ',');
    lines.push(`• ${qty} x ${item.name} -> $${lineTotal}`);
  });
  
  lines.push('');
  lines.push('💵 *RESUMEN:*');
  lines.push(`• Subtotal productos: ${formatCurrency(subtotal)}`);
  if (state.deliveryType === 'delivery') {
    lines.push(`• Costo Delivery: ${formatCurrency(deliveryFee)}`);
  }
  lines.push(`• *TOTAL A PAGAR: ${formatCurrency(total)}*`);
  
  if (state.notes) {
    lines.push('');
    lines.push(`📝 *Notas:* ${state.notes}`);
  }
  
  lines.push('---------------------------------');
  lines.push('_Pedido generado desde la web de Masa Fácil_');
  
  return lines.join('\n');
}

export function sendWhatsApp() {
  const message = encodeURIComponent(generateWhatsAppMessage());
  const phone = '584244099610';
  const url = `https://wa.me/${phone}?text=${message}`;
  window.open(url, '_blank');
}

export function clearCart() {
  state.items = {};
  notify();
}
