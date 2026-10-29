// Recálculo server-side de pedidos: la base de datos es la única fuente de la
// verdad para precios, promo 2x$1, descuento de fidelidad y costo de entrega.
import { HttpError, str, num, sanitizePlainText } from "./_db.js";
import { calcularTokensGanados, calcularMaxTokensCanjeables, tokensADolares } from "./_tokens.js";

// Pastelitos tradicionales con promo 2x$1 (ahorro de $0,30 por par).
const TRAD_PRECIO = 0.65;
const TRAD_AHORRO_POR_PAR = 0.30;
const TRAD_NORM = new Set([
  "queso", "jamon & queso", "tocineta", "pepperoni", "mortadela", "pizza",
]);

const PRODUCTOS_NUEVOS = {
  "pizza": { nombre: "Pizza", precio: 0.65 },
  "racion (3) tequenos de chocolate": { nombre: "Ración (3) Tequeños de Chocolate", precio: 1.5 },
  "racion (3) queso con guayaba": { nombre: "Ración (3) Queso con Guayaba", precio: 1.5 },
  "racion (3) platano con queso": { nombre: "Ración (3) Plátano con Queso", precio: 1.5 },
  "racion tenders con papas": { nombre: "Ración Tenders con papas", precio: 4.5 },
  "extra papas fritas (para burger)": { nombre: "Extra Papas Fritas (para Burger)", precio: 1.0 },
  "masas de pastelitos (discos) 950g": { nombre: "Masas de Pastelitos (Discos) 950g", precio: 2.5 },
  "masas al mayor (+12 und)": { nombre: "Masas al Mayor (+12 und)", precio: 1.1 },
};

// Sabores permitidos para bebidas con selector de variante
const SABORES_PERMITIDOS = new Set([
  "manzana", "pera", "naranja", "durazno", "limon", "frescolita", "chinotto", "fanta", "colita", "uva"
]);

// Zonas de entrega (espejo de ZONAS_DELIVERY en index.html).
const ZONAS = [
  { n: "Retiro en local (Pick Up) - La Esmeralda", p: 0 },
  { n: "La Esmeralda", p: 1.0 },
  { n: "El Morro", p: 1.5 },
  { n: "Valle Verde", p: 1.5 },
  { n: "El Remanso", p: 2.0 },
  { n: "El Pueblo de San Diego ($2 - $3)", p: 2.0, c: true },
  { n: "Los Tulipanes", p: 3.0 },
  { n: "Big Low", p: 3.0 },
  { n: "Campo Solo / Los Jarales", p: 3.0 },
  { n: "Valle Topacio y Paso Real", p: 3.0 },
  { n: "Las Morochas", p: 4.0 },
  { n: "Lomas de la Hacienda", p: 4.0 },
  { n: "Cumaca", p: 4.0 },
  { n: "Valencia (desde $5 según zona)", p: 5.0, c: true },
  { n: "Otra zona (consultar tarifa exacta)", p: 0, c: true },
];

const norm = (s) =>
  String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim();

const ALIAS_NOMBRES = {
  "cafe latte": "latte",
  "nestea limon": "nestea",
  "sandwich criollo": "sandwich criollo",
  "sandwich diet": "sandwich diet",
};

// Extrae { catHint, base, sabor } a partir de la llave enviada por el carrito.
function parseCartKey(rawKey) {
  const parts = String(rawKey || "").split(" · ");
  const left = parts[0].trim();
  const sabor = parts.length > 1 ? parts.slice(1).join(" · ").trim() : "";

  let catHint = null;
  let base = left;
  if (/^Pastelito\s+/i.test(left)) {
    catHint = "Pastelitos";
    base = left.replace(/^Pastelito\s+/i, "").trim();
  } else if (/^Panini\s+/i.test(left)) {
    catHint = "Paninis";
    base = left.replace(/^Panini\s+/i, "").trim();
  } else if (sabor) {
    catHint = "Bebidas";
  }
  return { catHint, base, sabor };
}

const fmt = (n) => "$" + Number(n || 0).toFixed(2).replace(".", ",");

function findProductInCatalog(byCatAndName, byName, parsed) {
  const baseNorm = ALIAS_NOMBRES[norm(parsed.base)] || norm(parsed.base);
  const inverseNorm = baseNorm === "latte" ? "cafe latte" : baseNorm === "nestea" ? "nestea limon" : baseNorm;
  if (parsed.catHint) {
    for (const candidate of [baseNorm, inverseNorm]) {
      const catKey = norm(parsed.catHint) + "|" + candidate;
      if (byCatAndName.has(catKey)) return byCatAndName.get(catKey);
    }
  }
  if (byName.has(baseNorm)) return byName.get(baseNorm);
  if (byName.has(inverseNorm)) return byName.get(inverseNorm);
  const fallbackKey = PRODUCTOS_NUEVOS[baseNorm] ? baseNorm : (PRODUCTOS_NUEVOS[inverseNorm] ? inverseNorm : null);
  if (fallbackKey) {
    return {
      categoria: parsed.catHint || "",
      nombre: PRODUCTOS_NUEVOS[fallbackKey].nombre,
      precio: Number(PRODUCTOS_NUEVOS[fallbackKey].precio),
      promo_tag: fallbackKey === "pizza" ? "2x$1" : "",
      disponible: 1,
    };
  }
  return null;
}

/**
 * Construye un pedido recalculado. `user` es el JWT verificado de Google o null.
 * Devuelve { id, args } listo para INSERT, más el snapshot para el cliente.
 */
export async function buildPedido(db, user, body) {
  const rawItems = body && body.items && typeof body.items === "object" ? body.items : {};
  const nombres = Object.keys(rawItems).slice(0, 60);
  if (!nombres.length) throw new HttpError(400, "El pedido está vacío");

  // Cantidades saneadas (enteras 1-99; se ignoran entradas basura).
  const pedido = [];
  for (const k of nombres) {
    const n = parseInt(rawItems[k], 10);
    const q = Number.isFinite(n) ? Math.min(99, n) : 0;
    if (q >= 1) {
      const key = sanitizePlainText(k, 120);
      const parsed = parseCartKey(key);
      pedido.push({ key, parsed, base: parsed.base, q });
    }
  }
  if (!pedido.length) throw new HttpError(400, "El pedido está vacío");

  // 1) Precios y disponibilidad desde la BD completa (evita colisiones entre Pastelito Pollo y Panini Pollo).
  const r = await db.execute(
    "SELECT categoria, nombre, precio, promo_tag, disponible FROM productos"
  );
  const byCatAndName = new Map();
  const byName = new Map();
  for (const row of r.rows) {
    const item = {
      categoria: row.categoria || "",
      nombre: row.nombre,
      precio: Number(row.precio),
      promo_tag: String(row.promo_tag || "").trim(),
      disponible: row.disponible != null ? Number(row.disponible) : 1,
    };
    const cKey = norm(item.categoria) + "|" + norm(item.nombre);
    byCatAndName.set(cKey, item);
    if (!byName.has(norm(item.nombre))) {
      byName.set(norm(item.nombre), item);
    }
  }

  for (const p of pedido) {
    const hit = findProductInCatalog(byCatAndName, byName, p.parsed);
    if (!hit) {
      throw new HttpError(400, `El producto "${p.base}" no existe en el catálogo oficial`);
    }
    if (Number(hit.disponible) === 0) {
      throw new HttpError(400, `El producto "${hit.nombre}" está agotado actualmente`);
    }
    const prefix = norm(hit.categoria) === "pastelitos"
      ? "Pastelito "
      : norm(hit.categoria) === "paninis"
      ? "Panini "
      : "";
    if (p.parsed.sabor) {
      const saborLimpio = sanitizePlainText(p.parsed.sabor, 25);
      if (!SABORES_PERMITIDOS.has(norm(saborLimpio))) {
        throw new HttpError(400, `Variante o sabor no válido para ${hit.nombre}`);
      }
      p.nombre = `${prefix}${hit.nombre} · ${saborLimpio}`;
    } else {
      p.nombre = `${prefix}${hit.nombre}`;
    }
    p.u = hit.precio;
    p.isPromo2x1 =
      norm(hit.categoria) === "pastelitos" &&
      norm(hit.promo_tag) === "2x$1";
  }

  // 2) Subtotal y promo 2x$1 dinámica según el precio y etiqueta actual en BD.
  let subtotalBruto = 0, sinPrecio = false;
  const promoUnits = [];
  for (const p of pedido) {
    if (p.u == null) { sinPrecio = true; continue; }
    subtotalBruto += p.u * p.q;
    if (p.isPromo2x1 && p.u > 0.5) {
      for (let i = 0; i < p.q; i++) promoUnits.push(p.u);
    }
  }
  const tradQty = promoUnits.length;
  const tradPairs = Math.floor(promoUnits.length / 2);
  let tradAhorroRaw = 0;
  for (let i = 0; i < tradPairs * 2; i += 2) {
    const pairSum = promoUnits[i] + promoUnits[i + 1];
    if (pairSum > 1.0) tradAhorroRaw += (pairSum - 1.0);
  }
  const tradAhorro = Number(tradAhorroRaw.toFixed(2));
  const subtotal = Math.max(0, Number((subtotalBruto - tradAhorro).toFixed(2)));

  // 3) Descuento de fidelidad SOLO desde la BD y SOLO con identidad verificada.
  let descPct = 0, fidelidadAhorro = 0, cliente = null;
  if (user) {
    const userEmail = String(user.email || "").toLowerCase().trim();
    const userSub = String(user.sub || "");
    const cr = await db.execute({
      sql: "SELECT id, email, nombre, telefono_whatsapp, porcentaje_descuento, nivel_fidelizacion, tokens_saldo FROM clientes WHERE id = ? OR lower(email) = ? LIMIT 1",
      args: [userSub, userEmail],
    });
    if (cr.rows.length) {
      cliente = cr.rows[0];
      descPct = Math.max(0, Math.min(100, Number(cliente.porcentaje_descuento || 0)));
      if (descPct > 0 && subtotal > 0) {
        fidelidadAhorro = Number((subtotal * (descPct / 100)).toFixed(2));
      }
    }
  }

  // 3.1) Canje de tokens (Club Masafácil). El servidor es la única fuente de verdad:
  // nunca confía en el descuento enviado por el navegador, solo en el saldo real de Turso.
  let tokensCanjeados = 0, tokensGanados = 0, descuentoTokens = 0, saldoTokensCliente = 0;
  if (cliente) {
    saldoTokensCliente = Math.max(0, Math.floor(Number(cliente.tokens_saldo || 0)));
    tokensGanados = calcularTokensGanados(subtotal, cliente.nivel_fidelizacion || "Nuevo");
    const solicitados = Math.max(0, Math.floor(num(body.tokens_a_usar, 0)));
    if (solicitados > 0) {
      const maxCanje = calcularMaxTokensCanjeables(saldoTokensCliente, subtotal);
      tokensCanjeados = Math.min(solicitados, maxCanje);
      descuentoTokens = tokensADolares(tokensCanjeados);
    }
  }

  // 4) Entrega: la zona la dictaminan las tarifas del servidor.
  const zonaNombre = sanitizePlainText(body.zona, 120) || ZONAS[0].n;
  const zona = ZONAS.find((z) => z.n === zonaNombre) || ZONAS[0];
  const deliveryCosto = Number(zona.p || 0);
  const subtotalFinal = Math.max(0, subtotal - fidelidadAhorro - descuentoTokens);
  const total = Number((subtotalFinal + deliveryCosto).toFixed(2));

  // Método de pago elegido en el carrito (Efectivo, Pago Móvil, Punto de venta, Zelle, Binance).
  const metodosPago = ["Efectivo", "Pago Móvil", "Punto de venta", "Zelle", "Binance"];
  const pagoRaw = str(body.pago, 40);
  const pago = metodosPago.includes(pagoRaw) ? pagoRaw : "Efectivo";

  const items_json = JSON.stringify(
    Object.fromEntries(pedido.map((p) => [p.nombre, { q: p.q, u: p.u }]))
  );

  // 5) Mensaje de WhatsApp generado en el servidor (integridad del texto enviado).
  let msg = "Hola Masafácil, quiero hacer un pedido:\n\n";
  if (cliente) {
    msg += "⭐ *Cliente Club Masafácil:* " + cliente.nombre + "\n";
    msg += "✉️ *Correo:* " + cliente.email + "\n";
    msg += "🏅 *Nivel:* " + (cliente.nivel_fidelizacion || "Nuevo") + "\n";
    if (descPct > 0) msg += "🏷️ *Beneficio VIP:* " + descPct + "% de descuento aplicado\n";
    msg += "------------------------------------\n\n";
  }
  msg += pedido
    .map((p) => "• " + p.q + " x " + p.nombre + (p.u == null ? " (consultar precio)" : " - " + fmt(p.u * p.q)))
    .join("\n");
  if (tradAhorro > 0) msg += "\n\n🎉 Ahorro Promo Tradicionales (2x$1 en " + tradQty + " piezas): -" + fmt(tradAhorro);
  if (fidelidadAhorro > 0) msg += "\n⭐ *Descuento Fidelidad (" + descPct + "%):* -" + fmt(fidelidadAhorro);
  if (cliente && (tokensCanjeados > 0 || tokensGanados > 0)) {
    msg += "\n\n🪙 Tokens Club Masafácil:";
    if (tokensCanjeados > 0) msg += "\n- Tokens canjeados: " + tokensCanjeados + " (-" + fmt(descuentoTokens) + ")";
    if (tokensGanados > 0) msg += "\n- Tokens que acumulará este pedido: +" + tokensGanados;
  }
  msg += "\n\nSubtotal productos: " + fmt(subtotalFinal) +
    "\nEntrega: " + zona.n + (deliveryCosto > 0 ? " (" + fmt(deliveryCosto) + ")" : "") +
    "\nTotal a pagar: " + fmt(total) + ((sinPrecio || zona.c) ? " (más consultar)" : "") +
    "\nMétodo de pago: " + pago;
  const notas = sanitizePlainText(body.notas, 500);
  if (notas) msg += "\n\nNotas/Dirección: " + notas;

  const pedId = "ped_" + crypto.randomUUID();

  return {
    id: pedId,
    clienteId: cliente ? cliente.id : null,
    nombreCliente: cliente ? cliente.nombre : "Invitado",
    emailCliente: cliente ? cliente.email : "",
    args: [
      pedId,
      cliente ? cliente.id : null,
      cliente ? cliente.nombre : "Invitado",
      cliente ? cliente.email : "",
      cliente && cliente.telefono_whatsapp ? cliente.telefono_whatsapp : "",
      items_json,
      Number(subtotalBruto.toFixed(2)),
      Number((tradAhorro + fidelidadAhorro).toFixed(2)),
      deliveryCosto,
      total,
      zona.n,
      notas,
      pago,
      tokensCanjeados,
      tokensGanados,
    ],
    tokens: {
      canjeados: tokensCanjeados,
      ganados: tokensGanados,
      descuento: descuentoTokens,
      saldoCliente: saldoTokensCliente,
      saldoRestante: Math.max(0, saldoTokensCliente - tokensCanjeados),
    },
    snapshot: {
      id: pedId,
      subtotalBruto: Number(subtotalBruto.toFixed(2)),
      tradAhorro,
      fidelidadAhorro,
      descPct,
      descuentoTokens,
      tokensCanjeados,
      tokensGanados,
      saldoTokens: Math.max(0, saldoTokensCliente - tokensCanjeados),
      deliveryCosto,
      subtotalFinal,
      total,
      zonaNombre: zona.n,
      metodo_pago: pago,
      waText: msg,
    },
  };
}
