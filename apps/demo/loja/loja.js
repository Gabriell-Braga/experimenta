// Comportamento da loja de demonstração. Imita um site real: conteúdo carregado depois (API),
// re-render ao trocar de aba, carrossel, contagem regressiva que muda o DOM a cada segundo, modais e gaveta.

const PRODUCTS = [
  {
    id: 1,
    cat: 'corrida',
    name: 'Runner X Nuvem 2',
    price: 599.9,
    old: 749.9,
    badge: '-20%',
    rating: 4.8,
    colors: ['#2563eb', '#1e3a8a'],
  },
  {
    id: 2,
    cat: 'corrida',
    name: 'Trail Grip Pro',
    price: 689.9,
    badge: 'Novo',
    rating: 4.6,
    colors: ['#16a34a', '#14532d'],
  },
  {
    id: 3,
    cat: 'casual',
    name: 'Urban Flex',
    price: 399.9,
    old: 459.9,
    badge: '-13%',
    rating: 4.4,
    colors: ['#f97316', '#9a3412'],
  },
  {
    id: 4,
    cat: 'corrida',
    name: 'Maratona Elite',
    price: 999.9,
    rating: 4.9,
    colors: ['#e11d48', '#881337'],
  },
  { id: 5, cat: 'casual', name: 'Skate Classic', price: 299.9, rating: 4.2, colors: ['#111827', '#6b7280'] },
  {
    id: 6,
    cat: 'acessorios',
    name: 'Meia Compressão (3 pares)',
    price: 89.9,
    old: 119.9,
    badge: '-25%',
    rating: 4.7,
    colors: ['#7c3aed', '#4c1d95'],
  },
  {
    id: 7,
    cat: 'acessorios',
    name: 'Garrafa Térmica 750 ml',
    price: 129.9,
    rating: 4.5,
    colors: ['#0891b2', '#164e63'],
  },
  {
    id: 8,
    cat: 'corrida',
    name: 'Runner Kids',
    price: 249.9,
    badge: 'Novo',
    rating: 4.3,
    colors: ['#facc15', '#a16207'],
  },
];

const brl = (n) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const STAR =
  "<svg class='star' width='14' height='14' viewBox='0 0 24 24' fill='currentColor' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round' aria-hidden='true'><path d='M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z'/></svg>";
/** Estrelas da nota (ícones SVG; as apagadas usam a classe star--off). */
const stars = (r) =>
  Array.from({ length: 5 }, (_, i) =>
    i < Math.round(r) ? STAR : STAR.replace("class='star'", "class='star star--off'"),
  ).join('');
/** "Foto" do produto: SVG gerado (sem depender de imagens externas). */
const productImage = ([a, b], label) =>
  `data:image/svg+xml;utf8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><defs><linearGradient id="g" x1="0" x2="1" y1="0" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs><rect width="400" height="300" fill="#f3f4f6"/><ellipse cx="200" cy="230" rx="140" ry="18" fill="#00000014"/><path d="M70 200c40-6 70-40 110-70 20-15 40-10 55 5 20 20 45 35 95 40 15 2 20 22 5 28-40 14-200 18-260 10-18-3-20-11-5-13z" fill="url(#g)"/><text x="200" y="60" font-family="sans-serif" font-size="18" text-anchor="middle" fill="#9ca3af">${label}</text></svg>`,
  )}`;

// ---------- Contagem regressiva ----------
const end = Date.now() + 1000 * 60 * 60 * 26;
const countdown = document.getElementById('countdown');
const tick = () => {
  const s = Math.max(0, Math.floor((end - Date.now()) / 1000));
  const p = (n) => String(n).padStart(2, '0');
  countdown.textContent = `${p(Math.floor(s / 3600))}:${p(Math.floor((s % 3600) / 60))}:${p(s % 60)}`;
};
tick();
setInterval(tick, 1000);

// ---------- Mega menu ----------
document.querySelectorAll('.mainnav__item--mega').forEach((item) => {
  const btn = item.querySelector('button');
  const set = (open) => {
    item.classList.toggle('is-open', open);
    btn.setAttribute('aria-expanded', String(open));
  };
  item.addEventListener('mouseenter', () => set(true));
  item.addEventListener('mouseleave', () => set(false));
  btn.addEventListener('click', () => set(!item.classList.contains('is-open')));
});

// ---------- Carrossel ----------
const slides = [...document.querySelectorAll('.hero__slide')];
const dots = document.getElementById('hero-dots');
let current = 0;
let timer;
const show = (i) => {
  current = (i + slides.length) % slides.length;
  slides.forEach((s, j) => s.classList.toggle('is-active', j === current));
  [...dots.children].forEach((d, j) => d.setAttribute('aria-selected', String(j === current)));
};
slides.forEach((_, i) => {
  const d = document.createElement('button');
  d.className = 'hero__dot';
  d.setAttribute('role', 'tab');
  d.setAttribute('aria-label', `Destaque ${i + 1}`);
  d.addEventListener('click', () => {
    show(i);
    restart();
  });
  dots.append(d);
});
const restart = () => {
  clearInterval(timer);
  timer = setInterval(() => show(current + 1), 5000);
};
show(0);
restart();
document.querySelector('.hero').addEventListener('mouseenter', () => clearInterval(timer));
document.querySelector('.hero').addEventListener('mouseleave', restart);

// ---------- Produtos (carregados depois, re-renderizados por aba) ----------
const grid = document.getElementById('product-grid');
let category = 'todos';

function card(p) {
  // Mistura de classes estáveis (BEM) e geradas (estilo CSS Modules) como em sites reais.
  return `
    <article class="product-card pc_x7a2f_3" data-product-id="${p.id}">
      <div class="product-card__media">
        ${p.badge ? `<span class="product-card__badge ${p.badge === 'Novo' ? 'is-new' : ''}">${p.badge}</span>` : ''}
        <img src="${productImage(p.colors, p.name)}" alt="${p.name}" loading="lazy" width="400" height="300" />
        <button class="product-card__quick" data-quick="${p.id}">Ver rápido</button>
      </div>
      <div class="product-card__body">
        <h3 class="product-card__title">${p.name}</h3>
        <p class="product-card__rating" aria-label="Nota ${p.rating}">${stars(p.rating)} <span>${p.rating}</span></p>
        <p class="product-card__price">${p.old ? `<s>${brl(p.old)}</s>` : ''}<b>${brl(p.price)}</b></p>
        <p class="product-card__install">ou 10x de ${brl(p.price / 10)}</p>
        <button class="btn btn--primary btn--block product-card__add" data-add="${p.id}">Adicionar</button>
      </div>
    </article>`;
}

function render() {
  const list = PRODUCTS.filter((p) => category === 'todos' || p.cat === category);
  grid.innerHTML = list.map(card).join('');
  grid.setAttribute('aria-busy', 'false');
}

setTimeout(render, 700);

document.getElementById('category-tabs').addEventListener('click', (e) => {
  const tab = e.target.closest('[data-cat]');
  if (!tab) return;
  category = tab.dataset.cat;
  document.querySelectorAll('.tabs__tab').forEach((t) => t.classList.toggle('is-active', t === tab));
  grid.setAttribute('aria-busy', 'true');
  setTimeout(render, 250); // re-render: nós novos (o editor e o snippet precisam reaplicar)
});

// ---------- Carrinho ----------
const cart = new Map();
const drawer = document.getElementById('cart-drawer');
const openCart = () => (drawer.hidden = false);
const closeCart = () => (drawer.hidden = true);
function renderCart() {
  let total = 0;
  let count = 0;
  document.getElementById('cart-items').innerHTML =
    [...cart.values()]
      .map(({ p, qty }) => {
        total += p.price * qty;
        count += qty;
        return `<li class="drawer__item"><img src="${productImage(p.colors, '')}" alt="" /><span>${p.name}<small>${qty} × ${brl(p.price)}</small></span></li>`;
      })
      .join('') || '<li class="drawer__empty">Seu carrinho está vazio.</li>';
  document.getElementById('cart-total').textContent = brl(total);
  document.getElementById('cart-count').textContent = String(count);
}
function add(id) {
  const p = PRODUCTS.find((x) => x.id === Number(id));
  const item = cart.get(p.id) ?? { p, qty: 0 };
  item.qty++;
  cart.set(p.id, item);
  renderCart();
  openCart();
}
renderCart();
document.getElementById('cart-open').addEventListener('click', openCart);
drawer.addEventListener('click', (e) => e.target.closest('[data-close-cart]') && closeCart());

// ---------- Ver rápido ----------
const modal = document.getElementById('quick-view');
let qvId = null;
grid.addEventListener('click', (e) => {
  const addBtn = e.target.closest('[data-add]');
  if (addBtn) return add(addBtn.dataset.add);
  const quick = e.target.closest('[data-quick]');
  if (!quick) return;
  const p = PRODUCTS.find((x) => x.id === Number(quick.dataset.quick));
  qvId = p.id;
  document.getElementById('qv-title').textContent = p.name;
  document.getElementById('qv-price').innerHTML =
    `${p.old ? `<s>${brl(p.old)}</s> ` : ''}<b>${brl(p.price)}</b>`;
  document.getElementById('qv-desc').textContent = `Nota ${p.rating} de 5 · ${p.cat}. Envio em 24 h.`;
  document.getElementById('qv-img').style.backgroundImage = `url("${productImage(p.colors, '')}")`;
  document.getElementById('qv-sizes').innerHTML = [37, 38, 39, 40, 41, 42, 43]
    .map((n) => `<button>${n}</button>`)
    .join('');
  modal.hidden = false;
});
modal.addEventListener('click', (e) => e.target.closest('[data-close]') && (modal.hidden = true));
document.getElementById('qv-add').addEventListener('click', () => {
  modal.hidden = true;
  add(qvId);
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    modal.hidden = true;
    closeCart();
  }
});

// ---------- Newsletter ----------
document.getElementById('newsletter-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const email = e.currentTarget.email.value.trim();
  const msg = document.getElementById('newsletter-msg');
  const ok = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email);
  msg.textContent = ok ? 'Cupom PRIMEIRA10 enviado para o seu e-mail!' : 'Digite um e-mail válido.';
  msg.className = `newsletter__msg ${ok ? 'is-ok' : 'is-error'}`;
});
