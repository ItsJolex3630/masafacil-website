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
