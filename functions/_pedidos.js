// Recálculo server-side de pedidos: la base de datos es la única fuente de la
// verdad para precios, promo 2x$1, descuento de fidelidad y costo de entrega.
import { HttpError, str } from "./_db.js";

// Pastelitos tradicionales con promo 2x$1 (ahorro de $0,30 por par).
const TRAD_PRECIO = 0.65;
const TRAD_AHORRO_POR_PAR = 0.30;
const TRAD_NORM = new Set([
  "queso", "jamon & queso", "tocineta", "pepperoni", "mortadela",
]);

// Zonas de entrega (espejo de ZONAS_DELIVERY en index.html).
const ZONAS = [
  { n: "Retiro en local (Pick Up) - La Esmeralda", p: 0 },
  { n: "La Esmeralda (1 km)", p: 1.0 },
  { n: "Urb. El Morro I y II (2 km)", p: 2.0 },
  { n: "Los Jarales (3 km)", p: 3.0 },
  { n: "El Remanso / Sansur (4 km)", p: 4.0 },
  { n: "Campo Solo / Magallanes (5 km)", p: 5.0 },
  { n: "Valle Verde / Los Tulipanes (6 km)", p: 6.0 },
  { n: "Yagual / Ciudad Alianza (7 km)", p: 7.0 },
  { n: "Otra zona (consultar tarifa exacta)", p: 0, c: true },
];

const norm = (s) =>
  String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim();

const fmt = (n) => "$" + Number(n || 0).toFixed(2).replace(".", ",");

function matchProducto(map, key) {
  // Coincidencia exacta normalizada, luego sin prefijo "Pastelito "/"Panini ".
  let k = norm(key);
  if (map[k]) return map[k];
  k = k.replace(/^(pastelito|panini)\s+/, "");
  if (map[k]) return map[k];
  // "Sandwich Criollo" (BD) vs "Sándwich Criollo" (web): el NFD ya unificó tildes;
  // queda la variante "sandwich"/"sándwich" resuelta por la normalización.
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
    const q = Math.max(1, Math.min(99, parseInt(rawItems[k], 10) || 0));
    if (q > 0) pedido.push({ key: str(k, 120), q });
  }
  if (!pedido.length) throw new HttpError(400, "El pedido está vacío");

  // 1) Precios desde la BD.
  const ph = pedido.map(() => "?").join(",");
  const r = await db.execute({
    sql: `SELECT nombre, precio FROM productos WHERE nombre IN (${ph})`,
    args: pedido.map((p) => p.key.replace(/^(Pastelito|Panini)\s+/, "")),
  });
  const map = {};
  for (const row of r.rows) map[norm(row.nombre)] = { nombre: row.nombre, precio: Number(row.precio) };
  for (const p of pedido) {
    const hit = matchProducto(map, p.key);
    if (hit) {
      p.nombre = hit.nombre;
      p.u = hit.precio;
    } else {
      // Producto fuera de catálogo: se conserva como "consultar" (precio 0),
      // el administrador lo verifica al confirmar el pedido por WhatsApp.
      p.nombre = p.key;
      p.u = null;
    }
  }

  // 2) Subtotal y promo 2x$1.
  let subtotalBruto = 0, tradQty = 0, sinPrecio = false;
  for (const p of pedido) {
    if (p.u == null) { sinPrecio = true; continue; }
    subtotalBruto += p.u * p.q;
    if (TRAD_NORM.has(norm(p.nombre)) && Math.abs(p.u - TRAD_PRECIO) < 0.001) tradQty += p.q;
  }
  const tradPairs = Math.floor(tradQty / 2);
  const tradAhorro = Number((tradPairs * TRAD_AHORRO_POR_PAR).toFixed(2));
  const subtotal = Math.max(0, subtotalBruto - tradAhorro);

  // 3) Descuento de fidelidad SOLO desde la BD y SOLO con identidad verificada.
  let descPct = 0, fidelidadAhorro = 0, cliente = null;
  if (user) {
    const cr = await db.execute({
      sql: "SELECT id, email, nombre, telefono_whatsapp, porcentaje_descuento, nivel_fidelizacion FROM clientes WHERE id = ?",
      args: [String(user.sub)],
    });
    if (cr.rows.length) {
      cliente = cr.rows[0];
      descPct = Math.max(0, Math.min(100, Number(cliente.porcentaje_descuento || 0)));
      if (descPct > 0 && subtotal > 0) {
        fidelidadAhorro = Number((subtotal * (descPct / 100)).toFixed(2));
      }
    }
  }

  // 4) Entrega: la zona la dictaminan las tarifas del servidor.
  const zonaNombre = str(body.zona, 120) || ZONAS[0].n;
  const zona = ZONAS.find((z) => z.n === zonaNombre) || ZONAS[0];
  const deliveryCosto = zona.c ? 0 : zona.p;
  const subtotalFinal = Math.max(0, subtotal - fidelidadAhorro);
  const total = Number((subtotalFinal + deliveryCosto).toFixed(2));

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
  msg += "\n\nSubtotal productos: " + fmt(subtotalFinal) +
    "\nEntrega: " + zona.n + (deliveryCosto > 0 ? " (" + fmt(deliveryCosto) + ")" : "") +
    "\nTotal a pagar: " + fmt(total) + ((sinPrecio || zona.c) ? " (más consultar)" : "");
  const notas = str(body.notas, 500);
  if (notas) msg += "\n\nNotas/Dirección: " + notas;

  const pedId = "ped_" + Date.now();

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
    ],
    snapshot: {
      id: pedId,
      subtotalBruto: Number(subtotalBruto.toFixed(2)),
      tradAhorro,
      fidelidadAhorro,
      descPct,
      deliveryCosto,
      subtotalFinal,
      total,
      zonaNombre: zona.n,
      waText: msg,
    },
  };
}
