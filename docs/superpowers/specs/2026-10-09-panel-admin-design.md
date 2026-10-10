# Diseño: Panel de Administración · Masa Fácil

- **Fecha:** 2026-10-09
- **Estado:** Aprobado para planificación
- **Ámbito:** `Website/admin.html` (nuevo), `Website/index.html`, base de datos Turso (libSQL)
- **Autor:** OpenCode (con Joel Medina)

---

## 1. Resumen

Crear un **panel de administración** separado (`admin.html`) para el negocio Masa Fácil que permita:

1. **Monitorear clientes registrados** (datos de contacto, nivel de fidelidad, pedidos y gasto acumulado).
2. **Ver el registro de ventas** (pedidos logueados e invitados) con totales y filtros.
3. **Editar productos**: precio, descuento por producto, disponibilidad (agotado) y descuento por categoría.
4. **Gestionar promociones**: una promo global del sitio (on/off, %, texto).
5. **Ajustar la fidelidad por cliente**: `porcentaje_descuento`, `nivel_fidelizacion` y notas internas.

El acceso se limita a una **lista blanca de correos** (`jolex3630@gmail.com` por ahora, extensible a 2). El botón de acceso aparece en la navbar de `index.html` únicamente cuando el correo autenticado está autorizado.

---

## 2. Objetivos y no-objetivos

### Objetivos (v1)
- Autenticación con Google (GIS) y gate por correo en `admin.html`.
- Dashboard con KPIs y ranking de clientes más fieles.
- CRUD de *overrides* de productos/precios/descuentos/disponibilidad.
- Promo global + descuentos por categoría.
- Registro de **todos** los pedidos (logueados e invitados).
- Aplicación de los overrides y promos en la web pública, con degradación elegante.

### No-objetivos (v1)
- Gestión/edición de fotografías.
- Cupones con código.
- Crear o eliminar productos (solo editar los existentes).
- Backend/serverless con seguridad real (validación de firma JWT o tokens Turso por usuario).
- Multi-usuario con roles/permisos diferenciados.

---

## 3. Decisiones de diseño

| Tema | Decisión |
|---|---|
| Alcance v1 | Clientes + ventas + edición de productos/precios/descuentos |
| Seguridad | Gate por correo en el cliente (sin backend) |
| Persistencia de productos | Overrides en Turso sobre el catálogo hardcodeado |
| Descuentos | Fidelidad por cliente + producto/categoría + promo global |
| Ubicación del panel | `admin.html` separado |
| Registro de ventas | Registrar todos los pedidos (logueados + invitados) |
| Orden de descuentos | producto/categoría → promo 2x$1 (existente) → promo global → fidelidad |
| Pedido de invitado | `nombre_cliente = 'Invitado'`, `cliente_id = NULL` |

---

## 4. Arquitectura

```
┌────────────────────────┐         ┌─────────────────────────┐
│  index.html (público)  │         │   admin.html (privado)  │
│                        │         │                         │
│  · GIS login           │         │  · GIS login            │
│  · Turso client        │         │  · Gate por correo      │
│  · Aplica overrides    │◄────────┤  · Dashboard/Clientes/  │
│  · Carrito + WhatsApp  │  Turso  │    Ventas/Productos/    │
│  · Registra pedidos    │  libSQL │    Promociones          │
└───────────┬────────────┘         └────────────┬────────────┘
            │                                   │
            └──────────────┬────────────────────┘
                           ▼
                 ┌───────────────────────┐
                 │  Turso (libSQL)       │
                 │  clientes, pedidos,   │
                 │  producto_overrides,  │
                 │  categoria_overrides, │
                 │  ajustes              │
                 └───────────────────────┘
```

- `admin.html` reutiliza el mismo **Google Client ID** y el **cliente libSQL** (`@libsql/client` vía jsDelivr `+esm`).
- `index.html` y `admin.html` comparten credenciales (URL y token de Turso embebidos), como hoy.
- La comunicación es directa cliente ↔ Turso (sin servidor intermedio).

---

## 5. Modelo de datos (Turso / libSQL)

### 5.1. Tablas existentes (sin cambios de estructura)
- `clientes(id, email, nombre, avatar_url, telefono_whatsapp, total_pedidos, total_gastado, porcentaje_descuento, nivel_fidelizacion, notas_internas, created_at, updated_at)`
- `pedidos(id, cliente_id, nombre_cliente, email_cliente, telefono_whatsapp, items_json, subtotal, descuento_aplicado, costo_delivery, total_final, zona_entrega, notas, created_at)`

### 5.2. Tablas nuevas

```sql
-- Overrides por producto (solo se guarda lo que el admin cambia)
CREATE TABLE IF NOT EXISTS producto_overrides (
  producto_key  TEXT PRIMARY KEY,   -- clave del carrito, ej. 'Pastelito Queso', 'Latte'
  precio        REAL,               -- NULL = usar precio base del catálogo
  descuento_pct REAL DEFAULT 0,     -- 0..100
  disponible    INTEGER DEFAULT 1,  -- 1 = disponible, 0 = agotado
  etiqueta      TEXT,               -- texto libre opcional (ej. 'NUEVO', 'PROMO')
  updated_at    TEXT DEFAULT (datetime('now'))
);

-- Overrides por categoría
CREATE TABLE IF NOT EXISTS categoria_overrides (
  categoria     TEXT PRIMARY KEY,   -- 'Pastelitos','Entradas','Paninis','Sándwich y Burger','Bebidas','Combos Eventos'
  descuento_pct REAL DEFAULT 0,
  disponible    INTEGER DEFAULT 1,
  updated_at    TEXT DEFAULT (datetime('now'))
);

-- Ajustes globales (key-value) — promo global del sitio
CREATE TABLE IF NOT EXISTS ajustes (
  clave      TEXT PRIMARY KEY,      -- 'promo_activa','promo_pct','promo_texto'
  valor      TEXT,
  updated_at TEXT DEFAULT (datetime('now'))
);
```

**Claves de ajustes:**
- `promo_activa`: `'1'` / `'0'`
- `promo_pct`: número (`'10'`)
- `promo_texto`: texto mostrado en el banner (ej. `'20% OFF en todo el menú hoy'`)

**Convención de `producto_key`:** la misma clave que usa el objeto carrito `C` en `index.html`:
- Pastelitos: `'Pastelito ' + nombre` (ej. `Pastelito Queso`).
- Otros: el nombre tal cual (`Latte`, `Panini Italiano`, `Combo 30 piezas`, etc.).

---

## 6. `admin.html` — UI y pantallas

**Cabecera:** logo Masa Fácil, avatar + correo del admin, botón "Cerrar sesión", enlace "Ver web".

**Pantallas (tabs):**

1. **Dashboard**
   - KPIs: nº de clientes, nº de pedidos, ingresos totales (`SUM(total_final)`), ticket promedio, ventas del mes actual.
   - Top 5 clientes por `total_gastado` y por `total_pedidos`.

2. **Clientes**
   - Tabla con búsqueda por nombre/email/teléfono.
   - Columnas: nombre, email, teléfono, nivel, % descuento, pedidos, gastado, última compra.
   - Edición en línea de `nivel_fidelizacion`, `porcentaje_descuento`, `notas_internas` (guardar en `clientes`).
   - Botón "Ver pedidos" → lista de pedidos del cliente.

3. **Ventas**
   - Tabla de `pedidos` (fecha, cliente/invitado, items, subtotal, descuento, delivery, total, zona).
   - Filtro por rango de fechas y por tipo (logueado/invitado).
   - Totales agregados del rango y exportación CSV.

4. **Productos**
   - Lista agrupada por categoría (derivada del catálogo base hardcodeado).
   - Por producto: precio (override), descuento %, disponible (agotado). Por categoría: descuento %, disponible.
   - Guardado en `producto_overrides` / `categoria_overrides`; botón "Restablecer" (borra el override).

5. **Promociones**
   - Promo global: activar/desactivar, % y texto.
   - Guardado en `ajustes`.

---

## 7. Cambios en `index.html`

1. **Carga de overrides**: tras inicializar el cliente Turso, consultar `producto_overrides`, `categoria_overrides` y `ajustes`, y:
   - Actualizar precios mostrados en el menú y en `PASTELITOS_LIST` / `DRINKS` / `M`.
   - Marcar productos/categorías agotados (deshabilitar botones `+`, badge "Agotado").
   - Guardar los descuentos y la promo en estructuras en memoria (`window.MFADMIN`).
   - Mostrar el **banner de promo global** si está activa.
   - Degradación elegante: si falla la consulta, se usa el catálogo base sin cambios.

2. **`draw()` (carrito)**: aplicar en orden:
   1. Descuento por producto/categoría (reduce el precio del ítem).
   2. Promo 2x$1 (existente).
   3. Promo global (sobre el subtotal resultante).
   4. Descuento de fidelidad del cliente (existente).
   - Mostrar una fila por cada descuento aplicado en el ticket.

3. **Checkout WhatsApp**: **registrar siempre** el pedido en `pedidos`:
   - Logueado → como hoy (`cliente_id`, nombre, email).
   - Invitado → `cliente_id = NULL`, `nombre_cliente = 'Invitado'`, `email_cliente = NULL`.

4. **Botón de admin en la navbar**: `#admin-btn` visible solo si el correo de `CURRENT_CLIENTE` ∈ `ADMIN_EMAILS`; abre `admin.html`.

---

## 8. Reglas de descuento (orden y cálculo)

Sobre el subtotal bruto de productos `S`:

1. **Descuento por producto/categoría** `d_item`: se aplica al precio unitario efectivo de cada ítem que corresponda (el de producto prevalece sobre el de categoría).
2. **Promo 2x$1** (tradicionales): descuento fijo existente `tradAhorro`.
3. **Promo global** `p_g`: `S_desc * (p_g/100)`.
4. **Fidelidad** `f`: `(subtotal tras pasos 1-3) * (porcentaje_descuento/100)`.

El ticket muestra cada línea por separado. El total final = subtotal con descuentos + delivery.

---

## 9. Seguridad y limitaciones

- El gate es **solo de interfaz**: se compara el correo del JWT decodificado contra `ADMIN_EMAILS`.
- **No es seguridad fuerte**: el token de Turso es público y el JWT se decodifica sin verificar firma. Cualquier usuario técnico podría saltarse el gate.
- Aceptado explícitamente para esta etapa (uso interno, bajo riesgo).
- Mejora futura: backend/serverless que valide la firma del JWT de Google y use credenciales privadas de Turso.

---

## 10. Criterios de aceptación

- [ ] Al iniciar sesión en `admin.html` con `jolex3630@gmail.com`, se accede al panel; con otro correo, se muestra "Acceso restringido".
- [ ] El botón `#admin-btn` aparece en la navbar de `index.html` solo con correo autorizado.
- [ ] El Dashboard muestra KPIs correctos (clientes, pedidos, ingresos, ticket promedio).
- [ ] Se puede editar `porcentaje_descuento` y `nivel_fidelizacion` de un cliente y persiste en Turso.
- [ ] Se puede cambiar el precio/descuento/disponibilidad de un producto y la web pública lo refleja al recargar.
- [ ] La promo global activa se muestra como banner y se aplica en el carrito.
- [ ] Los pedidos de invitados quedan registrados en `pedidos`.
- [ ] El panel funciona sin errores de consola y con degradación elegante si Turso falla.
- [ ] El diseño es coherente con la marca (crema/marrón/salvia, Fredoka).

---

## 11. Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| Gate de UI evadible | Documentado; aceptado para v1; mejora futura con backend |
| Precios hardcodeados difíciles de mapear a claves | Usar la clave del carrito como `producto_key`; tabla de mapeo explícita |
| Latencia/offline al leer overrides | Degradación elegante: usar catálogo base si falla |
| Doble descuento confuso | Orden definido en §8 y una fila por descuento en el ticket |
| `index.html` ya es grande | Panel en `admin.html` separado |

---

## 12. Fases de implementación (para el plan posterior)

1. **Esquema Turso**: crear `producto_overrides`, `categoria_overrides`, `ajustes`.
2. **`admin.html`**: auth + gate + layout + tabs.
3. **admin.html – Clientes y Ventas** (lectura + edición de fidelidad).
4. **admin.html – Productos y Promociones** (escritura de overrides/ajustes).
5. **`index.html` – lectura y aplicación** de overrides/promos + banner.
6. **`index.html` – carrito y checkout** (reglas de descuento + registro de invitados).
7. **Botón de admin en navbar** condicionado por correo.
8. **Verificación integral** y despliegue.
