import { neon } from "@neondatabase/serverless";

// Vercel inyecta esta variable automáticamente cuando conectas
// la integración de Neon Postgres desde la pestaña "Storage".
// Se crea de forma perezosa (no al cargar el módulo) para que
// `next build` no falle si la variable aún no existe en ese momento.
// Si al conectar Neon se puso un prefijo, la variable se llama p.ej.
// "STORAGE_DATABASE_URL"; también la buscamos con ese nombre.
function urlBaseDatos() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  if (process.env.POSTGRES_URL) return process.env.POSTGRES_URL;
  const otra = Object.keys(process.env).find((k) => k.endsWith("_DATABASE_URL") || k.endsWith("_POSTGRES_URL"));
  return otra ? process.env[otra] : null;
}

let _sql = null;
export function getSql() {
  if (!_sql) {
    const url = urlBaseDatos();
    if (!url) {
      throw new Error(
        "Falta DATABASE_URL. Conecta la base de datos Neon desde la pestaña Storage de tu proyecto en Vercel y vuelve a desplegar (Redeploy)."
      );
    }
    // Sin esto, Next.js guarda en caché las respuestas de la base de datos
    // y la app enseña datos viejos (p.ej. guardas la meta y vuelve a la de antes).
    _sql = neon(url, { fetchOptions: { cache: "no-store" } });
  }
  return _sql;
}
export function sql(...args) {
  return getSql()(...args);
}
sql.query = (...args) => getSql().query(...args);
sql.transaction = (...args) => getSql().transaction(...args);

let ready = false;

const GASTOS_FIJOS_INICIALES = [
  ["Alquiler", 550.0, "3"],
  ["Coche", 382.96, "2"],
];

const INGRESOS_FIJOS_INICIALES = [["Nómina", 1770.0, "1"]];

const PRESUPUESTO_VARIABLE_INICIAL = [
  ["Comida / supermercado", 0],
  ["Ocio", 0],
  ["Gasolina", 0],
  ["Ropa y cuidado personal", 0],
  ["Imprevistos", 0],
];

// Crea las tablas y los datos iniciales la primera vez que se
// necesitan. No hace falta ejecutar nada a mano.
//
// Al abrir la app se hacen varias peticiones a la vez (movimientos,
// gastos fijos, ingresos fijos...), y cada una puede llegar a un
// servidor distinto. Por eso todo se hace en UNA transacción que empieza
// cogiendo un candado: si dos llegan a la vez, la segunda espera a que
// termine la primera. Así no hay errores de "ya existe" ni datos
// iniciales repetidos.
const CANDADO = 734001;

// Para que una sentencia se ejecute solo si todavía no se ha hecho el
// paso marcado con esa clave en la tabla config.
const siNoHecho = (clave) => `NOT EXISTS (SELECT 1 FROM config WHERE clave = '${clave}')`;

// Una sola sentencia por tabla, para que "la tabla está vacía" se mire
// una única vez. La última columna es el orden (posición en la lista).
const TIPOS = { concepto: "text", importe: "numeric", dia: "text", orden: "int" };
function sembrar(sql, tabla, columnas, filas) {
  const params = [];
  const valores = filas.map((fila, i) => {
    const celdas = [...fila, i].map((v, c) => {
      params.push(v);
      return `$${params.length}::${TIPOS[columnas[c]]}`;
    });
    return `(${celdas.join(", ")})`;
  });
  return sql.query(
    `INSERT INTO ${tabla} (${columnas.join(", ")})
     SELECT * FROM (VALUES ${valores.join(", ")}) AS v(${columnas.join(", ")})
     WHERE ${siNoHecho("datos_iniciales")} AND NOT EXISTS (SELECT 1 FROM ${tabla})`,
    params
  );
}

export async function ensureSchema() {
  if (ready) return;
  const sql = getSql();

  const sentencias = [
    sql.query(`SELECT pg_advisory_xact_lock(${CANDADO})`),
    sql`CREATE TABLE IF NOT EXISTS movimientos (
      id SERIAL PRIMARY KEY,
      fecha DATE NOT NULL,
      concepto TEXT NOT NULL,
      gasto NUMERIC(10,2) NOT NULL DEFAULT 0,
      ingreso NUMERIC(10,2) NOT NULL DEFAULT 0,
      creado_en TIMESTAMP NOT NULL DEFAULT now()
    )`,
    sql`CREATE TABLE IF NOT EXISTS config (
      clave TEXT PRIMARY KEY,
      valor NUMERIC(10,2) NOT NULL
    )`,
    sql`CREATE TABLE IF NOT EXISTS gastos_fijos (
      id SERIAL PRIMARY KEY,
      concepto TEXT NOT NULL,
      importe NUMERIC(10,2) NOT NULL DEFAULT 0,
      dia TEXT NOT NULL DEFAULT '',
      orden INT NOT NULL DEFAULT 0
    )`,
    sql`CREATE TABLE IF NOT EXISTS ingresos_fijos (
      id SERIAL PRIMARY KEY,
      concepto TEXT NOT NULL,
      importe NUMERIC(10,2) NOT NULL DEFAULT 0,
      dia TEXT NOT NULL DEFAULT '',
      orden INT NOT NULL DEFAULT 0
    )`,
    sql`CREATE TABLE IF NOT EXISTS presupuesto_variable (
      id SERIAL PRIMARY KEY,
      concepto TEXT NOT NULL,
      importe NUMERIC(10,2) NOT NULL DEFAULT 0,
      orden INT NOT NULL DEFAULT 0
    )`,
    sql`CREATE TABLE IF NOT EXISTS overrides_mensuales (
      anio_mes TEXT PRIMARY KEY,
      ingresos_previstos NUMERIC(10,2)
    )`,
    sql`ALTER TABLE movimientos ADD COLUMN IF NOT EXISTS categoria_id INTEGER`,
    // Gastos fijos que tocan un mes sí y otro no: se guarda el primer mes
    // en que tocan ("2026-09"). Vacío = todos los meses.
    sql`ALTER TABLE gastos_fijos ADD COLUMN IF NOT EXISTS meses_alternos_desde TEXT`,

    sql`INSERT INTO config (clave, valor) VALUES ('saldo_inicial', 0) ON CONFLICT (clave) DO NOTHING`,
    sql`INSERT INTO config (clave, valor) VALUES ('meta_min', 250) ON CONFLICT (clave) DO NOTHING`,
    sql`INSERT INTO config (clave, valor) VALUES ('meta_max', 250) ON CONFLICT (clave) DO NOTHING`,

    // Datos iniciales: solo la primera vez y solo si la tabla está vacía.
    sembrar(sql, "gastos_fijos", ["concepto", "importe", "dia", "orden"], GASTOS_FIJOS_INICIALES),
    sembrar(sql, "ingresos_fijos", ["concepto", "importe", "dia", "orden"], INGRESOS_FIJOS_INICIALES),
    sembrar(sql, "presupuesto_variable", ["concepto", "importe", "orden"], PRESUPUESTO_VARIABLE_INICIAL),
    sql`INSERT INTO config (clave, valor) VALUES ('datos_iniciales', 1) ON CONFLICT (clave) DO NOTHING`,

    // Una sola vez: arregla las bases de datos que se crearon con la
    // versión anterior, que podía meter los datos iniciales repetidos, y
    // pone los días de cobro y de pago.
    sql.query(`
      UPDATE movimientos m SET categoria_id = (
        SELECT MIN(p2.id) FROM presupuesto_variable p1
        JOIN presupuesto_variable p2 ON p2.concepto = p1.concepto
        WHERE p1.id = m.categoria_id
      )
      WHERE ${siNoHecho("reparacion_inicial")} AND m.categoria_id IS NOT NULL`),
    sql.query(`
      DELETE FROM presupuesto_variable a USING presupuesto_variable b
      WHERE ${siNoHecho("reparacion_inicial")} AND a.concepto = b.concepto AND a.id > b.id`),
    sql.query(`
      DELETE FROM gastos_fijos a USING gastos_fijos b
      WHERE ${siNoHecho("reparacion_inicial")}
        AND a.concepto = b.concepto AND a.importe = b.importe AND a.dia = b.dia AND a.id > b.id`),
    sql.query(`
      DELETE FROM ingresos_fijos a USING ingresos_fijos b
      WHERE ${siNoHecho("reparacion_inicial")}
        AND a.concepto = b.concepto AND a.importe = b.importe AND a.dia = b.dia AND a.id > b.id`),
    sql.query(`
      UPDATE gastos_fijos SET dia = CASE concepto WHEN 'Coche' THEN '2' ELSE '3' END
      WHERE ${siNoHecho("reparacion_inicial")} AND concepto IN ('Coche', 'Alquiler') AND dia = ''`),
    sql.query(`
      UPDATE ingresos_fijos SET dia = '1'
      WHERE ${siNoHecho("reparacion_inicial")} AND concepto = 'Nómina' AND dia = ''`),
    sql`INSERT INTO config (clave, valor) VALUES ('reparacion_inicial', 1) ON CONFLICT (clave) DO NOTHING`,

    // Una sola vez: meta de ahorro de 250 € al mes.
    sql.query(`
      UPDATE config SET valor = 250
      WHERE ${siNoHecho("meta_250")} AND clave IN ('meta_min', 'meta_max')`),
    sql`INSERT INTO config (clave, valor) VALUES ('meta_250', 1) ON CONFLICT (clave) DO NOTHING`,
  ];

  await sql.transaction(sentencias);
  ready = true;
}
