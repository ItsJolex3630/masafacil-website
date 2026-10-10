// Verificación de credenciales Google Identity Services (JWT firmado).
// La firma se valida con las claves públicas de Google; el cliente solo envía
// el credential como Bearer token. Nadie puede fabricarse una identidad.
import { createRemoteJWKSet, jwtVerify } from "jose";
import { HttpError } from "./_db.js";

const JWKS = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));

function extractToken(request) {
  const h = request.headers.get("Authorization") || "";
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}

async function verify(request, env) {
  const token = extractToken(request);
  if (!token) return null;
  if (!env.GOOGLE_CLIENT_ID) {
    throw new HttpError(500, "GOOGLE_CLIENT_ID no configurado en el servidor");
  }
  try {
    const { payload } = await jwtVerify(token, JWKS, {
      audience: env.GOOGLE_CLIENT_ID,
      issuer: ["https://accounts.google.com", "accounts.google.com"],
    });
    if (!payload.sub || !payload.email) return null;
    return payload;
  } catch (e) {
    throw new HttpError(401, "Credencial de Google inválida o expirada");
  }
}

// Identidad opcional: sin header → null (invitado); header inválido → 401.
export async function optionalUser(request, env) {
  if (!extractToken(request)) return null;
  return verify(request, env);
}

// Identidad obligatoria (área de cliente logueado).
export async function requireUser(request, env) {
  const payload = await verify(request, env);
  if (!payload) throw new HttpError(401, "Inicia sesión con Google para continuar");
  return payload;
}

// Administrador: identidad verificada + correo autorizado en la tabla administradores.
export async function requireAdmin(request, env) {
  const payload = await verify(request, env);
  if (!payload) throw new HttpError(401, "Inicia sesión con Google para continuar");
  const { getDb } = await import("./_db.js");
  const db = getDb(env);
  const r = await db.execute({
    sql: "SELECT 1 AS ok FROM administradores WHERE lower(email) = lower(?) AND activo = 1",
    args: [String(payload.email)],
  });
  if (!r.rows.length) throw new HttpError(403, "Acceso restringido: no eres administrador");
  return payload;
}
