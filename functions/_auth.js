// Verificación de credenciales Google Identity Services (JWT firmado).
// La firma se valida con las claves públicas de Google; el cliente solo envía
// el credential como Bearer token. Nadie puede fabricarse una identidad.
// También soporta tokens de sesión administrativos firmados con HS256 (servidor).
import { createRemoteJWKSet, jwtVerify, SignJWT } from "jose";
import { HttpError } from "./_db.js";

const JWKS = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));

function getSecretKey(env) {
  // Clave secreta para firmar sesiones locales de administrador
  const secret = env.ADMIN_SECRET_KEY || env.TURSO_AUTH_TOKEN || "masafacil-secret-key-fallback-2026";
  return new TextEncoder().encode(secret);
}

function extractToken(request) {
  const h = request.headers.get("Authorization") || "";
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}

// Genera un token de sesión para el administrador autenticado por PIN
export async function createAdminToken(email, nombre, env) {
  const secret = getSecretKey(env);
  const jwt = await new SignJWT({
    sub: "admin:" + email,
    email: email.toLowerCase().trim(),
    name: nombre || "Administrador",
    role: "admin",
    iss: "masafacil-auth"
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d") // 7 días de sesión persistente
    .sign(secret);
  return jwt;
}

async function verify(request, env) {
  const token = extractToken(request);
  if (!token) return null;

  // 1. Probar si es un token de sesión emitido por Masafácil (HS256)
  try {
    const secret = getSecretKey(env);
    const { payload } = await jwtVerify(token, secret, {
      issuer: "masafacil-auth"
    });
    if (payload && payload.email) return payload;
  } catch (_) {
    // Si falla, probar como token de Google (RS256)
  }

  // 2. Probar si es un token JWT de Google
  const googleClientId = env.GOOGLE_CLIENT_ID || "589629831378-quob4rn9tsrakbic150m4soedkek4tvk.apps.googleusercontent.com";
  try {
    const { payload } = await jwtVerify(token, JWKS, {
      audience: googleClientId,
      issuer: ["https://accounts.google.com", "accounts.google.com"],
    });
    const verified = payload.email_verified === true || payload.email_verified === "true" || payload.email_verified == 1;
    if (payload.sub && payload.email && verified) {
      return payload;
    }
  } catch (errGoogle) {
    console.warn("Fallo al validar token de Google:", errGoogle && errGoogle.message);
  }

  throw new HttpError(401, "Credencial de acceso inválida o expirada");
}

export async function optionalUser(request, env) {
  if (!extractToken(request)) return null;
  return verify(request, env);
}

export async function requireUser(request, env) {
  const payload = await verify(request, env);
  if (!payload) throw new HttpError(401, "Inicia sesión para continuar");
  return payload;
}

// Administrador: identidad verificada + correo autorizado. La tabla `administradores`
// de Turso es la ÚNICA fuente de verdad de autorización (sin listas blancas
// hardcodeadas en el código que puedan eludir la desactivación de una cuenta).
export async function requireAdmin(request, env) {
  const payload = await verify(request, env);
  if (!payload || !payload.email) throw new HttpError(401, "Inicia sesión para continuar");

  const userEmail = String(payload.email).trim().toLowerCase();

  const { getDb } = await import("./_db.js");
  const db = getDb(env);
  const r = await db.execute({
    sql: "SELECT 1 AS ok FROM administradores WHERE lower(email) = ? AND activo = 1",
    args: [userEmail],
  });
  if (!r.rows.length) {
    throw new HttpError(403, "Acceso restringido: la cuenta " + userEmail + " no tiene permisos de administrador");
  }
  return payload;
}