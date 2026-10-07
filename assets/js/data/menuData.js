// Catálogo completo de productos · Masa Fácil · El Maracucho
export const MENU_CATEGORIES = [
  { id: 'pastelitos', name: 'Pastelitos Calientes', icon: '🥟' },
  { id: 'masas', name: 'Masas y Congelados', icon: '📦' },
  { id: 'combos', name: 'Combos para Eventos', icon: '🎉' },
  { id: 'entradas', name: 'Entradas y Fritos', icon: '🧀' },
  { id: 'paninis', name: 'Paninis Gourmet', icon: '🥖' },
  { id: 'sandwiches', name: 'Sándwich y Burger', icon: '🍔' },
  { id: 'bebidas', name: 'Cafetería y Bebidas', icon: '☕' }
];

export const MENU_ITEMS = [
  // ==================== 1. PASTELITOS ====================
  {
    id: 'past-queso',
    categoryId: 'pastelitos',
    subgroup: 'Tradicionales (2 x $1,00)',
    name: 'Pastelito de Queso',
    description: 'Relleno generoso de queso blanco llanero rallado, suave y fundente en masa crujiente.',
    price: 1.00,
    priceLabel: '2 x $1,00',
    unitQuantity: 2,
    badge: 'Más Vendido',
    image: 'pastelito_queso.webp',
    available: true
  },
  {
    id: 'past-jamon-queso',
    categoryId: 'pastelitos',
    subgroup: 'Tradicionales (2 x $1,00)',
    name: 'Pastelito de Jamón & Queso',
    description: 'El clásico favorito con jamón ahumado de primera y queso blanco.',
    price: 1.00,
    priceLabel: '2 x $1,00',
    unitQuantity: 2,
    badge: 'Popular',
    image: 'pastelito_jamon_queso.webp',
    available: true
  },
  {
    id: 'past-tocineta',
    categoryId: 'pastelitos',
    subgroup: 'Tradicionales (2 x $1,00)',
    name: 'Pastelito de Tocineta',
    description: 'Tocineta dorada combinada con queso blanco fundente.',
    price: 1.00,
    priceLabel: '2 x $1,00',
    unitQuantity: 2,
    badge: '',
    image: 'pastelito_tocineta.webp',
    available: true
  },
  {
    id: 'past-pepperoni',
    categoryId: 'pastelitos',
    subgroup: 'Tradicionales (2 x $1,00)',
    name: 'Pastelito de Pepperoni',
    description: 'Rodajas de pepperoni especiado con queso.',
    price: 1.00,
    priceLabel: '2 x $1,00',
    unitQuantity: 2,
    badge: '',
    image: 'pastelito_pepperoni.webp',
    available: true
  },
  {
    id: 'past-mortadela',
    categoryId: 'pastelitos',
    subgroup: 'Tradicionales (2 x $1,00)',
    name: 'Pastelito de Mortadela',
    description: 'Sabor tradicional con mortadela de calidad y masa doradita.',
    price: 1.00,
    priceLabel: '2 x $1,00',
    unitQuantity: 2,
    badge: '',
    image: 'pastelito_mortadela.webp',
    available: true
  },
  {
    id: 'past-pollo',
    categoryId: 'pastelitos',
    subgroup: 'Especiales ($1,10)',
    name: 'Pastelito de Pollo Mechado',
    description: 'Pollo guisado al estilo casero con aliños criollos, jugoso y sazonado.',
    price: 1.10,
    priceLabel: '$1,10',
    unitQuantity: 1,
    badge: 'Favorito',
    image: 'pastelito_pollo.webp',
    available: true
  },
  {
    id: 'past-molida',
    categoryId: 'pastelitos',
    subgroup: 'Especiales ($1,10)',
    name: 'Pastelito de Carne Molida',
    description: 'Carne de res seleccionada, guisada con pimientos, cebolla y toque de hierbas.',
    price: 1.10,
    priceLabel: '$1,10',
    unitQuantity: 1,
    badge: '',
    image: 'pastelito_molida.webp',
    available: true
  },
  {
    id: 'past-camaron',
    categoryId: 'pastelitos',
    subgroup: 'Gourmet ($1,99)',
    name: 'Pastelito de Camarón al Ajillo con Queso Crema',
    description: 'Camarones salteados al ajillo combinados con queso crema untuoso.',
    price: 1.99,
    priceLabel: '$1,99',
    unitQuantity: 1,
    badge: 'Premium',
    image: 'pastelito_camaron.webp',
    available: true
  },
  {
    id: 'past-champinon',
    categoryId: 'pastelitos',
    subgroup: 'Gourmet ($1,99)',
    name: 'Pastelito de Champiñón con Queso Crema y Tocineta',
    description: 'Champiñones salteados, tocineta crocante y un corazón de queso crema.',
    price: 1.99,
    priceLabel: '$1,99',
    unitQuantity: 1,
    badge: 'Chef Choice',
    image: 'pastelito_champinon.webp',
    available: true
  },

  // ==================== 2. MASAS Y CONGELADOS ====================
  {
    id: 'masa-12',
    categoryId: 'masas',
    subgroup: 'Discos Listos para Rellenar',
    name: 'Paquete de Masas Tradicionales (12 Discos)',
    description: 'Discos de masa artesanal Masa Fácil, con separadores plásticos.',
    price: 1.50,
    priceLabel: '$1,50',
    unitQuantity: 12,
    badge: 'Ahorro',
    image: 'paquete_masas_12.webp',
    available: true
  },
  {
    id: 'masa-24',
    categoryId: 'masas',
    subgroup: 'Discos Listos para Rellenar',
    name: 'Paquete Familiar de Masas (24 Discos)',
    description: 'Ideal para desayunos familiares o meriendas.',
    price: 2.80,
    priceLabel: '$2,80',
    unitQuantity: 24,
    badge: 'Familiar',
    image: 'paquete_masas_24.webp',
    available: true
  },
  {
    id: 'masa-50',
    categoryId: 'masas',
    subgroup: 'Discos Listos para Rellenar',
    name: 'Paquete Fiestero / Mayor (50 Discos)',
    description: 'Para negocios, cafeterías o eventos.',
    price: 5.00,
    priceLabel: '$5,00',
    unitQuantity: 50,
    badge: 'Mayorista',
    image: 'paquete_masas_50.webp',
    available: true
  },
  {
    id: 'masa-kilo',
    categoryId: 'masas',
    subgroup: 'Masa en Bloque / Kilo',
    name: 'Kilo de Masa Artesanal Lista para Estirar',
    description: 'Masa cruda refrigerada lista para cortar y moldear al gusto.',
    price: 3.50,
    priceLabel: '$3,50',
    unitQuantity: 1,
    badge: 'Artesanal',
    image: 'masa_kilo.webp',
    available: true
  },

  // ==================== 3. COMBOS PARA EVENTOS ====================
  {
    id: 'combo-fiesta-25',
    categoryId: 'combos',
    subgroup: 'Cajas de Pasapalos',
    name: 'Caja Fiesta Mini (25 unidades surtidas)',
    description: '10 mini pastelitos de queso + 15 tequeños tradicionales.',
    price: 7.00,
    priceLabel: '$7,00',
    unitQuantity: 25,
    badge: 'Reuniones',
    image: 'combopasapalos.webp',
    available: true
  },
  {
    id: 'combo-fiesta-50',
    categoryId: 'combos',
    subgroup: 'Cajas de Pasapalos',
    name: 'Caja Mega Fiesta (50 unidades surtidas)',
    description: '20 mini pastelitos surtidos + 20 tequeños de queso + 10 empanaditas.',
    price: 13.50,
    priceLabel: '$13,50',
    unitQuantity: 50,
    badge: 'Top Eventos',
    image: 'combopasapalos.webp',
    available: true
  },
  {
    id: 'combo-fiesta-100',
    categoryId: 'combos',
    subgroup: 'Cajas de Pasapalos',
    name: 'Caja Banquete Corporativo (100 unidades surtidas)',
    description: '40 mini pastelitos + 40 tequeños + 20 mini empanaditas.',
    price: 25.00,
    priceLabel: '$25,00',
    unitQuantity: 100,
    badge: 'Banquete',
    image: 'combopasapalos.webp',
    available: true
  },

  // ==================== 4. ENTRADAS Y FRITOS ====================
  {
    id: 'ent-tequenos',
    categoryId: 'entradas',
    subgroup: 'Raciones',
    name: 'Ración (6) Tequeños Tradicionales',
    description: 'Seis tequeños dorados con masa y queso blanco suave.',
    price: 1.70,
    priceLabel: '$1,70',
    unitQuantity: 6,
    badge: 'Favorito',
    image: 'tequenos.webp',
    available: true
  },
  {
    id: 'ent-tequenos-choco',
    categoryId: 'entradas',
    subgroup: 'Raciones',
    name: 'Ración (6) Tequeños de Chocolate',
    description: 'Tequeños dulces rellenos de chocolate fundido cremoso.',
    price: 2.50,
    priceLabel: '$2,50',
    unitQuantity: 6,
    badge: 'Dulce',
    image: 'tequenos_chocolate.webp',
    available: true
  },

  // ==================== 5. PANINIS GOURMET ====================
  {
    id: 'pan-italiano',
    categoryId: 'paninis',
    subgroup: 'Paninis Gourmet',
    name: 'Panini Italiano con Burrata',
    description: 'Mortadela con pistacho, pesto, burrata fresca, tomate confitado y rúcula.',
    price: 10.00,
    priceLabel: '$10,00',
    unitQuantity: 1,
    badge: 'Especialidad',
    image: 'panini_italiano.webp',
    available: true
  },

  // ==================== 6. SÁNDWICH Y BURGER ====================
  {
    id: 'sand-criollo',
    categoryId: 'sandwiches',
    subgroup: 'Sándwich Clásico',
    name: 'Sándwich Criollo',
    description: 'Pan tostado con mantequilla, queso amarillo, jamón y salchichón.',
    price: 3.50,
    priceLabel: '$3,50',
    unitQuantity: 1,
    badge: '',
    image: 'sandwich_criollo.webp',
    available: true
  },

  // ==================== 7. BEBIDAS ====================
  {
    id: 'caf-americano',
    categoryId: 'bebidas',
    subgroup: 'Cafetería Caliente',
    name: 'Café Americano',
    description: 'Café espresso recién extraído con agua caliente.',
    price: 1.10,
    priceLabel: '$1,10',
    unitQuantity: 1,
    badge: '',
    image: 'latte_art.webp',
    available: true
  },
  {
    id: 'caf-latte',
    categoryId: 'bebidas',
    subgroup: 'Cafetería Caliente',
    name: 'Café Latte',
    description: 'Espresso con abundante leche vaporizada y arte latte.',
    price: 2.00,
    priceLabel: '$2,00',
    unitQuantity: 1,
    badge: 'Popular',
    image: 'latte_art.webp',
    available: true
  }
];
