// API de Masafácil — toda la autorización y el cállo de datos ocurre aquí,
// en el servidor. El navegador nunca recibe credenciales de Turso.
import { getDb, ensureSchema, json, HttpError, readBody, str, num, rateLimit, IMG_ALLOWLIST } from "../_db.js";
import { optionalUser, requireUser, requireAdmin } from "../_auth.js";
import { buildPedido } from "../_pedidos.js";
import { acreditarTokensPedido, revertirTokensPedido, ajustarSaldoTokens } from "../_tokens.js";

const NIVELES = ["Nuevo", "Frecuente", "Plata", "Oro", "VIP"];
const ESTADOS = ["pendiente", "completado", "cancelado"];

// Auto-registro idempotente de administradores base en Turso (se ejecuta al verificar un admin).
const SEED_ADMINS = [
  ["masafacilelmaracucho@gmail.com", "Masa Fácil Maracucho"],
  ["somosvendo.ve@gmail.com", "Somos Vendo"],
];
let adminsSeeded = false;
async function seedAdmins(db) {
  if (adminsSeeded) return;
  try {
    const values = SEED_ADMINS.map(() => "(?, ?, 1)").join(", ");
    await db.execute({
      sql: "INSERT INTO administradores (email, nombre, activo) VALUES " + values + " ON CONFLICT(email) DO UPDATE SET activo = 1",
      args: SEED_ADMINS.flat(),
    });
    adminsSeeded = true;
  } catch (e) {
    // Fallback si la tabla no tiene restricción única en email: insertar solo los que falten.
    console.error("seedAdmins ON CONFLICT falló, usando fallback:", e && e.message);
    try {
      for (const [email, nombre] of SEED_ADMINS) {
        const q = await db.execute({ sql: "SELECT 1 FROM administradores WHERE lower(email) = lower(?)", args: [email] });
        if (q.rows.length) {
          await db.execute({ sql: "UPDATE administradores SET activo = 1 WHERE lower(email) = lower(?)", args: [email] });
        } else {
          await db.execute({ sql: "INSERT INTO administradores (email, nombre, activo) VALUES (?, ?, 1)", args: [email, nombre] });
        }
      }
      adminsSeeded = true;
    } catch (e2) {
      console.error("seedAdmins fallback error:", e2);
    }
  }
}

const CLIENTE_COLS =
  "id,email,nombre,avatar_url,telefono_whatsapp,total_pedidos,total_gastado,porcentaje_descuento,nivel_fidelizacion,tokens_saldo,perfil_completo";

export async function onRequest(context) {
  const { request, env, params } = context;
  const route = "/" + (params.path || []).join("/");
  const method = request.method;
  const db = getDb(env);
  await ensureSchema(db);

  try {
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

    // ---------- Cliente (Google verificado) ----------
    if (route === "/me" && method === "GET") {
      const u = await requireUser(request, env);
      let r = await db.execute({
        sql: "SELECT " + CLIENTE_COLS + " FROM clientes WHERE id = ?",
        args: [String(u.sub)],
      });
      if (!r.rows.length) {
        // Alta automática en el Club Masafácil (claims firmados por Google).
        await db.execute({
          sql: "INSERT INTO clientes (id, email, nombre, avatar_url, porcentaje_descuento, nivel_fidelizacion) VALUES (?, ?, ?, ?, 0.0, 'Nuevo')",
          args: [String(u.sub), String(u.email), str(u.name, 120) || "Cliente", str(u.picture, 300)],
        });
        r = await db.execute({
          sql: "SELECT " + CLIENTE_COLS + " FROM clientes WHERE id = ?",
          args: [String(u.sub)],
        });
      }
      const row = r.rows[0];
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
      });
    }

    // Completar perfil del Club Masafácil (nombre + WhatsApp). El correo lo
    // aporta Google ya verificado: aquí no se acepta.
    if (route === "/me/perfil" && method === "POST") {
      const u = await requireUser(request, env);
      const body = await readBody(request);
      const nombre = str(body.nombre, 120);
      const telefono = str(body.telefono, 40);
      if (!nombre) throw new HttpError(400, "Indica tu nombre");
      if (telefono.replace(/\D/g, "").length < 7) throw new HttpError(400, "Indica un teléfono de WhatsApp válido");
      await db.execute({
        sql: "UPDATE clientes SET nombre = ?, telefono_whatsapp = ?, perfil_completo = 1, updated_at = datetime('now') WHERE id = ?",
        args: [nombre, telefono, String(u.sub)],
      });
      const r = await db.execute({
        sql: "SELECT " + CLIENTE_COLS + " FROM clientes WHERE id = ?",
        args: [String(u.sub)],
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
      const ip =
        request.headers.get("CF-Connecting-IP") ||
        (request.headers.get("x-forwarded-for") || "").split(",")[0].trim() ||
        "unknown";
      const permitido = await rateLimit(db, "ped:" + ip, 10, 10 * 60 * 1000);
      if (!permitido) {
        return json({ error: "Demasiados pedidos. Intenta de nuevo en unos minutos." }, 429);
      }
      // Invitado puede pedir; si hay credencial, se valida y se aplica fidelidad.
      const u = await optionalUser(request, env);
      const body = await readBody(request);
      const pedido = await buildPedido(db, u, body);
      const stmts = [{
        sql: "INSERT INTO pedidos (id, cliente_id, nombre_cliente, email_cliente, telefono_whatsapp, items_json, subtotal, descuento_aplicado, costo_delivery, total_final, zona_entrega, notas, estado, tokens_canjeados, tokens_ganados) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pendiente', ?, ?)",
        args: pedido.args,
      }];
      // Canje inmediato de tokens (ledger + saldo) en la misma transacción del pedido.
      if (pedido.tokens && pedido.tokens.canjeados > 0 && pedido.clienteId) {
        stmts.push({
          sql: "INSERT INTO tokens_movimientos (cliente_id, pedido_id, tipo, tokens, motivo) VALUES (?, ?, 'redeem', ?, ?)",
          args: [pedido.clienteId, pedido.id, -pedido.tokens.canjeados, `Canje en pedido ${pedido.id}`],
        });
        stmts.push({
          sql: "UPDATE clientes SET tokens_saldo = MAX(0, tokens_saldo - ?), updated_at = datetime('now') WHERE id = ?",
          args: [pedido.tokens.canjeados, pedido.clienteId],
        });
      }
      await db.batch(stmts, "write");
      return json(pedido.snapshot, 201);
    }

    // ---------- Administración (admin verificado en servidor) ----------
    if (route === "/admin/me" && method === "GET") {
      const u = await requireAdmin(request, env);
      await seedAdmins(db);
      return json({ email: u.email, nombre: u.name || "", picture: u.picture || "" });
    }

    if (route === "/admin/clientes" && method === "GET") {
      await requireAdmin(request, env);
      const url = new URL(request.url);
      const sort = url.searchParams.get("sort") === "gastado" ? "total_gastado DESC" : "total_pedidos DESC";
      const r = await db.execute("SELECT " + CLIENTE_COLS + " FROM clientes ORDER BY " + sort);
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
      const r = await db.execute("SELECT * FROM pedidos ORDER BY datetime(created_at) DESC, id DESC");
      return json(r.rows);
    }

    // Venta manual
    if (route === "/admin/pedidos" && method === "POST") {
      await requireAdmin(request, env);
      const body = await readBody(request);
      const estado = ESTADOS.includes(body.estado) ? body.estado : "completado";
      const total = Math.max(0, Math.min(100000, num(body.total, 0)));
      const nombre = str(body.nombre, 120) || "Cliente";
      const tel = str(body.telefono, 40);
      const email = str(body.email, 160);
      const zona = str(body.zona, 120);
      const notas = str(body.notas, 500);
      const descTxt = str(body.items, 300);
      const items_json = JSON.stringify(descTxt ? { [descTxt]: { q: 1, u: total } } : {});

      let clienteId = null;
      if (email) {
        const q = await db.execute({ sql: "SELECT id FROM clientes WHERE lower(email) = lower(?)", args: [email] });
        if (q.rows.length) clienteId = q.rows[0].id;
      }
      const id = "man_" + Date.now();
      const stmts = [{
        sql: "INSERT INTO pedidos (id, cliente_id, nombre_cliente, email_cliente, telefono_whatsapp, items_json, subtotal, descuento_aplicado, costo_delivery, total_final, zona_entrega, notas, estado) VALUES (?,?,?,?,?,?,?,0,0,?,?,?,?)",
        args: [id, clienteId, nombre, email, tel, items_json, total, total, zona, notas, estado],
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

      const stmts = [{
        sql: "UPDATE pedidos SET estado = ?, updated_at = datetime('now') WHERE id = ?",
        args: [nuevo, id],
      }];
      if (p.cliente_id && (dCount || dSpend)) {
        stmts.push({
          sql: "UPDATE clientes SET total_pedidos = MAX(0, total_pedidos + ?), total_gastado = MAX(0, total_gastado + ?), updated_at = datetime('now') WHERE id = ?",
          args: [dCount, dSpend, p.cliente_id],
        });
      }
      await db.batch(stmts, "write");

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
      const nombre = str(body.nombre, 120) || "Cliente";
      const tel = str(body.telefono, 40);
      const email = str(body.email, 160);
      const zona = str(body.zona, 120);
      const notas = str(body.notas, 500);
      const descTxt = str(body.items, 300);
      const items_json = JSON.stringify(descTxt ? { [descTxt]: { q: 1, u: total } } : {});

      const stmts = [];
      if (p.cliente_id) {
        const oldE = p.estado || "pendiente";
        const oldT = Number(p.total_final || 0);
        let dC = 0, dS = 0;
        if (oldE !== "completado" && estado === "completado") { dC = 1; dS = total; }
        else if (oldE === "completado" && estado !== "completado") { dC = -1; dS = -oldT; }
        else if (oldE === "completado" && estado === "completado") { dS = total - oldT; }
        if (dC || dS) {
          stmts.push({
            sql: "UPDATE clientes SET total_pedidos = MAX(0, total_pedidos + ?), total_gastado = MAX(0, total_gastado + ?), updated_at = datetime('now') WHERE id = ?",
            args: [dC, dS, p.cliente_id],
          });
        }
      }
      stmts.push({
        sql: "UPDATE pedidos SET nombre_cliente=?, email_cliente=?, telefono_whatsapp=?, items_json=?, total_final=?, zona_entrega=?, notas=?, estado=?, updated_at=datetime('now') WHERE id=?",
        args: [nombre, email, tel, items_json, total, zona, notas, estado, id],
      });
      await db.batch(stmts, "write");
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
