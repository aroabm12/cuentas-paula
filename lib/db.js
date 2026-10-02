import { neon } from "@neondatabase/serverless";

// Vercel inyecta esta variable automáticamente cuando conectas
// la integración de Neon Postgres desde la pestaña "Storage".
// Se crea de forma perezosa (no al cargar el módulo) para que
// `next build` no falle si la variable aún no existe en ese momento.
let _sql = null;
export function getSql() {
  if (!_sql) {
    if (!process.env.DATABASE_URL) {
      throw new Error(
        "Falta DATABASE_URL. Conecta la base de datos Neon desde la pestaña Storage de tu proyecto en Vercel."
      );
    }
    _sql = neon(process.env.DATABASE_URL);
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
  ["Coche", 150.0, "1"],
  ["Gimnasio", 40.0, "1"],
  ["Parking", 60.0, "1-5"],
  ["Plan Metal", 16.0, "5"],
  ["Hevy", 3.5, "8"],
  ["Claude", 17.61, "11"],
  ["Apple", 10.0, "12"],
  ["Uñas manos", 22.0, "variable"],
  ["Cejas", 11.0, "~24"],
  ["Podimo (mamá)", 5.0, "26"],
  ["Disney+", 11.0, "26"],
  ["Uñas pie", 25.0, ""],
];

const INGRESOS_FIJOS_INICIALES = [["Paro", 1132.9, "10"]];

const PRESUPUESTO_VARIABLE_INICIAL = [
  ["Comida / supermercado", 0],
  ["Ocio y restaurantes", 0],
  ["Gasolina / transporte", 0],
  ["Ropa y cuidado personal", 0],
  ["Veterinario / pienso perro", 0],
  ["Imprevistos", 30],
];

// Crea las tablas y los datos iniciales la primera vez que se
// necesitan. No hace falta ejecutar nada a mano.
//
// Como la app hace varias peticiones a la vez al cargar (movimientos,
// gastos fijos, ingresos fijos...), es posible que dos peticiones
// intenten crear las tablas casi al mismo tiempo. "CREATE TABLE IF
// NOT EXISTS" normalmente lo evita, pero bajo mucha concurrencia
// puede dar igualmente un error de "ya existe" — por eso ese error
// concreto se ignora a propósito (no es un fallo real).
async function creaTablaSiHaceFalta(sql, sentenciaSQL) {
  try {
    await sql.query(sentenciaSQL);
  } catch (err) {
    const yaExiste =
      err && (err.code === "42P07" || (err.code === "23505" && err.constraint === "pg_type_typname_nsp_index"));
    if (!yaExiste) throw err;
  }
}

export async function ensureSchema() {
  if (ready) return;
  const sql = getSql();

  await creaTablaSiHaceFalta(
    sql,
    `CREATE TABLE IF NOT EXISTS movimientos (
      id SERIAL PRIMARY KEY,
      fecha DATE NOT NULL,
      concepto TEXT NOT NULL,
      gasto NUMERIC(10,2) NOT NULL DEFAULT 0,
      ingreso NUMERIC(10,2) NOT NULL DEFAULT 0,
      creado_en TIMESTAMP NOT NULL DEFAULT now()
    )`
  );
  await creaTablaSiHaceFalta(
    sql,
    `CREATE TABLE IF NOT EXISTS config (
      clave TEXT PRIMARY KEY,
      valor NUMERIC(10,2) NOT NULL
    )`
  );
  await creaTablaSiHaceFalta(
    sql,
    `CREATE TABLE IF NOT EXISTS gastos_fijos (
      id SERIAL PRIMARY KEY,
      concepto TEXT NOT NULL,
      importe NUMERIC(10,2) NOT NULL DEFAULT 0,
      dia TEXT NOT NULL DEFAULT '',
      orden INT NOT NULL DEFAULT 0
    )`
  );
  await creaTablaSiHaceFalta(
    sql,
    `CREATE TABLE IF NOT EXISTS ingresos_fijos (
      id SERIAL PRIMARY KEY,
      concepto TEXT NOT NULL,
      importe NUMERIC(10,2) NOT NULL DEFAULT 0,
      dia TEXT NOT NULL DEFAULT '',
      orden INT NOT NULL DEFAULT 0
    )`
  );
  await creaTablaSiHaceFalta(
    sql,
    `CREATE TABLE IF NOT EXISTS presupuesto_variable (
      id SERIAL PRIMARY KEY,
      concepto TEXT NOT NULL,
      importe NUMERIC(10,2) NOT NULL DEFAULT 0,
      orden INT NOT NULL DEFAULT 0
    )`
  );

  await creaTablaSiHaceFalta(
    sql,
    `CREATE TABLE IF NOT EXISTS overrides_mensuales (
      anio_mes TEXT PRIMARY KEY,
      ingresos_previstos NUMERIC(10,2)
    )`
  );

  await sql`INSERT INTO config (clave, valor) VALUES ('saldo_inicial', 0) ON CONFLICT (clave) DO NOTHING;`;
  await sql`INSERT INTO config (clave, valor) VALUES ('meta_min', 450) ON CONFLICT (clave) DO NOTHING;`;
  await sql`INSERT INTO config (clave, valor) VALUES ('meta_max', 500) ON CONFLICT (clave) DO NOTHING;`;

  async function sembrar(tabla, filas, conDia) {
    const [{ count }] = await sql.query(`SELECT COUNT(*)::int AS count FROM ${tabla}`);
    if (count > 0) return;
    for (let i = 0; i < filas.length; i++) {
      if (conDia) {
        const [concepto, importe, dia] = filas[i];
        await sql.query(
          `INSERT INTO ${tabla} (concepto, importe, dia, orden) VALUES ($1, $2, $3, $4)`,
          [concepto, importe, dia, i]
        );
      } else {
        const [concepto, importe] = filas[i];
        await sql.query(
          `INSERT INTO ${tabla} (concepto, importe, orden) VALUES ($1, $2, $3)`,
          [concepto, importe, i]
        );
      }
    }
  }

  await sembrar("gastos_fijos", GASTOS_FIJOS_INICIALES, true);
  await sembrar("ingresos_fijos", INGRESOS_FIJOS_INICIALES, true);
  await sembrar("presupuesto_variable", PRESUPUESTO_VARIABLE_INICIAL, false);

  // Añade la columna de categoría si la tabla ya existía de antes
  // (usuarios que ya tenían movimientos guardados sin esto).
  await creaTablaSiHaceFalta(sql, `ALTER TABLE movimientos ADD COLUMN IF NOT EXISTS categoria_id INTEGER`);

  // Gastos fijos que tocan un mes sí y otro no: se guarda el primer mes
  // en que tocan ("2026-09"). Vacío = todos los meses.
  await creaTablaSiHaceFalta(sql, `ALTER TABLE gastos_fijos ADD COLUMN IF NOT EXISTS meses_alternos_desde TEXT`);

  // Una sola vez: "Uñas pie" deja de ser categoría variable (es un gasto
  // fijo) y pasa a tocar mes sí, mes no empezando en septiembre de 2026.
  const [yaMigrado] = await sql`SELECT 1 FROM config WHERE clave = 'migracion_unas_pie'`;
  if (!yaMigrado) {
    await sql`
      UPDATE gastos_fijos
      SET meses_alternos_desde = '2026-09',
          dia = CASE WHEN dia ILIKE '%mes s%' THEN '' ELSE dia END
      WHERE lower(trim(concepto)) = 'uñas pie'
    `;
    await sql`
      UPDATE movimientos SET categoria_id = NULL
      WHERE categoria_id IN (SELECT id FROM presupuesto_variable WHERE lower(trim(concepto)) = 'uñas pie')
    `;
    await sql`DELETE FROM presupuesto_variable WHERE lower(trim(concepto)) = 'uñas pie'`;
    await sql`INSERT INTO config (clave, valor) VALUES ('migracion_unas_pie', 1) ON CONFLICT (clave) DO NOTHING`;
  }

  // Una sola vez: antes, un gasto cuyo concepto llevaba el nombre de un
  // gasto fijo contaba siempre como fijo, aunque tuviera categoría. Ahora
  // la categoría elegida manda, así que a los movimientos que ya había se
  // les quita la categoría en ese caso para que sigan contando igual.
  const [yaMigradoFijos] = await sql`SELECT 1 FROM config WHERE clave = 'migracion_categoria_fijos'`;
  if (!yaMigradoFijos) {
    await sql`
      UPDATE movimientos m SET categoria_id = NULL
      WHERE m.categoria_id IS NOT NULL
        AND m.gasto > 0
        AND EXISTS (
          SELECT 1 FROM gastos_fijos g
          WHERE g.concepto <> '' AND position(lower(g.concepto) IN lower(m.concepto)) > 0
        )
    `;
    await sql`INSERT INTO config (clave, valor) VALUES ('migracion_categoria_fijos', 1) ON CONFLICT (clave) DO NOTHING`;
  }

  ready = true;
}
