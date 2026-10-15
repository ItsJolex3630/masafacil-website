// API de Masafácil — toda la autorización y el cállo de datos ocurre aquí,
// en el servidor. El navegador nunca recibe credenciales de Turso.
import { getDb, ensureSchema, json, HttpError, readBody, str, num, rateLimit, IMG_ALLOWLIST, sanitizePlainText } from "../_db.js";
import { optionalUser, requireUser, requireAdmin, createSessionToken } from "../_auth.js";
import { buildPedido } from "../_pedidos.js";
import { acreditarTokensPedido, revertirTokensPedido, ajustarSaldoTokens } from "../_tokens.js";

const NIVELES = ["Nuevo", "Frecuente", "Plata", "Oro", "VIP"];
const ESTADOS = ["pendiente", "completado", "cancelado"];

// Helper centralizado para obtener IP del cliente (respeta CF-Connecting-IP)
function getClientIp(request) {
  return request.headers.get("CF-Connecting-IP") || "local-client";
}

// Siembra idempotente de los administradores base en Turso. La lista se lee de la
// variable de entorno segura `ADMIN_SEEDS` (no hardcodeada en el repo); solo si
// está ausente se usa un respaldo local. SOLO inserta los que faltan y NUNCA
// re-activa cuentas desactivadas (activo=0).
let adminsSeeded = false;
async function seedAdmins(db, env) {
  if (adminsSeeded) return;

  // Lista desde la variable de entorno o respaldo local.
  let adminList = [];
  if (env && env.ADMIN_SEEDS) {
    try {
      // Formato: "correo1@gmail.com:Nombre 1,correo2@gmail.com:Nombre 2"
      adminList = env.ADMIN_SEEDS.split(",").map((item) => {
        const parts = item.split(":");
        return [parts[0].trim().toLowerCase(), (parts[1] || "Administrador").trim()];
      }).filter(([email]) => email.includes("@"));
    } catch (e) {
      console.error("Error parseando env.ADMIN_SEEDS:", e);
    }
  }

  // Si no se configuró la variable de entorno, no sembrar nada y marcar completado
  if (!adminList.length) {
    adminsSeeded = true;
    return;
  }

  try {
    for (const [email, nombre] of adminList) {
      try {
        await db.execute({
          sql: "INSERT INTO administradores (email, nombre, activo) VALUES (?, ?, 1) ON CONFLICT(email) DO NOTHING",
          args: [email, nombre],
        });
      } catch (e) {
        // Fallback si la tabla no tiene restricción única en email: insertar solo los que falten.
        const q = await db.execute({ sql: "SELECT 1 FROM administradores WHERE lower(email) = lower(?)", args: [email] });
        if (!q.rows.length) {
          await db.execute({ sql: "INSERT INTO administradores (email, nombre, activo) VALUES (?, ?, 1)", args: [email, nombre] });
        }
      }
    }
    adminsSeeded = true;
  } catch (e) {
    console.error("seedAdmins fallback:", e && e.message);
  }
}

const CLIENTE_COLS =
  "id,email,nombre,avatar_url,telefono_whatsapp,total_pedidos,total_gastado,porcentaje_descuento,nivel_fidelizacion,tokens_saldo,perfil_completo,carrito_json";

// Saneamiento del carrito del cliente: solo pares llave->{q,u} válidos, con
// cantidades enteras 1-99 y un máximo de 100 productos. Nunca confía en el
// navegador: normaliza la forma antigua (llave->qty) a la nueva (llave->{q,u}).
function sanitizeCarrito(raw) {
  const out = {};
  if (!raw || typeof raw !== "object") return out;
  const keys = Object.keys(raw).slice(0, 100);
  for (const k of keys) {
    const key = str(k, 120);
    if (!key) continue;
    const v = raw[k];
    let q = 0;
    let u = null;
    if (v && typeof v === "object") {
      q = Math.min(99, Math.max(0, Math.floor(num(v.q, 0))));
      if (v.u != null) {
        const n = Number(v.u);
        u = Number.isFinite(n) ? Math.max(0, Math.min(10000, n)) : null;
      }
    } else {
      q = Math.min(99, Math.max(0, Math.floor(num(v, 0))));
    }
    if (q >= 1) out[key] = { q: q, u: u };
  }
  return out;
}

function parseCarrito(carritoJson) {
  try {
    return carritoJson ? sanitizeCarrito(JSON.parse(carritoJson)) : {};
  } catch (e) {
    return {};
  }
}

export async function onRequest(context) {
  const { request, env, params } = context;
  const route = "/" + (params.path || []).join("/");
  const method = request.method;
  const db = getDb(env);
  await ensureSchema(db);

  try {
    // Siembra los administradores base ANTES de cualquier verificación:
    // si dependiera de requireAdmin, un correo nuevo nunca llegaría a la tabla.
    await seedAdmins(db, env);

    // ---------- Público ----------
    if (route === "/health" && method === "GET") {
      return json({ ok: true, ts: Date.now() });
    }

    if (route === "/productos" && method === "GET") {
      const r = await db.execute(
        "SELECT id,categoria,subgrupo,nombre,descripcion,precio,promo_tag,imagen_url,disponible,orden FROM productos ORDER BY categoria, orden, nombre"
      );
      return json(r.rows);
    }

    // ---------- Cliente (Google verificado o sesión autorizada) ----------
    if (route === "/me" && method === "GET") {
      const u = await requireUser(request, env);
      const email = String(u.email || "").toLowerCase().trim();
      const sub = String(u.sub || ("usr:" + email));
      const name = str(u.name || u.given_name || u.nombre, 120) || "Cliente";
      const picture = str(u.picture || u.avatar || u.avatar_url, 300) || "";

      if (!email) throw new HttpError(400, "El token no contiene un correo válido");

      // Buscar si el cliente ya existe por id (Google sub) O por su correo electrónico
      let r = await db.execute({
        sql: "SELECT " + CLIENTE_COLS + " FROM clientes WHERE id = ? OR lower(email) = ? LIMIT 1",
        args: [sub, email],
      });

      if (!r.rows.length) {
        // Alta automática en el Club Masafácil (claims verificados por Google o token interno)
        await db.execute({
          sql: "INSERT INTO clientes (id, email, nombre, avatar_url, porcentaje_descuento, nivel_fidelizacion, tokens_saldo, total_pedidos, total_gastado, perfil_completo) VALUES (?, ?, ?, ?, 0.0, 'Nuevo', 0, 0, 0, 0)",
          args: [sub, email, name, picture],
        });
        r = await db.execute({
          sql: "SELECT " + CLIENTE_COLS + " FROM clientes WHERE id = ? OR lower(email) = ? LIMIT 1",
          args: [sub, email],
        });
      } else {
        // Si ya existe: actualizar id (por si era provisional o de admin), avatar y nombre si no estaba personalizado
        const existing = r.rows[0];
        const updatedName = (!existing.nombre || existing.nombre === "Cliente" || existing.nombre === "Administrador") ? name : existing.nombre;
        const updatedAvatar = picture || existing.avatar_url || "";
        await db.execute({
          sql: "UPDATE clientes SET id = ?, nombre = ?, avatar_url = ?, updated_at = datetime('now') WHERE id = ? OR lower(email) = ?",
          args: [sub, updatedName, updatedAvatar, existing.id, email],
        });
        r = await db.execute({
          sql: "SELECT " + CLIENTE_COLS + " FROM clientes WHERE id = ? OR lower(email) = ? LIMIT 1",
          args: [sub, email],
        });
      }

      const row = r.rows[0];
      // Sesión de 30 días emitida por el servidor: reemplaza al ID Token de
      // Google (vida ~1h) en localStorage y evita cierres prematuros de sesión.
      const sessionToken = await createSessionToken({ sub, email, name, picture, role: "cliente" }, env);
      return json({
        id: row.id,
        email: row.email,
        nombre: row.nombre,
        avatar: row.avatar_url,
        telefono: row.telefono_whatsapp,
        porcentaje_descuento: Number(row.porcentaje_descuento || 0),
        nivel_fidelizacion: row.nivel_fidelizacion || "Nuevo",
        total_pedidos: Number(row.total_pedidos || 0),
        tokens_saldo: Number(row.tokens_saldo || 0),
        perfil_completo: Number(row.perfil_completo || 0),
        carrito: parseCarrito(row.carrito_json),
        session_token: sessionToken,
      });
    }

    // Persistencia del carrito del cliente en Turso (asociado a su cuenta).
    // El carrito solo se vacía desde el frontend al pulsar "Pedir por WhatsApp".
    if (route === "/me/carrito" && method === "PUT") {
      const u = await requireUser(request, env);
      const email = String(u.email || "").toLowerCase().trim();
      const sub = String(u.sub || ("usr:" + email));
      if (!email) throw new HttpError(400, "El token no contiene un correo válido");
      const body = await readBody(request);
      const items = sanitizeCarrito(body && body.items);
      await db.execute({
        sql: "UPDATE clientes SET carrito_json = ?, updated_at = datetime('now') WHERE id = ? OR lower(email) = ?",
        args: [JSON.stringify(items), sub, email],
      });
      return json({ ok: true });
    }

    // Completar perfil del Club Masafácil (nombre + WhatsApp). El correo lo
    // aporta Google ya verificado: aquí no se acepta.
    if (route === "/me/perfil" && method === "POST") {
      const u = await requireUser(request, env);
      const email = String(u.email || "").toLowerCase().trim();
      const sub = String(u.sub || ("usr:" + email));
      const ip = getClientIp(request);
      const permitido = await rateLimit(db, "perfil:" + ip, 15, 5 * 60 * 1000);
      if (!permitido) {
        return json({ error: "Demasiadas solicitudes de actualización. Intenta de nuevo en unos minutos." }, 429);
      }
      const body = await readBody(request);
      const nombre = sanitizePlainText(body.nombre, 120);
      const telefono = str(body.telefono, 40);
      if (!nombre) throw new HttpError(400, "Indica tu nombre");
      if (telefono.replace(/\D/g, "").length < 7) throw new HttpError(400, "Indica un teléfono de WhatsApp válido");
      await db.execute({
        sql: "UPDATE clientes SET nombre = ?, telefono_whatsapp = ?, perfil_completo = 1, updated_at = datetime('now') WHERE id = ? OR lower(email) = ?",
        args: [nombre, telefono, sub, email],
      });
      const r = await db.execute({
        sql: "SELECT " + CLIENTE_COLS + " FROM clientes WHERE id = ? OR lower(email) = ? LIMIT 1",
        args: [sub, email],
      });
      const row = r.rows[0] || {};
      return json({
        ok: true,
        cliente: {
          id: row.id,
          email: row.email,
          nombre: row.nombre,
          avatar: row.avatar_url,
          telefono: row.telefono_whatsapp,
          porcentaje_descuento: Number(row.porcentaje_descuento || 0),
          nivel_fidelizacion: row.nivel_fidelizacion || "Nuevo",
          total_pedidos: Number(row.total_pedidos || 0),
          tokens_saldo: Number(row.tokens_saldo || 0),
          perfil_completo: Number(row.perfil_completo || 0),
        },
      });
    }

    if (route === "/pedidos" && method === "POST") {
      const ip = getClientIp(request);
      const permitido = await rateLimit(db, "ped:" + ip, 10, 10 * 60 * 1000);
      if (!permitido) {
        return json({ error: "Demasiados pedidos. Intenta de nuevo en unos minutos." }, 429);
      }
      // Invitado puede pedir; si hay credencial, se valida y se aplica fidelidad.
      const u = await optionalUser(request, env);
      const body = await readBody(request);
      const pedido = await buildPedido(db, u, body);
      const stmts = [{
        sql: "INSERT INTO pedidos (id, cliente_id, nombre_cliente, email_cliente, telefono_whatsapp, items_json, subtotal, descuento_aplicado, costo_delivery, total_final, zona_entrega, notas, metodo_pago, estado, tokens_canjeados, tokens_ganados) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pendiente', ?, ?)",
        args: pedido.args,
      }];
      // Canje inmediato de tokens (ledger + saldo) en la misma transacción del pedido.
      // Anti-TOCTOU: actualización atómica con condición tokens_saldo >= cantidad a canjear.
      if (pedido.tokens && pedido.tokens.canjeados > 0 && pedido.clienteId) {
        const deduct = await db.execute({
          sql: "UPDATE clientes SET tokens_saldo = tokens_saldo - ?, updated_at = datetime('now') WHERE id = ? AND tokens_saldo >= ?",
          args: [pedido.tokens.canjeados, pedido.clienteId, pedido.tokens.canjeados],
        });
        if (!deduct.rowsAffected) {
          throw new HttpError(409, "Saldo de tokens insuficiente o modificado por otra operación.");
        }
        stmts.push({
          sql: "INSERT INTO tokens_movimientos (cliente_id, pedido_id, tipo, tokens, motivo) VALUES (?, ?, 'redeem', ?, ?)",
          args: [pedido.clienteId, pedido.id, -pedido.tokens.canjeados, `Canje en pedido ${pedido.id}`],
        });
      }
      // El pedido consumió el carrito del cliente registrado: se vacía en la
      // misma transacción para que nunca queden artículos ya pedidos.
      if (u && u.email) {
        const rEmail = String(u.email).toLowerCase().trim();
        const rSub = String(u.sub || ("usr:" + rEmail));
        stmts.push({
          sql: "UPDATE clientes SET carrito_json = '{}', updated_at = datetime('now') WHERE id = ? OR lower(email) = ?",
          args: [rSub, rEmail],
        });
      }
      await db.batch(stmts, "write");
      return json(pedido.snapshot, 201);
    }

    // ---------- Endpoint de Login Universal para Administradores ----------
    if (route === "/admin/login" && method === "POST") {
      const ip = getClientIp(request);
      // Limitar a máximo 5 intentos por minuto para prevenir ataques de fuerza bruta
      const okRate = await rateLimit(db, "login_adm:" + ip, 5, 60 * 1000);
      if (!okRate) {
        return json({ error: "Demasiados intentos de acceso. Espera un minuto." }, 429);
      }

      const body = await readBody(request);
      const email = str(body.email, 120).trim().toLowerCase();
      const pin = str(body.pin, 50).trim();

      if (!email || !email.includes("@")) {
        return json({ error: "Introduce un correo válido." }, 400);
      }
      if (!pin) {
        return json({ error: "Introduce el PIN de administrador." }, 400);
      }

      // PIN maestro de administradores: configurable en env.ADMIN_ACCESS_PIN
      // Valor por defecto estándar si no está configurada la variable en Cloudflare:
      const adminPinMaster = env.ADMIN_ACCESS_PIN || "240996";

      if (pin !== adminPinMaster) {
        return json({ error: "PIN de administrador incorrecto." }, 401);
      }

      // Validar si el correo existe en la tabla de administradores de Turso
      const r = await db.execute({
        sql: "SELECT email, nombre, activo FROM administradores WHERE lower(email) = ?",
        args: [email]
      });

      if (!r.rows.length || Number(r.rows[0].activo) !== 1) {
        return json({ error: "El correo " + email + " no está registrado o está inactivo como administrador." }, 403);
      }

      const adminUser = r.rows[0];
      const { createAdminToken } = await import("../_auth.js");
      const token = await createAdminToken(adminUser.email, adminUser.nombre, env);

      // Asegurar que el administrador esté registrado en la tabla de clientes
      try {
        const sub = "admin:" + email;
        const rCli = await db.execute({
          sql: "SELECT id FROM clientes WHERE id = ? OR lower(email) = ? LIMIT 1",
          args: [sub, email]
        });
        if (!rCli.rows.length) {
          await db.execute({
            sql: "INSERT INTO clientes (id, email, nombre, avatar_url, porcentaje_descuento, nivel_fidelizacion, tokens_saldo, total_pedidos, total_gastado, perfil_completo) VALUES (?, ?, ?, '', 0.0, 'Admin', 0, 0, 0, 1)",
            args: [sub, email, adminUser.nombre || "Administrador"]
          });
        }
      } catch (eSync) {
        console.warn("No se pudo registrar admin en clientes:", eSync && eSync.message);
      }

      return json({
        ok: true,
        token,
        email: adminUser.email,
        nombre: adminUser.nombre
      });
    }

    // ---------- Administración (admin verificado en servidor) ----------
    // Rate limiting para rutas administrativas (anti-fuerza bruta)
    if (route.startsWith("/admin/")) {
      const ip = getClientIp(request);
      const okAdminRate = await rateLimit(db, "adm:" + ip, 60, 60 * 1000);
      if (!okAdminRate) return json({ error: "Demasiadas peticiones administrativas." }, 429);
    }

    if (route === "/admin/me" && method === "GET") {
      const u = await requireAdmin(request, env);
      const email = String(u.email || "").toLowerCase().trim();
      const sub = String(u.sub || ("admin:" + email));
      const name = str(u.name || u.nombre, 120) || "Administrador";
      const picture = str(u.picture || u.avatar_url, 300) || "";

      // Asegurar que el usuario autenticado como admin esté registrado en clientes
      try {
        const rCli = await db.execute({
          sql: "SELECT id FROM clientes WHERE id = ? OR lower(email) = ? LIMIT 1",
          args: [sub, email]
        });
        if (!rCli.rows.length) {
          await db.execute({
            sql: "INSERT INTO clientes (id, email, nombre, avatar_url, porcentaje_descuento, nivel_fidelizacion, tokens_saldo, total_pedidos, total_gastado, perfil_completo) VALUES (?, ?, ?, ?, 0.0, 'Admin', 0, 0, 0, 1)",
            args: [sub, email, name, picture]
          });
        } else if (picture) {
          await db.execute({
            sql: "UPDATE clientes SET avatar_url = CASE WHEN (avatar_url IS NULL OR avatar_url = '') THEN ? ELSE avatar_url END, updated_at = datetime('now') WHERE id = ? OR lower(email) = ?",
            args: [picture, rCli.rows[0].id, email]
          });
        }
      } catch (eSync) {
        console.warn("No se pudo sincronizar admin en clientes:", eSync && eSync.message);
      }

      // Sesión de administrador de 30 días emitida por el servidor.
      const sessionToken = await createSessionToken({ sub, email, name, picture, role: "admin" }, env);
      return json({ email: u.email, nombre: u.name || "", picture: u.picture || "", session_token: sessionToken });
    }

    if (route === "/admin/clientes" && method === "GET") {
      await requireAdmin(request, env);
      const url = new URL(request.url);
      const sort = url.searchParams.get("sort") === "gastado" ? "total_gastado DESC" : "total_pedidos DESC";
      const r = await db.execute("SELECT " + CLIENTE_COLS + " FROM clientes ORDER BY " + sort + " LIMIT 500");
      return json(r.rows);
    }

    const mCli = route.match(/^\/admin\/clientes\/(.+)$/);
    if (mCli && method === "PUT") {
      const admin = await requireAdmin(request, env);
      const body = await readBody(request);
      const id = str(mCli[1], 80);
      const pct = Math.max(0, Math.min(100, num(body.porcentaje_descuento, 0)));
      const niv = NIVELES.includes(body.nivel_fidelizacion) ? body.nivel_fidelizacion : "Nuevo";
      const sets = ["porcentaje_descuento = ?", "nivel_fidelizacion = ?", "updated_at = datetime('now')"];
      const args = [pct, niv];
      if (body.total_gastado !== undefined) {
        sets.push("total_gastado = ?");
        args.push(Math.max(0, Math.min(1000000, num(body.total_gastado, 0))));
      }
      if (body.total_pedidos !== undefined) {
        sets.push("total_pedidos = ?");
        args.push(Math.max(0, Math.min(100000, Math.round(num(body.total_pedidos, 0)))));
      }
      args.push(id);
      await db.execute({
        sql: "UPDATE clientes SET " + sets.join(", ") + " WHERE id = ?",
        args,
      });
      // Ajuste manual del saldo de tokens con registro en el libro mayor.
      if (body.tokens_saldo !== undefined) {
        const cur = await db.execute({ sql: "SELECT tokens_saldo FROM clientes WHERE id = ?", args: [id] });
        const actual = cur.rows.length ? Number(cur.rows[0].tokens_saldo || 0) : 0;
        await ajustarSaldoTokens(db, id, num(body.tokens_saldo, actual), actual, admin.email);
      }
      return json({ ok: true });
    }

    if (route === "/admin/productos" && method === "GET") {
      await requireAdmin(request, env);
      const r = await db.execute(
        "SELECT id,categoria,subgrupo,nombre,descripcion,precio,promo_tag,imagen_url,disponible,orden FROM productos ORDER BY categoria, orden, nombre"
      );
      return json(r.rows);
    }

    const mProd = route.match(/^\/admin\/productos\/(.+)$/);
    if (mProd && method === "PUT") {
      await requireAdmin(request, env);
      const body = await readBody(request);
      const rawPrecio = num(body.precio, -1);
      if (rawPrecio < 0 || rawPrecio > 10000) throw new HttpError(400, "Precio inválido");
      const precio = Number(rawPrecio.toFixed(2));
      const disp = body.disponible ? 1 : 0;
      const tag = str(body.promo_tag, 40);
      const img = str(body.imagen_url, 300);
      if (img && !IMG_ALLOWLIST.test(img)) {
        throw new HttpError(400, "Ruta de imagen inválida (debe ser assets/img/… .webp)");
      }
      const desc = str(body.descripcion, 500);
      await db.execute({
        sql: "UPDATE productos SET precio = ?, disponible = ?, promo_tag = ?, imagen_url = ?, descripcion = ?, updated_at = datetime('now') WHERE id = ?",
        args: [precio, disp, tag, img, desc, str(mProd[1], 80)],
      });
      return json({ ok: true });
    }

    if (route === "/admin/pedidos" && method === "GET") {
      await requireAdmin(request, env);
      const r = await db.execute("SELECT * FROM pedidos ORDER BY datetime(created_at) DESC, id DESC LIMIT 500");
      return json(r.rows);
    }

    // Venta manual
    if (route === "/admin/pedidos" && method === "POST") {
      await requireAdmin(request, env);
      const body = await readBody(request);
      const estado = ESTADOS.includes(body.estado) ? body.estado : "completado";
      const total = Math.max(0, Math.min(100000, num(body.total, 0)));
      const nombre = sanitizePlainText(body.nombre, 120) || "Cliente";
      const tel = str(body.telefono, 40);
      const email = str(body.email, 160);
      const zona = sanitizePlainText(body.zona, 120);
      const notas = sanitizePlainText(body.notas, 500);
      const metodo_pago = str(body.metodo_pago, 40);
      const descTxt = sanitizePlainText(body.items, 300);
      const items_json = JSON.stringify(descTxt ? { [descTxt]: { q: 1, u: total } } : {});

      let clienteId = null;
      if (email) {
        const q = await db.execute({ sql: "SELECT id FROM clientes WHERE lower(email) = lower(?)", args: [email] });
        if (q.rows.length) clienteId = q.rows[0].id;
      }
      const id = "man_" + crypto.randomUUID();
      const stmts = [{
        sql: "INSERT INTO pedidos (id, cliente_id, nombre_cliente, email_cliente, telefono_whatsapp, items_json, subtotal, descuento_aplicado, costo_delivery, total_final, zona_entrega, notas, metodo_pago, estado) VALUES (?,?,?,?,?,?,?,0,0,?,?,?,?,?)",
        args: [id, clienteId, nombre, email, tel, items_json, total, total, zona, notas, metodo_pago, estado],
      }];
      if (clienteId && estado === "completado") {
        stmts.push({
          sql: "UPDATE clientes SET total_pedidos = total_pedidos + 1, total_gastado = total_gastado + ?, updated_at = datetime('now') WHERE id = ?",
          args: [total, clienteId],
        });
      }
      await db.batch(stmts, "write");
      return json({ ok: true, id }, 201);
    }

    const mPed = route.match(/^\/admin\/pedidos\/([^/]+)(\/estado)?$/);

    if (mPed && mPed[2] && method === "POST") {
      // Cambio de estado con recálculo atómico de métricas del cliente.
      await requireAdmin(request, env);
      const body = await readBody(request);
      const nuevo = str(body.estado, 20);
      if (!ESTADOS.includes(nuevo)) throw new HttpError(400, "Estado inválido");
      const id = str(mPed[1], 80);

      const pr = await db.execute({ sql: "SELECT * FROM pedidos WHERE id = ?", args: [id] });
      if (!pr.rows.length) throw new HttpError(404, "Pedido no encontrado");
      const p = pr.rows[0];
      const old = p.estado || "pendiente";
      if (old === nuevo) return json({ ok: true });

      let dCount = 0, dSpend = 0;
      if (old !== "completado" && nuevo === "completado") { dCount = 1; dSpend = Number(p.total_final || 0); }
      else if (old === "completado" && nuevo !== "completado") { dCount = -1; dSpend = -Number(p.total_final || 0); }

      // Corrección Falla 2: Ejecución atómica y única del cambio de estado
      const upd = await db.execute({
        sql: "UPDATE pedidos SET estado = ?, updated_at = datetime('now') WHERE id = ? AND COALESCE(estado, 'pendiente') = ?",
        args: [nuevo, id, old],
      });
      if (!upd.rowsAffected) {
        throw new HttpError(409, "El estado del pedido ya fue modificado por otra solicitud.");
      }

      const stmts = [];
      if (p.cliente_id && (dCount || dSpend)) {
        stmts.push({
          sql: "UPDATE clientes SET total_pedidos = MAX(0, total_pedidos + ?), total_gastado = MAX(0, total_gastado + ?), updated_at = datetime('now') WHERE id = ?",
          args: [dCount, dSpend, p.cliente_id],
        });
      }
      if (stmts.length) await db.batch(stmts, "write");

      // Fidelización por tokens: acreditar al completar, revertir al descompletar.
      let tokensAcreditados = 0;
      if (old !== "completado" && nuevo === "completado") {
        tokensAcreditados = await acreditarTokensPedido(db, p);
      } else if (old === "completado" && nuevo !== "completado") {
        await revertirTokensPedido(db, p);
      }
      return json({ ok: true, tokensAcreditados });
    }

    if (mPed && !mPed[2] && method === "PUT") {
      // Edición de venta con ajuste diferencial de métricas.
      await requireAdmin(request, env);
      const body = await readBody(request);
      const id = str(mPed[1], 80);
      const pr = await db.execute({ sql: "SELECT * FROM pedidos WHERE id = ?", args: [id] });
      if (!pr.rows.length) throw new HttpError(404, "Pedido no encontrado");
      const p = pr.rows[0];

      const estado = ESTADOS.includes(body.estado) ? body.estado : "pendiente";
      const total = Math.max(0, Math.min(100000, num(body.total, 0)));
      const nombre = sanitizePlainText(body.nombre, 120) || "Cliente";
      const tel = str(body.telefono, 40);
      const email = str(body.email, 160);
      const zona = sanitizePlainText(body.zona, 120);
      const notas = sanitizePlainText(body.notas, 500);
      const metodo_pago = str(body.metodo_pago, 40);
      const descTxt = sanitizePlainText(body.items, 300);
      const items_json = JSON.stringify(descTxt ? { [descTxt]: { q: 1, u: total } } : {});

      // Corrección Falla 1: Declarar oldE en el ámbito de la función antes del batch
      const oldE = p.estado || "pendiente";
      const oldT = Number(p.total_final || 0);
      let dC = 0, dS = 0;
      if (oldE !== "completado" && estado === "completado") { dC = 1; dS = total; }
      else if (oldE === "completado" && estado !== "completado") { dC = -1; dS = -oldT; }
      else if (oldE === "completado" && estado === "completado") { dS = total - oldT; }

      const stmts = [];
      if (p.cliente_id && (dC || dS)) {
        stmts.push({
          sql: "UPDATE clientes SET total_pedidos = MAX(0, total_pedidos + ?), total_gastado = MAX(0, total_gastado + ?), updated_at = datetime('now') WHERE id = ?",
          args: [dC, dS, p.cliente_id],
        });
      }
      stmts.push({
        sql: "UPDATE pedidos SET nombre_cliente=?, email_cliente=?, telefono_whatsapp=?, items_json=?, total_final=?, zona_entrega=?, notas=?, metodo_pago=?, estado=?, updated_at=datetime('now') WHERE id=?",
        args: [nombre, email, tel, items_json, total, zona, notas, metodo_pago, estado, id],
      });
      await db.batch(stmts, "write");
      if (p.cliente_id) {
        if (oldE !== "completado" && estado === "completado") await acreditarTokensPedido(db, p);
        else if (oldE === "completado" && estado !== "completado") await revertirTokensPedido(db, p);
      }
      return json({ ok: true });
    }

    if (mPed && !mPed[2] && method === "DELETE") {
      await requireAdmin(request, env);
      const id = str(mPed[1], 80);
      const pr = await db.execute({ sql: "SELECT * FROM pedidos WHERE id = ?", args: [id] });
      if (!pr.rows.length) throw new HttpError(404, "Pedido no encontrado");
      const p = pr.rows[0];
      const stmts = [];
      if ((p.estado || "pendiente") === "completado" && p.cliente_id) {
        stmts.push({
          sql: "UPDATE clientes SET total_pedidos = MAX(0, total_pedidos - 1), total_gastado = MAX(0, total_gastado - ?), updated_at = datetime('now') WHERE id = ?",
          args: [Number(p.total_final || 0), p.cliente_id],
        });
      }
      stmts.push({ sql: "DELETE FROM pedidos WHERE id = ?", args: [id] });
      await db.batch(stmts, "write");
      // Si el pedido estaba completado, revertir su efecto en el saldo de tokens.
      if ((p.estado || "pendiente") === "completado") {
        await revertirTokensPedido(db, p);
      }
      return json({ ok: true });
    }

    throw new HttpError(404, "Ruta no encontrada");
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message }, e.status);
    console.error("API error:", route, e);
    return json({ error: "Error interno del servidor" }, 500);
  }
}
