import XLSX from "xlsx-js-style";
import { clasificarGasto, gastoFijoTocaEnMes } from "./clasificacion";

// Se trabaja en céntimos enteros para que los desgloses sumen
// exactamente su total (sin errores de coma flotante).
const aCentimos = (n) => Math.round((Number(n) || 0) * 100);

function nombreCategoria(m, gastosFijos, categorias) {
  if (!(Number(m.gasto) > 0)) return Number(m.ingreso) > 0 ? "Ingreso" : "";
  const { fijo, indice } = clasificarGasto(m, gastosFijos, categorias);
  if (fijo) return "Gasto fijo";
  return indice !== -1 ? categorias[indice].concepto : "Sin categoría";
}

// Resumen del mes con importes reales. Los gastos fijos "mes sí, mes no"
// solo salen en los meses que tocan (o si ese mes se han pagado).
export function calcularResumenMes(movDelMes, gastosFijos, categorias, fechaMes) {
  const fijos = gastosFijos.map((gf) => ({
    concepto: gf.concepto,
    centimos: 0,
    toca: !fechaMes || gastoFijoTocaEnMes(gf, fechaMes),
  }));
  const variables = categorias.map((c) => ({ id: c.id, concepto: c.concepto, centimos: 0 }));
  let otros = 0;
  let ingresos = 0;

  for (const m of movDelMes) {
    ingresos += aCentimos(m.ingreso);
    const gasto = aCentimos(m.gasto);
    if (gasto <= 0) continue;
    const { fijo, indice } = clasificarGasto(m, gastosFijos, categorias);
    if (fijo) fijos[indice].centimos += gasto;
    else if (indice !== -1) variables[indice].centimos += gasto;
    else otros += gasto;
  }
  if (otros > 0) variables.push({ concepto: "Sin categoría", centimos: otros });
  const fijosVisibles = fijos.filter((f) => f.toca || f.centimos > 0);

  const totalFijos = fijos.reduce((s, f) => s + f.centimos, 0);
  const totalVariables = variables.reduce((s, v) => s + v.centimos, 0);
  const euros = (c) => c / 100;
  return {
    ingresos: euros(ingresos),
    totalFijos: euros(totalFijos),
    fijos: fijosVisibles.map((f) => ({ concepto: f.concepto, importe: euros(f.centimos) })),
    totalVariables: euros(totalVariables),
    variables: variables.map((v) => ({ concepto: v.concepto, importe: euros(v.centimos) })),
    saldo: euros(ingresos - totalFijos - totalVariables),
  };
}

// ---- Estilos ----
const AZUL_MARINO = "0F172A";
const VERDE = "047857";
const ROJO = "B91C1C";
const BORDE_GRIS = "CBD5E1";
const FORMATO_EUROS = '#,##0.00 "€"';
const FORMATO_EUROS_CON_SIGNO = '"+"#,##0.00 "€";"−"#,##0.00 "€";#,##0.00 "€"';

const lineaFina = { style: "thin", color: { rgb: BORDE_GRIS } };
const bordes = { top: lineaFina, bottom: lineaFina, left: lineaFina, right: lineaFina };
const relleno = (rgb) => ({ patternType: "solid", fgColor: { rgb } });

function estiloFila(tipo, valor) {
  const base = { border: bordes, alignment: { vertical: "center" } };
  const colorImporte = valor < 0 ? ROJO : VERDE;
  switch (tipo) {
    case "ingresos":
      return [
        { ...base, font: { bold: true }, fill: relleno("D1FAE5") },
        { ...base, font: { bold: true, color: { rgb: VERDE } }, fill: relleno("D1FAE5") },
      ];
    case "total":
      return [
        { ...base, font: { bold: true }, fill: relleno("E2E8F0") },
        { ...base, font: { bold: true }, fill: relleno("E2E8F0") },
      ];
    case "desglose":
      return [
        { ...base, fill: relleno("FFFFFF"), alignment: { vertical: "center", indent: 1 } },
        { ...base, fill: relleno("FFFFFF") },
      ];
    case "saldo": {
      const borde = { ...bordes, top: { style: "medium", color: { rgb: "64748B" } } };
      return [
        { ...base, border: borde, font: { bold: true } },
        { ...base, border: borde, font: { bold: true, color: { rgb: colorImporte } } },
      ];
    }
    default:
      return [{}, {}];
  }
}

function hojaResumen(nombreMes, r) {
  // Cada fila: [texto, importe, tipo]. null = fila en blanco.
  const filas = [
    ["titulo"],
    null,
    ["Ingresos", r.ingresos, "ingresos"],
    null,
    ["Gastos fijos (Total)", r.totalFijos, "total"],
    ...r.fijos.map((f) => [f.concepto, f.importe, "desglose"]),
    null,
    ["Gastos variables (Total)", r.totalVariables, "total"],
    ...r.variables.map((v) => [v.concepto, v.importe, "desglose"]),
    null,
    ["Saldo total", r.saldo, "saldo"],
    ["Ahorro total", r.saldo, "saldo", FORMATO_EUROS_CON_SIGNO],
  ];

  const ws = {};
  filas.forEach((fila, i) => {
    if (!fila) return;
    const refA = XLSX.utils.encode_cell({ r: i, c: 0 });
    const refB = XLSX.utils.encode_cell({ r: i, c: 1 });
    if (fila[0] === "titulo") {
      const estilo = {
        font: { bold: true, sz: 14, color: { rgb: "FFFFFF" } },
        fill: relleno(AZUL_MARINO),
        alignment: { vertical: "center" },
      };
      ws[refA] = { t: "s", v: `Mis Cuentas — ${nombreMes}`, s: estilo };
      ws[refB] = { t: "s", v: "", s: estilo };
      return;
    }
    const [texto, importe, tipo, formato] = fila;
    const [estiloA, estiloB] = estiloFila(tipo, importe);
    ws[refA] = { t: "s", v: texto, s: estiloA };
    ws[refB] = { t: "n", v: importe, z: formato || FORMATO_EUROS, s: { ...estiloB, numFmt: formato || FORMATO_EUROS } };
  });
  ws["!ref"] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: filas.length - 1, c: 1 } });
  ws["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 1 } }];
  ws["!cols"] = [{ wch: 28 }, { wch: 16 }];
  ws["!rows"] = [{ hpt: 24 }];
  return ws;
}

function hojaMovimientos(filas, gastosFijos, categorias) {
  const ws = XLSX.utils.aoa_to_sheet([
    ["Fecha", "Concepto", "Categoría", "Gasto", "Ingreso", "Saldo"],
    ...filas.map((m) => [
      new Date(m.fecha).toLocaleDateString("es-ES"),
      m.concepto,
      nombreCategoria(m, gastosFijos, categorias),
      Number(m.gasto) || "",
      Number(m.ingreso) || "",
      Math.round(Number(m.saldo) * 100) / 100,
    ]),
  ]);
  const cabecera = {
    font: { bold: true, color: { rgb: "FFFFFF" } },
    fill: relleno(AZUL_MARINO),
    border: bordes,
  };
  for (let c = 0; c < 6; c++) ws[XLSX.utils.encode_cell({ r: 0, c })].s = cabecera;
  filas.forEach((_, i) => {
    for (let c = 0; c < 6; c++) {
      const celda = ws[XLSX.utils.encode_cell({ r: i + 1, c })];
      if (!celda) continue;
      const estilo = { border: bordes };
      if (c >= 3 && celda.t === "n") {
        celda.z = FORMATO_EUROS;
        estilo.numFmt = FORMATO_EUROS;
      }
      if (c === 3) estilo.font = { color: { rgb: ROJO } };
      if (c === 4) estilo.font = { color: { rgb: VERDE } };
      celda.s = estilo;
    }
  });
  ws["!cols"] = [{ wch: 12 }, { wch: 30 }, { wch: 22 }, { wch: 13 }, { wch: 13 }, { wch: 13 }];
  // Filtro en la cabecera para poder ver, p.ej., solo los gastos de Ocio.
  ws["!autofilter"] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: filas.length, c: 5 } }) };
  return ws;
}

export function construirLibroExcel({ nombreMes, fechaMes, movDelMes, filas, gastosFijos, categorias }) {
  const resumen = calcularResumenMes(movDelMes, gastosFijos, categorias, fechaMes);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, hojaResumen(nombreMes, resumen), "Resumen");
  XLSX.utils.book_append_sheet(wb, hojaMovimientos(filas, gastosFijos, categorias), "Movimientos");
  return wb;
}

export function descargarExcel(datos, nombreArchivo) {
  XLSX.writeFile(construirLibroExcel(datos), nombreArchivo);
}
