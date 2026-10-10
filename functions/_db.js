// Capa de acceso a Turso (SOLO servidor — el token nunca llega al navegador).
import { createClient } from "@libsql/client/web";

let client = null;

export function getDb(env) {
  if (!client) {
    if (!env.TURSO_URL || !env.TURSO_AUTH_TOKEN) {
      throw new HttpError(500, "Base de datos no configurada en el servidor");
    }
    client = createClient({ url: env.TURSO_URL, authToken: env.TURSO_AUTH_TOKEN });
  }
  return client;
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
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

export async function readBody(request) {
  try {
    return await request.json();
  } catch (e) {
    throw new HttpError(400, "Cuerpo de la petición inválido");
  }
}

// Validadores comunes
export const IMG_ALLOWLIST = /^assets\/img\/[\w\-\/]+\.webp$/;

export function str(v, max = 300) {
  return String(v == null ? "" : v).slice(0, max).trim();
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
    await db.execute({
      sql:
        "INSERT INTO rate_limits (k, ws, hits) VALUES (?, ?, 1) " +
        "ON CONFLICT(k) DO UPDATE SET hits = CASE WHEN ws = excluded.ws THEN hits + 1 ELSE 1 END, ws = excluded.ws",
      args: [key, ws],
    });
    const r = await db.execute({ sql: "SELECT hits FROM rate_limits WHERE k = ?", args: [key] });
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
