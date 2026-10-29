// Capa de acceso a Turso (SOLO servidor — el token nunca llega al navegador).
import { createClient } from "@libsql/client/web";

let client = null;

export function getDb(env) {
  if (!client) {
    const url = env.TURSO_URL || env.TURSO_DATABASE_URL;
    const authToken = env.TURSO_AUTH_TOKEN || env.TURSO_TOKEN;
    if (!url || !authToken) {
      throw new HttpError(500, "Base de datos no configurada en el servidor");
    }
    client = createClient({ url, authToken });
  }
  return client;
}

// Solo crea tablas e índices si faltan (CREATE IF NOT EXISTS, sin ALTER).
// El esquema de Turso ya está en su versión final; correr ALTER en cada cold
// start adquiría bloqueos DDL y saturaba la base (quota/latencia).
let schemaReady = false;
export async function ensureSchema(db) {
  if (schemaReady) return;

  // Tabla de productos del menú
  try {
    await db.execute(`
      CREATE TABLE IF NOT EXISTS productos (
        id TEXT PRIMARY KEY,
        categoria TEXT NOT NULL,
        subgrupo TEXT,
        nombre TEXT NOT NULL,
        descripcion TEXT,
        precio REAL NOT NULL,
        promo_tag TEXT,
        imagen_url TEXT,
        disponible INTEGER DEFAULT 1,
        orden INTEGER DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT
      )
    `);
    await db.execute("CREATE INDEX IF NOT EXISTS idx_productos_cat_orden ON productos(categoria, orden)");
  } catch (e) {
    console.error("ensureSchema productos:", e && e.message);
  }

  // Tabla de administradores: fuente de verdad dinámica del panel. Se crea aquí
  // para que requireAdmin nunca falle con 500 si la tabla no existe todavía.
  try {
    await db.execute(`
      CREATE TABLE IF NOT EXISTS administradores (
        email TEXT PRIMARY KEY COLLATE NOCASE,
        nombre TEXT,
        activo INTEGER DEFAULT 1,
        created_at TEXT DEFAULT (datetime('now'))
      )
    `);
  } catch (e) {
    console.error("ensureSchema administradores:", e && e.message);
  }
  // Libro mayor de tokens (auditoría). Cada transición de estado escribe una fila:
  // 'earn' (acredita al completar), 'redeem' (canje al pedir), 'reversa' (revierte),
  // 'bonus' (reintegro), 'ajuste' (corrección manual del administrador).
  try {
    await db.execute(`
      CREATE TABLE IF NOT EXISTS tokens_movimientos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        cliente_id TEXT NOT NULL,
        pedido_id TEXT,
        tipo TEXT NOT NULL,
        tokens INTEGER NOT NULL,
        motivo TEXT,
        admin_email TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      )
    `);
    await db.execute(
      "CREATE INDEX IF NOT EXISTS idx_tokens_cliente ON tokens_movimientos(cliente_id, created_at)"
    );
  } catch (e) {
    console.error("ensureSchema tokens_movimientos:", e && e.message);
  }
  schemaReady = true;
}

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store, no-cache, must-revalidate",
    },
  });
}

export async function readBody(request, maxBytes = 65536) {
  const len = Number(request.headers.get("content-length") || 0);
  if (len > maxBytes) {
    throw new HttpError(413, "Cuerpo de la petición demasiado grande");
  }
  try {
    const raw = await request.text();
    if (raw.length > maxBytes) throw new Error("Payload too large");
    return JSON.parse(raw);
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(400, "Cuerpo de la petición inválido");
  }
}

// Validadores comunes (permite rutas relativas de assets, webp/png/jpg/svg y cache-busters ?v=...)
export const IMG_ALLOWLIST = /^(\/?assets\/img\/[\w\-\/\.]+\.(webp|png|jpg|jpeg|svg)(\?[\w\=\&\.\-]*)?)$/i;

export function str(v, max = 300) {
  if (v == null) return "";
  // Elimina caracteres nulos y de control no imprimibles (conserva \t \n \r).
  const cleaned = String(v)
    .replace(/\0/g, "")
    .replace(/[\u0001-\u0008\u000B-\u001F\u007F]/g, "")
    .trim();
  return cleaned.slice(0, max);
}

// Saneamiento de campos de texto abierto (notas, nombres, zona): elimina
// caracteres de control y neutraliza etiquetas HTML directas antes de guardar.
export function sanitizePlainText(v, max = 500) {
  if (v == null) return "";
  return str(v, max).replace(/[<>]/g, "");
}

export function num(v, def = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

// ---------- Limitador de tasa (ventana fija) ----------
let rateReady = false;
async function ensureRateTable(db) {
  if (rateReady) return;
  await db.execute(
    "CREATE TABLE IF NOT EXISTS rate_limits (k TEXT PRIMARY KEY, ws INTEGER NOT NULL, hits INTEGER NOT NULL)"
  );
  rateReady = true;
}

// Devuelve true si la petición está permitida. Falla "abierto" (permite) ante
// errores de BD para no bloquear pedidos legítimos por un fallo del limitador.
export async function rateLimit(db, key, limit, windowMs) {
  try {
    await ensureRateTable(db);
    const ws = Math.floor(Date.now() / windowMs) * windowMs;
    const r = await db.execute({
      sql:
        "INSERT INTO rate_limits (k, ws, hits) VALUES (?, ?, 1) " +
        "ON CONFLICT(k) DO UPDATE SET hits = CASE WHEN ws = excluded.ws THEN hits + 1 ELSE 1 END, ws = excluded.ws RETURNING hits",
      args: [key, ws],
    });
    const hits = Number(r.rows[0] ? r.rows[0].hits : 1);
    if (Math.random() < 0.02) {
      db.execute({ sql: "DELETE FROM rate_limits WHERE ws < ?", args: [ws - windowMs * 10] }).catch(() => {});
    }
    return hits <= limit;
  } catch (e) {
    console.error("rateLimit error:", e);
    return true;
  }
}
