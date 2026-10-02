// Reglas compartidas por la app y el Excel para saber dónde cuenta
// cada gasto. Así los números cuadran en todas partes.

// Para emparejar un movimiento con una categoría variable usamos la
// primera palabra del nombre de la categoría (p.ej. "Comida / supermercado"
// -> "comida"), porque el concepto que escribes suele ser más corto.
export function palabraClave(concepto) {
  return concepto.split("/")[0].split(" y ")[0].trim().toLowerCase();
}

// Índice del gasto fijo cuyo nombre aparece en el concepto, o -1.
export function indiceGastoFijo(concepto, gastosFijos) {
  const texto = (concepto || "").toLowerCase();
  return gastosFijos.findIndex((gf) => texto.includes(gf.concepto.toLowerCase()));
}

// Índice de la categoría que encaja por el texto del concepto, o -1.
export function indiceCategoriaPorTexto(concepto, categorias) {
  const texto = (concepto || "").toLowerCase();
  return categorias.findIndex((c) => texto.includes(palabraClave(c.concepto)));
}

// Cada gasto cuenta en un solo sitio:
// 1. Si al apuntarlo elegiste una categoría, va a esa categoría (aunque
//    el concepto se parezca a un gasto fijo, p.ej. "gasolina coche").
// 2. Si no, si su concepto contiene el nombre de un gasto fijo, es fijo.
// 3. Si no, va a la categoría que encaje por el texto.
// 4. Si nada encaja, índice -1 ("Sin categoría").
export function clasificarGasto(m, gastosFijos, categorias) {
  if (m.categoria_id) {
    const iElegida = categorias.findIndex((c) => c.id === m.categoria_id);
    if (iElegida !== -1) return { fijo: false, indice: iElegida };
  }
  const iFijo = indiceGastoFijo(m.concepto, gastosFijos);
  if (iFijo !== -1) return { fijo: true, indice: iFijo };
  return { fijo: false, indice: indiceCategoriaPorTexto(m.concepto, categorias) };
}

export function claveDeMes(fecha) {
  return `${fecha.getFullYear()}-${String(fecha.getMonth() + 1).padStart(2, "0")}`;
}

// Los gastos fijos "mes sí, mes no" guardan el primer mes en que tocan
// ("2026-09"); a partir de ahí tocan un mes de cada dos.
export function gastoFijoTocaEnMes(gf, fechaMes) {
  if (!gf.meses_alternos_desde) return true;
  const [anio, mes] = gf.meses_alternos_desde.split("-").map(Number);
  const diferencia = fechaMes.getFullYear() * 12 + fechaMes.getMonth() - (anio * 12 + mes - 1);
  return ((diferencia % 2) + 2) % 2 === 0;
}
