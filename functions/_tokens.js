// Reglas de negocio del Club Masafácil (fidelización por tokens).
// El canje es "no instantáneo": los tokens se acreditan SOLO cuando el pedido
// pasa a estado 'completado' por un administrador (ledger en tokens_movimientos).

export const VALOR_TOKEN_USD = 0.001; // 100 tokens = $0,10
export const MINIMO_SUBTOTAL_CANJE = 5.0; // mínimo $5 de subtotal para poder canjear
export const TOPE_DESCUENTO_PCT = 25.0; // máximo 25% del subtotal en descuento por tokens

// Tokens ganados por cada $1 gastado según el nivel del cliente.
export const TOKENS_POR_DOLAR = {
  Nuevo: 100,
  Frecuente: 120,
  Plata: 140,
  Oro: 160,
  VIP: 180,
};

export function obtenerTokensPorDolar(nivel) {
  return TOKENS_POR_DOLAR[nivel] || TOKENS_POR_DOLAR.Nuevo;
}

export function calcularTokensGanados(subtotalComida, nivel) {
  const tasa = obtenerTokensPorDolar(nivel);
  return Math.floor(Math.max(0, Number(subtotalComida) || 0) * tasa);
}

// Máximo de tokens canjeables: nunca más que el saldo, ni más que el 25% del subtotal.
export function calcularMaxTokensCanjeables(saldoCliente, subtotalComida) {
  const saldo = Math.max(0, Math.floor(Number(saldoCliente) || 0));
  const subtotal = Math.max(0, Number(subtotalComida) || 0);
  if (subtotal < MINIMO_SUBTOTAL_CANJE || saldo <= 0) return 0;
  const maxDescuentoUSD = subtotal * (TOPE_DESCUENTO_PCT / 100);
  const maxTokensPorTope = Math.floor(maxDescuentoUSD / VALOR_TOKEN_USD);
  return Math.min(saldo, maxTokensPorTope);
}

// Convierte tokens a dólares redondeando a centavos.
export function tokensADolares(tokens) {
  return Number((Math.max(0, Math.floor(Number(tokens) || 0)) * VALOR_TOKEN_USD).toFixed(2));
}

async function insertMovimiento(db, clienteId, pedidoId, tipo, tokens, motivo, adminEmail) {
  await db.execute({
    sql: "INSERT INTO tokens_movimientos (cliente_id, pedido_id, tipo, tokens, motivo, admin_email) VALUES (?, ?, ?, ?, ?, ?)",
    args: [String(clienteId), pedidoId == null ? null : String(pedidoId), tipo, tokens, motivo || null, adminEmail || null],
  });
}

// Acredita los tokens ganados cuando un pedido se marca como 'completado'.
export async function acreditarTokensPedido(db, pedido) {
  const ganados = Math.floor(Number(pedido && pedido.tokens_ganados) || 0);
  if (!pedido || !pedido.cliente_id || ganados <= 0) return 0;
  try {
    await insertMovimiento(db, pedido.cliente_id, pedido.id, "earn", ganados, `Tokens ganados en pedido ${pedido.id}`);
    await db.execute({
      sql: "UPDATE clientes SET tokens_saldo = tokens_saldo + ?, updated_at = datetime('now') WHERE id = ?",
      args: [ganados, pedido.cliente_id],
    });
    return ganados;
  } catch (e) {
    console.error("acreditarTokensPedido:", e && e.message);
    return 0;
  }
}

// Revierte el efecto de un pedido que dejó de estar 'completado': quita los
// tokens ganados y reintegra los que se canjearon en ese pedido.
export async function revertirTokensPedido(db, pedido) {
  if (!pedido || !pedido.cliente_id) return;
  const ganados = Math.floor(Number(pedido.tokens_ganados) || 0);
  const canjeados = Math.floor(Number(pedido.tokens_canjeados) || 0);
  try {
    if (ganados > 0) {
      await insertMovimiento(db, pedido.cliente_id, pedido.id, "reversa", -ganados, `Reversa pedido ${pedido.id}`);
      await db.execute({
        sql: "UPDATE clientes SET tokens_saldo = MAX(0, tokens_saldo - ?), updated_at = datetime('now') WHERE id = ?",
        args: [ganados, pedido.cliente_id],
      });
    }
    if (canjeados > 0) {
      await insertMovimiento(db, pedido.cliente_id, pedido.id, "bonus", canjeados, `Reintegro por cancelación ${pedido.id}`);
      await db.execute({
        sql: "UPDATE clientes SET tokens_saldo = tokens_saldo + ?, updated_at = datetime('now') WHERE id = ?",
        args: [canjeados, pedido.cliente_id],
      });
    }
  } catch (e) {
    console.error("revertirTokensPedido:", e && e.message);
  }
}

// Ajuste manual del administrador: fija el saldo exacto y registra la diferencia.
export async function ajustarSaldoTokens(db, clienteId, nuevoSaldo, saldoActual, adminEmail) {
  const destino = Math.max(0, Math.floor(Number(nuevoSaldo) || 0));
  const actual = Math.max(0, Math.floor(Number(saldoActual) || 0));
  const delta = destino - actual;
  await db.execute({
    sql: "UPDATE clientes SET tokens_saldo = ?, updated_at = datetime('now') WHERE id = ?",
    args: [destino, clienteId],
  });
  if (delta !== 0) {
    await insertMovimiento(db, clienteId, null, "ajuste", delta, `Ajuste manual de saldo (${actual} → ${destino})`, adminEmail);
  }
  return destino;
}
