import { MENU_ITEMS, MENU_CATEGORIES } from './data/menuData.js';
import { DELIVERY_ZONES } from './data/deliveryZones.js';
import { GOOGLE_REVIEWS_DATA } from './data/reviewsData.js';
import * as cart from './modules/cart.js';
import * as assistant from './modules/assistant.js';

function init() {
  renderProducts();
  renderTabs();
  renderCart();
  setupEventListeners();
  renderReviews();
  renderZones();
  setupAssistant();
  checkBusinessHours();
}

function renderTabs() {
  const tabsContainer = document.querySelector('.tabs');
  if (!tabsContainer) return;
  
  tabsContainer.innerHTML = '';
  MENU_CATEGORIES.forEach((cat, idx) => {
    const tab = document.createElement('button');
    tab.className = `tab ${idx === 0 ? 'active' : ''}`;
    tab.dataset.category = cat.id;
    tab.textContent = `${cat.icon} ${cat.name}`;
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      renderProducts(cat.id);
    });
    tabsContainer.appendChild(tab);
  });
}

function renderProducts(categoryId = MENU_CATEGORIES[0].id) {
  const container = document.getElementById('products-container');
  if (!container) return;
  
  const items = MENU_ITEMS.filter(item => item.categoryId === categoryId && item.available);
  container.innerHTML = '';
  
  items.forEach(item => {
    const card = document.createElement('article');
    card.className = 'product-card';
    
    const img = item.image.includes('http') ? item.image : `assets/img/${item.image}`;
    
    card.innerHTML = `
      <img src="${img}" alt="${item.name}" class="product-image" onerror="this.src='https://images.unsplash.com/photo-1565299624946-b28f40a0ae38?w=600&h=400&fit=crop'">
      <div class="product-content">
        <div class="product-header">
          <h3 class="product-name">${item.name}</h3>
          ${item.badge ? `<span class="badge">${item.badge}</span>` : ''}
        </div>
        <p class="product-desc">${item.description}</p>
        <div class="product-footer">
          <span class="product-price">${item.priceLabel}</span>
          <button class="add-btn" data-id="${item.id}">+</button>
        </div>
      </div>
    `;
    
    card.querySelector('.add-btn').addEventListener('click', () => {
      cart.addToCart(item);
      if (navigator.vibrate) navigator.vibrate(40);
    });
    
    container.appendChild(card);
  });
}

function renderCart() {
  const cartCount = document.querySelectorAll('.cart-badge');
  const dockCart = document.getElementById('dock-cart');
  const itemsContainer = document.getElementById('cart-items');
  const emptyState = document.getElementById('empty-cart');
  const subtotalEl = document.getElementById('subtotal');
  const deliveryEl = document.getElementById('delivery-fee');
  const totalEl = document.getElementById('total');
  const bottomDock = document.getElementById('bottom-dock');
  
  const count = cart.getCartCount();
  const items = cart.getCartItems();
  const subtotal = cart.getSubtotal();
  const deliveryFee = cart.getDeliveryFee();
  const total = cart.getTotal();
  
  cartCount.forEach(el => {
    el.textContent = count;
    el.style.display = count > 0 ? 'flex' : 'none';
  });
  
  if (dockCart) {
    dockCart.textContent = `Mi Pedido • ${cart.formatCurrency(total)}`;
  }
  
  if (bottomDock) {
    bottomDock.classList.toggle('hidden', count === 0);
  }
  
  if (itemsContainer) {
    itemsContainer.innerHTML = '';
    
    if (items.length === 0) {
      if (emptyState) emptyState.style.display = 'block';
      return;
    }
    
    if (emptyState) emptyState.style.display = 'none';
    
    items.forEach(it => {
      const item = it.item;
      const qty = it.quantity;
      const img = item.image.includes('http') ? item.image : `assets/img/${item.image}`;
      
      const div = document.createElement('div');
      div.className = 'cart-item';
      div.innerHTML = `
        <img src="${img}" alt="${item.name}" class="cart-item-img" onerror="this.src='https://images.unsplash.com/photo-1565299624946-b28f40a0ae38?w=200&h=200&fit=crop'">
        <div class="cart-item-info">
          <div style="display:flex; justify-content:space-between; align-items:start;">
            <h4 style="font-size:0.95rem; font-weight:600;">${item.name}</h4>
            <span style="font-weight:600; color: var(--color-terracotta);">${cart.formatCurrency(item.price * qty)}</span>
          </div>
          <div class="cart-item-controls">
            <button class="qty-btn" data-action="dec" data-id="${item.id}">−</button>
            <span class="qty">${qty}</span>
            <button class="qty-btn" data-action="inc" data-id="${item.id}">+</button>
            <button class="qty-btn" data-action="del" data-id="${item.id}" style="margin-left:auto; background:#fce8e6; color:#c5221f;">×</button>
          </div>
        </div>
      `;
      
      div.querySelectorAll('.qty-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const action = btn.dataset.action;
          const id = btn.dataset.id;
          if (action === 'inc') cart.incrementQuantity(id);
          if (action === 'dec') cart.decrementQuantity(id);
          if (action === 'del') cart.removeFromCart(id);
          if (navigator.vibrate) navigator.vibrate(30);
        });
      });
      
      itemsContainer.appendChild(div);
    });
  }
  
  if (subtotalEl) subtotalEl.textContent = cart.formatCurrency(subtotal);
  if (deliveryEl) deliveryEl.textContent = cart.formatCurrency(deliveryFee);
  if (totalEl) totalEl.textContent = cart.formatCurrency(total);
}

function setupEventListeners() {
  // Cart drawer toggle
  document.querySelectorAll('[data-cart-toggle]').forEach(btn => {
    btn.addEventListener('click', () => {
      const drawer = document.getElementById('cart-drawer');
      const overlay = document.getElementById('overlay');
      if (drawer) drawer.classList.toggle('open');
      if (overlay) overlay.classList.toggle('open');
      if (navigator.vibrate) navigator.vibrate(20);
    });
  });
  
  // Delivery type
  document.querySelectorAll('[data-delivery-type]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('[data-delivery-type]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const type = btn.dataset.deliveryType;
      cart.setDeliveryType(type);
      updateDeliveryUI();
      renderCart();
    });
  });
  
  // Zone selector
  const zoneSel = document.getElementById('zone-select');
  if (zoneSel) {
    zoneSel.addEventListener('change', () => {
      cart.setSelectedZone(zoneSel.value);
      renderCart();
    });
  }
  
  // Form inputs
  const nameInput = document.getElementById('customer-name');
  const addrInput = document.getElementById('customer-address');
  const notesInput = document.getElementById('customer-notes');
  const paymentRadios = document.querySelectorAll('input[name="payment"]');
  
  if (nameInput) {
    nameInput.addEventListener('input', () => cart.setCustomerName(nameInput.value));
  }
  if (addrInput) {
    addrInput.addEventListener('input', () => cart.setCustomerAddress(addrInput.value));
  }
  if (notesInput) {
    notesInput.addEventListener('input', () => cart.setNotes(notesInput.value));
  }
  paymentRadios.forEach(r => {
    r.addEventListener('change', () => {
      if (r.checked) cart.setPaymentMethod(r.value);
    });
  });
  
  // WhatsApp send
  const sendBtn = document.getElementById('send-whatsapp');
  if (sendBtn) {
    sendBtn.addEventListener('click', () => {
      const count = cart.getCartCount();
      if (count === 0) {
        alert('Tu carrito está vacío');
        return;
      }
      cart.sendWhatsApp();
      if (navigator.vibrate) navigator.vibrate(30);
    });
  }
  
  // Subscribe to cart updates
  cart.subscribe(() => {
    renderCart();
    updateDeliveryUI();
  });
}

function updateDeliveryUI() {
  const addrGroup = document.getElementById('address-group');
  const type = cart.getDeliveryType();
  if (addrGroup) {
    addrGroup.style.display = type === 'delivery' ? 'flex' : 'none';
  }
  
  const zoneGroup = document.getElementById('zone-group');
  if (zoneGroup) {
    zoneGroup.style.display = type === 'delivery' ? 'flex' : 'none';
  }
}

function renderReviews() {
  const container = document.getElementById('reviews-grid');
  const ratingNum = document.querySelector('.rating-number');
  
  if (ratingNum) {
    ratingNum.textContent = GOOGLE_REVIEWS_DATA.averageRating.toFixed(1);
  }
  
  if (!container) return;
  container.innerHTML = '';
  
  GOOGLE_REVIEWS_DATA.reviews.forEach(r => {
    const div = document.createElement('article');
    div.className = 'review-card';
    const stars = '★'.repeat(r.stars) + '☆'.repeat(5 - r.stars);
    div.innerHTML = `
      <div class="review-stars">${stars}</div>
      <p class="review-text">"${r.comment}"</p>
      <div class="review-author">${r.author}</div>
      <div class="review-meta">${r.location} • ${r.date}</div>
    `;
    container.appendChild(div);
  });
}

function renderZones() {
  const zoneSel = document.getElementById('zone-select');
  if (!zoneSel) return;
  
  zoneSel.innerHTML = '';
  DELIVERY_ZONES.filter(z => z.id !== 'pickup').forEach(z => {
    const opt = document.createElement('option');
    opt.value = z.id;
    opt.textContent = `${z.fee.toFixed(2).replace('.', ',')} - ${z.name}`;
    zoneSel.appendChild(opt);
  });
}

function setupAssistant() {
  const assistantBtn = document.getElementById('assistant-btn');
  const assistantClose = document.getElementById('assistant-close');
  const assistantInput = document.getElementById('assistant-input');
  const sendMsg = document.getElementById('assistant-send');
  const chips = document.querySelectorAll('.chip');
  
  if (assistantBtn) {
    assistantBtn.addEventListener('click', () => assistant.openAssistant());
  }
  if (assistantClose) {
    assistantClose.addEventListener('click', () => assistant.closeAssistant());
  }
  
  if (sendMsg) {
    sendMsg.addEventListener('click', () => {
      if (assistantInput.value.trim()) {
        assistant.sendMessage(assistantInput.value);
        assistantInput.value = '';
      }
    });
  }
  
  if (assistantInput) {
    assistantInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        if (assistantInput.value.trim()) {
          assistant.sendMessage(assistantInput.value);
          assistantInput.value = '';
        }
      }
    });
  }
  
  chips.forEach(chip => {
    chip.addEventListener('click', () => {
      assistant.sendMessage(chip.textContent);
    });
  });
  
  assistant.subscribe(({ isOpen, messages }) => {
    const modal = document.getElementById('assistant-modal');
    if (modal) {
      modal.classList.toggle('open', isOpen);
    }
    renderAssistantMessages(messages);
  });
  
  const humanBtn = document.getElementById('assistant-human');
  if (humanBtn) {
    humanBtn.addEventListener('click', () => assistant.askHuman());
  }
}

function renderAssistantMessages(messages) {
  const container = document.getElementById('assistant-messages');
  if (!container) return;
  
  container.innerHTML = '';
  messages.forEach(msg => {
    const div = document.createElement('div');
    div.className = `message ${msg.role === 'bot' ? 'msg-bot' : 'msg-user'}`;
    div.textContent = msg.content;
    container.appendChild(div);
  });
  container.scrollTop = container.scrollHeight;
}

function checkBusinessHours() {
  const statusEl = document.getElementById('status-chip');
  if (!statusEl) return;
  
  const now = new Date();
  // Hora de Venezuela (UTC-4)
  const ven = new Date(now.toLocaleString('en-US', { timeZone: 'America/Caracas' }));
  const day = ven.getDay(); // 0 Domingo, 6 Sábado
  const hours = ven.getHours();
  const mins = ven.getMinutes();
  const time = hours + mins/60;
  
  // Lunes a Domingo 6:30 AM a 10:00 PM
  if (time >= 6.5 && time <= 22) {
    statusEl.textContent = '● Abierto ahora';
    statusEl.style.background = 'var(--color-status-open-bg)';
    statusEl.style.color = 'var(--color-status-open-text)';
    statusEl.style.borderColor = 'var(--color-status-open-border)';
  } else {
    statusEl.textContent = '● Cerrado ahora';
    statusEl.style.background = 'var(--color-status-open-bg)';
    statusEl.style.color = '#666';
    statusEl.style.borderColor = '#ddd';
  }
}

document.addEventListener('DOMContentLoaded', init);
