"use client";
import { useEffect, useState } from "react";
import { descargarExcel } from "../lib/exportarExcel";
import {
  clasificarGasto,
  claveDeMes,
  gastoFijoTocaEnMes,
  indiceCategoriaPorTexto,
  indiceGastoFijo,
} from "../lib/clasificacion";

function money(n) {
  return Number(n).toLocaleString("es-ES", { style: "currency", currency: "EUR" });
}

function mismoMes(fechaStr, ref) {
  const d = new Date(fechaStr);
  return d.getFullYear() === ref.getFullYear() && d.getMonth() === ref.getMonth();
}

// Comprueba si un campo "día" (p.ej. "1", "1-5", "26", "variable") coincide
// con el día del mes de hoy. Los días aproximados/variables no se marcan
// automáticamente como "hoy" porque no se puede saber con certeza.
function diaEsHoy(diaStr, diaHoy) {
  if (!diaStr) return false;
  const limpio = diaStr.trim();
  if (/^\d+$/.test(limpio)) {
    return Number(limpio) === diaHoy;
  }
  const rango = limpio.match(/^(\d+)\s*-\s*(\d+)$/);
  if (rango) {
    const [, a, b] = rango;
    return diaHoy >= Number(a) && diaHoy <= Number(b);
  }
  return false;
}

// La categoría de un gasto se elige en un desplegable con dos grupos:
// tus gastos fijos ("gf-<id>") y tus categorías variables ("cat-<id>").
function sugerirCategoria(concepto, gastosFijos, categorias) {
  const iFijo = indiceGastoFijo(concepto, gastosFijos);
  if (iFijo !== -1) return "gf-" + gastosFijos[iFijo].id;
  const iCat = indiceCategoriaPorTexto(concepto, categorias);
  return iCat !== -1 ? "cat-" + categorias[iCat].id : "";
}

// Convierte lo elegido en el desplegable en lo que se guarda. Si eliges
// un gasto fijo, el concepto tiene que llevar su nombre para contar
// como ese fijo, así que se le añade si no lo lleva.
function resolverCategoria(valor, concepto, gastosFijos) {
  if (valor.startsWith("cat-")) return { categoriaId: Number(valor.slice(4)), concepto };
  if (valor.startsWith("gf-")) {
    const gf = gastosFijos.find((g) => String(g.id) === valor.slice(3));
    if (gf && !concepto.toLowerCase().includes(gf.concepto.toLowerCase())) {
      concepto = concepto.trim() ? `${gf.concepto} · ${concepto.trim()}` : gf.concepto;
    }
    return { categoriaId: null, concepto };
  }
  return null;
}

function SelectorCategoria({ value, onChange, gastosFijos, categorias }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} required>
      <option value="" disabled>
        Elige una categoría…
      </option>
      <optgroup label="Gastos variables">
        {categorias.map((cat) => (
          <option key={cat.id} value={"cat-" + cat.id}>{cat.concepto}</option>
        ))}
      </optgroup>
      <optgroup label="Gastos fijos">
        {gastosFijos.map((gf) => (
          <option key={gf.id} value={"gf-" + gf.id}>{gf.concepto}</option>
        ))}
      </optgroup>
    </select>
  );
}

export default function Home() {
  const [hoy, setHoy] = useState(() => new Date());
  const [mesSeleccionado, setMesSeleccionado] = useState(() => new Date());

  // Si la app se queda abierta en segundo plano (p.ej. en el iPhone) y al
  // volver ya ha cambiado el día, actualizamos "hoy"; y si ha cambiado el
  // mes, volvemos a mostrar el mes en curso.
  useEffect(() => {
    function alVolver() {
      if (document.visibilityState === "hidden") return;
      const ahora = new Date();
      setHoy((antes) => (antes.toDateString() === ahora.toDateString() ? antes : ahora));
    }
    document.addEventListener("visibilitychange", alVolver);
    window.addEventListener("focus", alVolver);
    window.addEventListener("pageshow", alVolver);
    return () => {
      document.removeEventListener("visibilitychange", alVolver);
      window.removeEventListener("focus", alVolver);
      window.removeEventListener("pageshow", alVolver);
    };
  }, []);
  const anioMesHoy = hoy.getFullYear() * 12 + hoy.getMonth();
  useEffect(() => {
    setMesSeleccionado(new Date());
  }, [anioMesHoy]);
  const [movimientos, setMovimientos] = useState([]);
  const [saldoInicial, setSaldoInicial] = useState(0);
  const [config, setConfig] = useState({ meta_min: 450, meta_max: 500 });
  const [gastosFijos, setGastosFijos] = useState([]);
  const [ingresosFijos, setIngresosFijos] = useState([]);
  const [presupuestoVariable, setPresupuestoVariable] = useState([]);
  const [overridesMensuales, setOverridesMensuales] = useState([]);
  const [loading, setLoading] = useState(true);

  const [editandoSaldo, setEditandoSaldo] = useState(false);
  const [nuevoSaldoInicial, setNuevoSaldoInicial] = useState("");
  const [editandoMeta, setEditandoMeta] = useState(false);
  const [metaMinInput, setMetaMinInput] = useState("");
  const [metaMaxInput, setMetaMaxInput] = useState("");

  const [fecha, setFecha] = useState(() => new Date().toISOString().slice(0, 10));
  const [concepto, setConcepto] = useState("");
  const [importe, setImporte] = useState("");
  const [tipo, setTipo] = useState("gasto");
  const [categoria, setCategoria] = useState("");
  const [categoriaTocada, setCategoriaTocada] = useState(false);
  const [movEditandoId, setMovEditandoId] = useState(null);
  const [categoriaAbiertaId, setCategoriaAbiertaId] = useState(null);

  const [mostrarGestion, setMostrarGestion] = useState(false);
  const [nuevoGF, setNuevoGF] = useState({ concepto: "", importe: "", dia: "", meses_alternos_desde: null });
  const [mostrarGestionIng, setMostrarGestionIng] = useState(false);
  const [nuevoIF, setNuevoIF] = useState({ concepto: "", importe: "", dia: "" });
  const [mostrarGestionVar, setMostrarGestionVar] = useState(false);
  const [nuevaCat, setNuevaCat] = useState({ concepto: "", importe: "" });
  const [mostrarTodosMovs, setMostrarTodosMovs] = useState(false);
  const [error, setError] = useState("");
  const [editandoIngPrevistos, setEditandoIngPrevistos] = useState(false);
  const [ingPrevistosInput, setIngPrevistosInput] = useState("");

  async function cargarTodo() {
    setLoading(true);
    setError("");
    try {
      const [rMov, rCfg, rGF, rIF, rVar, rOv] = await Promise.all([
        fetch("/api/movimientos"),
        fetch("/api/config"),
        fetch("/api/gastos-fijos"),
        fetch("/api/ingresos-fijos"),
        fetch("/api/presupuesto-variable"),
        fetch("/api/overrides-mensuales"),
      ]);
      for (const r of [rMov, rCfg, rGF, rIF, rVar, rOv]) {
        if (!r.ok) throw new Error(`Error ${r.status} cargando datos`);
      }
      const dMov = await rMov.json();
      const dCfg = await rCfg.json();
      const dGF = await rGF.json();
      const dIF = await rIF.json();
      const dVar = await rVar.json();
      const dOv = await rOv.json();
      setMovimientos(dMov.movimientos);
      setSaldoInicial(dMov.saldoInicial);
      setConfig(dCfg);
      setGastosFijos(dGF.gastosFijos);
      setIngresosFijos(dIF.ingresosFijos);
      setPresupuestoVariable(dVar.presupuestoVariable);
      setOverridesMensuales(dOv.overrides);
    } catch (err) {
      console.error(err);
      setError("No se ha podido cargar: " + err.message);
    }
    setLoading(false);
  }

  useEffect(() => {
    cargarTodo();
  }, []);

  let saldo = saldoInicial;
  const filas = movimientos.map((m) => {
    saldo = saldo - Number(m.gasto) + Number(m.ingreso);
    return { ...m, saldo };
  });
  const saldoActual = filas.length ? filas[filas.length - 1].saldo : saldoInicial;

  const movDelMesReal = filas.filter((m) => mismoMes(m.fecha, hoy));
  const movDelMes = filas.filter((m) => mismoMes(m.fecha, mesSeleccionado));
  const ingresosMes = movDelMes.reduce((s, m) => s + Number(m.ingreso), 0);
  const gastosMes = movDelMes.reduce((s, m) => s + Number(m.gasto), 0);
  const ahorroRealMes = ingresosMes - gastosMes;
  const metaMin = Number(config.meta_min ?? 450);
  const metaMax = Number(config.meta_max ?? 500);

  // Previsión del mes, como en el Excel: lo que cobras normalmente menos
  // tus gastos fijos habituales menos lo que quieres ahorrar = lo que
  // te queda libre para gastar ese mes. "Ingresos previstos" se puede
  // corregir mes a mes (p.ej. un mes de transición sin cobro) sin que
  // afecte a los demás meses, que siguen usando el valor normal.
  const claveMes = claveDeMes(mesSeleccionado);
  const ingresosPrevistosDefault = ingresosFijos.reduce((s, iff) => s + Number(iff.importe), 0);
  const overrideMes = overridesMensuales.find((o) => o.anio_mes === claveMes);
  const ingresosPrevistos =
    overrideMes && overrideMes.ingresos_previstos !== null
      ? Number(overrideMes.ingresos_previstos)
      : ingresosPrevistosDefault;
  const gastosFijosDelMes = gastosFijos.filter((gf) => gastoFijoTocaEnMes(gf, mesSeleccionado));
  const gastosFijosPrevistos = gastosFijosDelMes.reduce((s, gf) => s + Number(gf.importe), 0);
  const disponibleParaGastar = ingresosPrevistos - gastosFijosPrevistos - metaMin;

  // De lo que ya has gastado este mes, la parte que NO es un gasto fijo
  // (comida, ocio, lo que sea) es lo que consume ese "disponible".
  const esGastoVariable = (m) =>
    Number(m.gasto) > 0 && !clasificarGasto(m, gastosFijos, presupuestoVariable).fijo;
  const gastadoVariableReal = movDelMes.filter(esGastoVariable).reduce((s, m) => s + Number(m.gasto), 0);
  const restaDisponible = disponibleParaGastar - gastadoVariableReal;
  const porcentajeDisponible =
    disponibleParaGastar > 0
      ? Math.min(100, (gastadoVariableReal / disponibleParaGastar) * 100)
      : gastadoVariableReal > 0
      ? 100
      : 0;
  const enMeta = restaDisponible >= 0;

  // Un gasto fijo está pagado si hay un gasto del mes que cuenta como ese fijo.
  function fijoPagadoEn(gf, movs) {
    return movs.some((m) => {
      if (!(Number(m.gasto) > 0)) return false;
      const c = clasificarGasto(m, gastosFijos, presupuestoVariable);
      return c.fijo && gastosFijos[c.indice].id === gf.id;
    });
  }
  const gastosFijosConEstado = gastosFijos
    .map((gf) => ({ ...gf, registrado: fijoPagadoEn(gf, movDelMes) }))
    .filter((gf) => gf.registrado || gastoFijoTocaEnMes(gf, mesSeleccionado));

  const diaHoy = hoy.getDate();
  const gastosFijosHoyEstado = gastosFijos
    .filter((gf) => gastoFijoTocaEnMes(gf, hoy))
    .map((gf) => ({ ...gf, registrado: fijoPagadoEn(gf, movDelMesReal) }));
  const gastosHoy = gastosFijosHoyEstado.filter((gf) => diaEsHoy(gf.dia, diaHoy) && !gf.registrado);
  const ingresosHoy = ingresosFijos.filter((iff) => {
    const yaRegistrado = movDelMesReal.some(
      (m) => Number(m.ingreso) > 0 && m.concepto.toLowerCase().includes(iff.concepto.toLowerCase())
    );
    return diaEsHoy(iff.dia, diaHoy) && !yaRegistrado;
  });

  // Índice de la categoría variable de un gasto (-1 = sin categoría), o
  // null si no es un gasto variable.
  function categoriaDeGasto(m) {
    if (!esGastoVariable(m)) return null;
    return clasificarGasto(m, gastosFijos, presupuestoVariable).indice;
  }

  // Meses anteriores al elegido (hasta 3) que ya tienen movimientos, para
  // comparar lo que gastas en cada categoría con tu media.
  const primerMesConDatos = filas.length ? new Date(filas[0].fecha) : null;
  const mesesParaMedia = [1, 2, 3]
    .map((n) => new Date(mesSeleccionado.getFullYear(), mesSeleccionado.getMonth() - n, 1))
    .filter(
      (d) =>
        primerMesConDatos &&
        d.getFullYear() * 12 + d.getMonth() >= primerMesConDatos.getFullYear() * 12 + primerMesConDatos.getMonth()
    );
  const movsParaMedia = filas.filter((m) => mesesParaMedia.some((d) => mismoMes(m.fecha, d)));
  function mediaCategoria(indice) {
    if (!mesesParaMedia.length) return null;
    const total = movsParaMedia
      .filter((m) => categoriaDeGasto(m) === indice)
      .reduce((s, m) => s + Number(m.gasto), 0);
    return total / mesesParaMedia.length;
  }

  const variablesConGasto = [
    ...presupuestoVariable.map((cat, i) => ({ ...cat, indice: i })),
    { id: "sin-categoria", concepto: "Sin categoría", importe: 0, indice: -1 },
  ].map((cat) => {
    const movsCategoria = movDelMes.filter((m) => categoriaDeGasto(m) === cat.indice);
    const gastado = movsCategoria.reduce((s, m) => s + Number(m.gasto), 0);
    const presupuestado = Number(cat.importe);
    const tieneMaximo = presupuestado > 0;
    const resta = tieneMaximo ? presupuestado - gastado : 0;
    const porcentaje = tieneMaximo ? Math.min(100, (gastado / presupuestado) * 100) : 0;
    return { ...cat, gastado, tieneMaximo, resta, porcentaje, media: mediaCategoria(cat.indice), movimientos: movsCategoria };
  })
    // "Sin categoría" solo aparece si tiene algo, y se ordena de más a menos gastado.
    .filter((cat) => cat.indice !== -1 || cat.gastado > 0)
    .sort((a, b) => b.gastado - a.gastado);

  function cambiarConcepto(valor) {
    setConcepto(valor);
    // Mientras no elijas tú la categoría, te proponemos una según el texto.
    if (!categoriaTocada) setCategoria(sugerirCategoria(valor, gastosFijos, presupuestoVariable));
  }

  async function guardarMovimiento(e) {
    e.preventDefault();
    if (!concepto || !importe) return;
    setError("");
    const elegida = tipo === "gasto" ? resolverCategoria(categoria, concepto, gastosFijos) : null;
    if (tipo === "gasto" && !elegida) {
      setError("Elige una categoría para el gasto.");
      return;
    }
    try {
      const res = await fetch("/api/movimientos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fecha,
          concepto: elegida ? elegida.concepto : concepto,
          gasto: tipo === "gasto" ? importe : 0,
          ingreso: tipo === "ingreso" ? importe : 0,
          categoriaId: elegida ? elegida.categoriaId : null,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Error ${res.status} al guardar`);
      }
      setConcepto("");
      setImporte("");
      setCategoria("");
      setCategoriaTocada(false);
      cargarTodo();
    } catch (err) {
      console.error(err);
      setError("No se ha podido guardar: " + err.message);
    }
  }

  async function actualizarMovimiento(m) {
    setError("");
    try {
      const res = await fetch("/api/movimientos", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: m.id,
          fecha: m.fecha,
          concepto: m.concepto,
          gasto: m.tipo === "gasto" ? m.importe : 0,
          ingreso: m.tipo === "ingreso" ? m.importe : 0,
          categoriaId: m.tipo === "gasto" ? m.categoriaId : null,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Error ${res.status} al guardar`);
      }
      setMovEditandoId(null);
      cargarTodo();
    } catch (err) {
      console.error(err);
      setError("No se ha podido guardar el cambio: " + err.message);
    }
  }

  async function registrarRapido(gf) {
    await fetch("/api/movimientos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fecha: new Date().toISOString().slice(0, 10),
        concepto: gf.concepto,
        gasto: gf.importe,
        ingreso: 0,
      }),
    });
    cargarTodo();
  }

  async function registrarIngresoRapido(iff) {
    await fetch("/api/movimientos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fecha: new Date().toISOString().slice(0, 10),
        concepto: iff.concepto,
        gasto: 0,
        ingreso: iff.importe,
      }),
    });
    cargarTodo();
  }

  async function borrar(id) {
    await fetch(`/api/movimientos?id=${id}`, { method: "DELETE" });
    cargarTodo();
  }

  async function guardarSaldoInicial() {
    await fetch("/api/config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ saldo_inicial: Number(nuevoSaldoInicial) }),
    });
    setEditandoSaldo(false);
    cargarTodo();
  }

  async function guardarMeta() {
    await fetch("/api/config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        meta_min: Number(metaMinInput),
        meta_max: Number(metaMaxInput),
      }),
    });
    setEditandoMeta(false);
    cargarTodo();
  }

  async function guardarIngresosPrevistosMes() {
    await fetch("/api/overrides-mensuales", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ anioMes: claveMes, ingresosPrevistos: Number(ingPrevistosInput) }),
    });
    setEditandoIngPrevistos(false);
    cargarTodo();
  }

  async function quitarOverrideIngresosMes() {
    await fetch(`/api/overrides-mensuales?anioMes=${claveMes}`, { method: "DELETE" });
    cargarTodo();
  }

  async function actualizarGF(gf) {
    await fetch("/api/gastos-fijos", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(gf),
    });
    cargarTodo();
  }

  async function borrarGF(id) {
    await fetch(`/api/gastos-fijos?id=${id}`, { method: "DELETE" });
    cargarTodo();
  }

  async function anadirGF(e) {
    e.preventDefault();
    if (!nuevoGF.concepto) return;
    await fetch("/api/gastos-fijos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(nuevoGF),
    });
    setNuevoGF({ concepto: "", importe: "", dia: "", meses_alternos_desde: null });
    cargarTodo();
  }

  async function actualizarIF(iff) {
    await fetch("/api/ingresos-fijos", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(iff),
    });
    cargarTodo();
  }

  async function borrarIF(id) {
    await fetch(`/api/ingresos-fijos?id=${id}`, { method: "DELETE" });
    cargarTodo();
  }

  async function anadirIF(e) {
    e.preventDefault();
    if (!nuevoIF.concepto) return;
    await fetch("/api/ingresos-fijos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(nuevoIF),
    });
    setNuevoIF({ concepto: "", importe: "", dia: "" });
    cargarTodo();
  }

  async function actualizarCat(cat) {
    await fetch("/api/presupuesto-variable", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(cat),
    });
    cargarTodo();
  }

  async function borrarCat(id) {
    await fetch(`/api/presupuesto-variable?id=${id}`, { method: "DELETE" });
    cargarTodo();
  }

  async function anadirCat(e) {
    e.preventDefault();
    if (!nuevaCat.concepto) return;
    await fetch("/api/presupuesto-variable", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(nuevaCat),
    });
    setNuevaCat({ concepto: "", importe: "" });
    cargarTodo();
  }

  const nombreMes = mesSeleccionado.toLocaleDateString("es-ES", { month: "long", year: "numeric" });

  function mesAnterior() {
    setMesSeleccionado((m) => new Date(m.getFullYear(), m.getMonth() - 1, 1));
  }
  function mesSiguiente() {
    setMesSeleccionado((m) => new Date(m.getFullYear(), m.getMonth() + 1, 1));
  }
  function irAHoy() {
    setMesSeleccionado(new Date());
  }
  const esMesActual = mismoMes(hoy, mesSeleccionado);

  function exportarExcel() {
    descargarExcel(
      { nombreMes, fechaMes: mesSeleccionado, movDelMes, filas, gastosFijos, categorias: presupuestoVariable },
      `mis_cuentas_${claveMes}.xlsx`
    );
  }

  function exportarPDF() {
    window.print();
  }

  const listaMovsMostrada = mostrarTodosMovs ? filas : movDelMes;
  const totalGastoLista = listaMovsMostrada.reduce((s, m) => s + Number(m.gasto), 0);
  const totalIngresoLista = listaMovsMostrada.reduce((s, m) => s + Number(m.ingreso), 0);

  // ---- Comparativa con el mes anterior (para el informe / PDF) ----
  const mesAnteriorRef = new Date(mesSeleccionado.getFullYear(), mesSeleccionado.getMonth() - 1, 1);
  const nombreMesAnterior = mesAnteriorRef.toLocaleDateString("es-ES", { month: "long", year: "numeric" });
  const movMesAnterior = filas.filter((m) => mismoMes(m.fecha, mesAnteriorRef));
  const ingresosMesAnterior = movMesAnterior.reduce((s, m) => s + Number(m.ingreso), 0);
  const gastosMesAnterior = movMesAnterior.reduce((s, m) => s + Number(m.gasto), 0);
  const ahorroMesAnterior = ingresosMesAnterior - gastosMesAnterior;

  // ---- Proyección: al ritmo que vas, cuánto gastarás este mes ----
  const diasDelMes = new Date(mesSeleccionado.getFullYear(), mesSeleccionado.getMonth() + 1, 0).getDate();
  const proyeccionVariable =
    esMesActual && diaHoy >= 3 && diaHoy < diasDelMes ? (gastadoVariableReal / diaHoy) * diasDelMes : null;

  // ---- Ahorro mes a mes (hasta 6 meses, terminando en el elegido) ----
  const indiceMes = (d) => d.getFullYear() * 12 + d.getMonth();
  function ahorroDelMes(d) {
    const movs = filas.filter((m) => mismoMes(m.fecha, d));
    return movs.reduce((s, m) => s + Number(m.ingreso) - Number(m.gasto), 0);
  }
  const mesesEvolucion = primerMesConDatos
    ? [5, 4, 3, 2, 1, 0]
        .map((n) => new Date(mesSeleccionado.getFullYear(), mesSeleccionado.getMonth() - n, 1))
        .filter((d) => indiceMes(d) >= indiceMes(primerMesConDatos))
        .map((d) => ({
          fecha: d,
          nombre: d.toLocaleDateString("es-ES", { month: "short" }).replace(".", ""),
          ahorro: ahorroDelMes(d),
        }))
    : [];
  const maxEscalaAhorro = Math.max(metaMin, ...mesesEvolucion.map((m) => Math.abs(m.ahorro)), 1);
  // Acumulado del año del mes elegido, desde enero (o desde el primer mes con datos).
  const mesesDelAnio = primerMesConDatos
    ? Array.from({ length: mesSeleccionado.getMonth() + 1 }, (_, i) => new Date(mesSeleccionado.getFullYear(), i, 1)).filter(
        (d) => indiceMes(d) >= indiceMes(primerMesConDatos)
      )
    : [];
  const ahorroAnio = mesesDelAnio.reduce((s, d) => s + ahorroDelMes(d), 0);
  const metaAnio = metaMin * mesesDelAnio.length;

  // ---- Gráfico de tarta: en qué se ha ido el dinero este mes ----
  const PALETA_TARTA = ["#5c7d76", "#a08384", "#a9aa85", "#b0564c", "#8fb0a6", "#d0a266", "#7c9caf", "#9c8bb8", "#b0aa8f"];
  function claseDeGasto(m) {
    const indice = categoriaDeGasto(m);
    if (indice === null) return "Gastos fijos";
    return indice !== -1 ? presupuestoVariable[indice].concepto : "Sin categoría";
  }
  const bucketsTarta = {};
  movDelMes
    .filter((m) => Number(m.gasto) > 0)
    .forEach((m) => {
      const clase = claseDeGasto(m);
      bucketsTarta[clase] = (bucketsTarta[clase] || 0) + Number(m.gasto);
    });
  const sliceTarta = Object.entries(bucketsTarta)
    .map(([label, value], i) => ({ label, value, color: PALETA_TARTA[i % PALETA_TARTA.length] }))
    .sort((a, b) => b.value - a.value);
  const totalTarta = sliceTarta.reduce((s, x) => s + x.value, 0);

  function pathsTarta(slices, size) {
    const total = slices.reduce((s, x) => s + x.value, 0);
    if (total <= 0) return [];
    const radio = size / 2;
    let anguloActual = -90;
    return slices.map((sl) => {
      const angulo = (sl.value / total) * 360;
      const x1 = radio + radio * Math.cos((anguloActual * Math.PI) / 180);
      const y1 = radio + radio * Math.sin((anguloActual * Math.PI) / 180);
      anguloActual += angulo;
      const x2 = radio + radio * Math.cos((anguloActual * Math.PI) / 180);
      const y2 = radio + radio * Math.sin((anguloActual * Math.PI) / 180);
      const largeArc = angulo > 180 ? 1 : 0;
      const d =
        angulo >= 359.999
          ? `M ${radio} 0 A ${radio} ${radio} 0 1 1 ${radio - 0.01} 0 Z`
          : `M ${radio} ${radio} L ${x1} ${y1} A ${radio} ${radio} 0 ${largeArc} 1 ${x2} ${y2} Z`;
      return { d, color: sl.color };
    });
  }

  return (
    <div className="container">
      <h1>Mis Cuentas</h1>

      {error && (
        <div className="card error-msg" style={{ marginBottom: 20 }}>
          {error}
        </div>
      )}

      <div className="card saldo-actual">
        <div className="label">Tienes ahora mismo</div>
        <div className="valor">{loading ? "…" : money(saldoActual)}</div>
        {!editandoSaldo ? (
          <div className="editar-saldo" style={{ justifyContent: "center" }}>
            <button
              type="button"
              onClick={() => {
                setNuevoSaldoInicial(String(saldoInicial));
                setEditandoSaldo(true);
              }}
              style={{ background: "transparent", color: "var(--color-primary)" }}
            >
              Corregir saldo de partida
            </button>
          </div>
        ) : (
          <div className="editar-saldo" style={{ justifyContent: "center" }}>
            <input
              type="number"
              step="0.01"
              value={nuevoSaldoInicial}
              onChange={(e) => setNuevoSaldoInicial(e.target.value)}
            />
            <button type="button" onClick={guardarSaldoInicial}>Guardar</button>
          </div>
        )}
      </div>

      <div className={"card tarjeta-hoy" + (ingresosHoy.length || gastosHoy.length ? " con-eventos" : "")}>
        <strong style={{ textTransform: "capitalize" }}>
          Hoy, {hoy.toLocaleDateString("es-ES", { day: "numeric", month: "long" })}
        </strong>
        {ingresosHoy.length === 0 && gastosHoy.length === 0 ? (
          <p className="subtitle" style={{ margin: "8px 0 0" }}>
            No tienes ningún ingreso ni gasto fijo previsto para hoy.
          </p>
        ) : (
          <div style={{ marginTop: 10 }}>
            {ingresosHoy.map((iff) => (
              <div key={"ing-" + iff.id} className="hoy-item ingreso">
                <span>🎉 Hoy cobras: {iff.concepto}</span>
                <span className="gf-right">
                  {money(iff.importe)}
                  <button type="button" className="mini-btn" onClick={() => registrarIngresoRapido(iff)}>
                    Apuntar
                  </button>
                </span>
              </div>
            ))}
            {gastosHoy.map((gf) => (
              <div key={"gas-" + gf.id} className="hoy-item gasto">
                <span>💸 Hoy se te cobra: {gf.concepto}</span>
                <span className="gf-right">
                  {money(gf.importe)}
                  <button type="button" className="mini-btn" onClick={() => registrarRapido(gf)}>
                    Apuntar
                  </button>
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="selector-mes">
        <button type="button" className="mes-btn" onClick={mesAnterior}>‹</button>
        <span className="mes-actual" style={{ textTransform: "capitalize" }}>{nombreMes}</span>
        <button type="button" className="mes-btn" onClick={mesSiguiente}>›</button>
        {!esMesActual && (
          <button type="button" className="link-btn" style={{ marginLeft: 8 }} onClick={irAHoy}>
            volver a hoy
          </button>
        )}
      </div>

      <div className="card solo-imprimir">
        <strong style={{ textTransform: "capitalize" }}>Informe — {nombreMes}</strong>
        <table style={{ marginTop: 10, marginBottom: 16 }}>
          <thead>
            <tr>
              <th>Concepto</th>
              <th className="num">{nombreMes}</th>
              <th className="num" style={{ textTransform: "capitalize" }}>{nombreMesAnterior}</th>
              <th className="num">Diferencia</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Ingresos</td>
              <td className="num">{money(ingresosMes)}</td>
              <td className="num">{money(ingresosMesAnterior)}</td>
              <td className="num">{money(ingresosMes - ingresosMesAnterior)}</td>
            </tr>
            <tr>
              <td>Gastos</td>
              <td className="num">{money(gastosMes)}</td>
              <td className="num">{money(gastosMesAnterior)}</td>
              <td className="num">{money(gastosMes - gastosMesAnterior)}</td>
            </tr>
            <tr>
              <td>Ahorro real</td>
              <td className="num">{money(ahorroRealMes)}</td>
              <td className="num">{money(ahorroMesAnterior)}</td>
              <td className="num">{money(ahorroRealMes - ahorroMesAnterior)}</td>
            </tr>
          </tbody>
        </table>

        <strong>En qué se ha ido el dinero este mes</strong>
        {totalTarta === 0 ? (
          <p className="subtitle">Todavía no hay gastos este mes.</p>
        ) : (
          <div className="tarta-wrap">
            <svg viewBox="0 0 180 180" width="180" height="180">
              {pathsTarta(sliceTarta, 180).map((p, i) => (
                <path key={i} d={p.d} fill={p.color} />
              ))}
            </svg>
            <div className="tarta-leyenda">
              {sliceTarta.map((sl, i) => (
                <div key={i} className="tarta-leyenda-item">
                  <span className="tarta-punto" style={{ background: sl.color }} />
                  <span style={{ flex: 1 }}>{sl.label}</span>
                  <span>{money(sl.value)}</span>
                  <span className="subtitle" style={{ minWidth: 40, textAlign: "right" }}>
                    {((sl.value / totalTarta) * 100).toFixed(0)}%
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className={"card resumen-mes" + (enMeta ? " en-meta" : " fuera-meta")}>
        <div className="resumen-mes-header">
          <strong>Tu presupuesto de este mes</strong>
          <span className={"pill" + (enMeta ? " verde" : " rojo")}>
            {enMeta ? "Vas dentro de presupuesto" : "Te has pasado"}
          </span>
        </div>

        <div className="presupuesto-linea">
          <span>
            Ingresos previstos
            {!editandoIngPrevistos && (
              <button
                type="button"
                className="link-btn"
                style={{ marginLeft: 6 }}
                onClick={() => {
                  setIngPrevistosInput(String(ingresosPrevistos));
                  setEditandoIngPrevistos(true);
                }}
              >
                editar
              </button>
            )}
          </span>
          <span>{money(ingresosPrevistos)}</span>
        </div>
        {overrideMes && !editandoIngPrevistos && (
          <div className="var-item-bottom" style={{ marginTop: -6, marginBottom: 8 }}>
            Ajustado solo para {nombreMes} (normalmente {money(ingresosPrevistosDefault)})
          </div>
        )}
        {editandoIngPrevistos && (
          <div className="editar-saldo" style={{ marginBottom: 10 }}>
            <input
              type="number"
              step="0.01"
              value={ingPrevistosInput}
              onChange={(e) => setIngPrevistosInput(e.target.value)}
            />
            <button type="button" onClick={guardarIngresosPrevistosMes}>Guardar</button>
            {overrideMes && (
              <button
                type="button"
                className="link-btn"
                onClick={() => {
                  quitarOverrideIngresosMes();
                  setEditandoIngPrevistos(false);
                }}
              >
                usar el normal
              </button>
            )}
          </div>
        )}
        <div className="presupuesto-linea resta">
          <span>− Gastos fijos</span>
          <span>{money(gastosFijosPrevistos)}</span>
        </div>
        <div className="presupuesto-linea resta">
          <span>
            − Tu meta de ahorro
            {!editandoMeta && (
              <button
                type="button"
                className="link-btn"
                style={{ marginLeft: 6 }}
                onClick={() => {
                  setMetaMinInput(String(metaMin));
                  setMetaMaxInput(String(metaMax));
                  setEditandoMeta(true);
                }}
              >
                editar
              </button>
            )}
          </span>
          <span>{money(metaMin)}</span>
        </div>
        {editandoMeta && (
          <div className="editar-saldo" style={{ marginBottom: 10 }}>
            <input type="number" step="1" value={metaMinInput} onChange={(e) => setMetaMinInput(e.target.value)} />
            <span>—</span>
            <input type="number" step="1" value={metaMaxInput} onChange={(e) => setMetaMaxInput(e.target.value)} />
            <button type="button" onClick={guardarMeta}>Guardar</button>
          </div>
        )}
        <div className="presupuesto-linea total">
          <span>= Disponible para gastar</span>
          <span>{money(disponibleParaGastar)}</span>
        </div>

        <div style={{ marginTop: 16 }}>
          <div className="var-item-top">
            <span>Gastado hasta ahora</span>
            <span className={restaDisponible < 0 ? "var-resta negativo" : "var-resta"}>
              {restaDisponible < 0
                ? `Te has pasado ${money(Math.abs(restaDisponible))}`
                : `Te quedan ${money(restaDisponible)}`}
            </span>
          </div>
          <div className="barra-fondo">
            <div
              className={"barra-relleno" + (restaDisponible < 0 ? " excedido" : "")}
              style={{ width: `${porcentajeDisponible}%` }}
            />
          </div>
          <div className="var-item-bottom">
            {money(gastadoVariableReal)} de {money(disponibleParaGastar)}
          </div>
          {proyeccionVariable !== null && (
            <div className={"proyeccion" + (proyeccionVariable > disponibleParaGastar ? " mal" : "")}>
              Al ritmo que vas, acabarás el mes habiendo gastado unos <strong>{money(proyeccionVariable)}</strong>
              {proyeccionVariable > disponibleParaGastar
                ? ` — te pasarías ${money(proyeccionVariable - disponibleParaGastar)}.`
                : ` — te sobrarían ${money(disponibleParaGastar - proyeccionVariable)}.`}
            </div>
          )}
        </div>

        <div className="ahorro-real-linea">
          Ahorro real hasta ahora (ingresos − gastos que ya has metido): <strong>{money(ahorroRealMes)}</strong>
        </div>
      </div>

      {mesesEvolucion.length > 0 && (
        <div className="card">
          <strong>Tu ahorro mes a mes</strong>
          <p className="subtitle" style={{ margin: "6px 0 12px" }}>
            Ingresos menos gastos de cada mes. La raya marca tu meta ({money(metaMin)}).
          </p>
          <div className="evolucion">
            {mesesEvolucion.map((mes) => {
              const ancho = (Math.abs(mes.ahorro) / maxEscalaAhorro) * 100;
              const cumple = mes.ahorro >= metaMin;
              return (
                <div
                  key={mes.nombre + mes.fecha.getFullYear()}
                  className={"evo-fila" + (indiceMes(mes.fecha) === indiceMes(mesSeleccionado) ? " actual" : "")}
                  title={`${mes.fecha.toLocaleDateString("es-ES", { month: "long", year: "numeric" })}: ${money(mes.ahorro)}`}
                >
                  <span className="evo-mes">{mes.nombre}</span>
                  <div className="evo-pista">
                    <div
                      className={"evo-barra" + (mes.ahorro < 0 ? " negativa" : cumple ? " cumple" : "")}
                      style={{ width: `${ancho}%` }}
                    />
                    <div className="evo-meta" style={{ left: `${(metaMin / maxEscalaAhorro) * 100}%` }} />
                  </div>
                  <span className="evo-valor">
                    {money(mes.ahorro)} {cumple ? "✓" : ""}
                  </span>
                </div>
              );
            })}
          </div>
          <div className="ahorro-real-linea">
            Llevas ahorrado en {mesSeleccionado.getFullYear()}: <strong>{money(ahorroAnio)}</strong>
            {metaAnio > 0 && (
              <>
                {" "}de {money(metaAnio)} que te habías propuesto
                {ahorroAnio >= metaAnio
                  ? ` (vas ${money(ahorroAnio - metaAnio)} por encima).`
                  : ` (te faltan ${money(metaAnio - ahorroAnio)}).`}
              </>
            )}
          </div>
        </div>
      )}

      <div className="card">
        <strong>Gastos fijos de este mes</strong>
        <p className="subtitle" style={{ margin: "6px 0 12px" }}>
          Toca uno pendiente para apuntarlo con un clic (usa el importe de siempre y la fecha de hoy).
        </p>
        {gastosFijosConEstado.map((gf) => (
          <div key={gf.id} className={"gf-item" + (gf.registrado ? " ok" : "")}>
            <span>
              {gf.registrado ? "✓" : "○"} {gf.concepto}{" "}
              <span className="dia">
                {gf.dia && `· día ${gf.dia}`}
                {gf.meses_alternos_desde && " · mes sí, mes no"}
              </span>
            </span>
            <span className="gf-right">
              {money(gf.importe)}
              {!gf.registrado && (
                <button type="button" className="mini-btn" onClick={() => registrarRapido(gf)}>
                  Apuntar
                </button>
              )}
            </span>
          </div>
        ))}
      </div>

      <div className="card">
        <strong>Gastos variables de este mes</strong>
        <p className="subtitle" style={{ margin: "6px 0 12px" }}>
          Ordenado de más a menos gastado. Toca una categoría para ver sus gastos.
        </p>
        {variablesConGasto.map((cat) => {
          const abierta = categoriaAbiertaId === cat.id;
          return (
            <div key={cat.id} className="var-item">
              <button
                type="button"
                className="var-item-clicable"
                onClick={() => setCategoriaAbiertaId(abierta ? null : cat.id)}
              >
                <div className="var-item-top">
                  <span>{abierta ? "▾" : "▸"} {cat.concepto}</span>
                  {cat.tieneMaximo ? (
                    <span className={cat.resta < 0 ? "var-resta negativo" : "var-resta"}>
                      {cat.resta < 0
                        ? `Te has pasado ${money(Math.abs(cat.resta))}`
                        : `Te quedan ${money(cat.resta)}`}
                    </span>
                  ) : (
                    <span className="var-resta neutro">Llevas {money(cat.gastado)}</span>
                  )}
                </div>
                {cat.tieneMaximo && (
                  <div className="barra-fondo">
                    <div
                      className={"barra-relleno" + (cat.resta < 0 ? " excedido" : "")}
                      style={{ width: `${cat.porcentaje}%` }}
                    />
                  </div>
                )}
                <div className="var-item-bottom">
                  {cat.indice === -1
                    ? "Tócalo para verlos y ponles categoría con el lápiz ✎ en Movimientos"
                    : cat.tieneMaximo
                    ? `${money(cat.gastado)} de ${money(cat.importe)}`
                    : "Sin máximo"}
                  {cat.indice !== -1 && cat.media > 0 && (
                    <span className={"comparativa" + (cat.gastado > cat.media ? " sube" : " baja")}>
                      {" · "}tu media: {money(cat.media)} (
                      {cat.gastado > cat.media ? "+" : "−"}
                      {money(Math.abs(cat.gastado - cat.media))})
                    </span>
                  )}
                </div>
              </button>
              {abierta && (
                <div className="var-desplegable">
                  {cat.movimientos.length === 0 ? (
                    <div className="var-item-bottom">Todavía no has metido ningún gasto aquí este mes.</div>
                  ) : (
                    cat.movimientos.map((m) => (
                      <div key={m.id} className="var-mov-item">
                        <span>{new Date(m.fecha).toLocaleDateString("es-ES")} · {m.concepto}</span>
                        <span>{money(m.gasto)}</span>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="card no-imprimir">
        <strong>Añadir movimiento</strong>
        <form className="nuevo" onSubmit={guardarMovimiento}>
          <div className="tipo-toggle">
            <button type="button" className={tipo === "gasto" ? "activo gasto" : ""} onClick={() => setTipo("gasto")}>
              Gasto
            </button>
            <button type="button" className={tipo === "ingreso" ? "activo ingreso" : ""} onClick={() => setTipo("ingreso")}>
              Ingreso
            </button>
          </div>
          <div>
            <label>Fecha</label>
            <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} />
          </div>
          <div>
            <label>Importe (€)</label>
            <input type="number" step="0.01" placeholder="0.00" value={importe} onChange={(e) => setImporte(e.target.value)} />
          </div>
          <div className="full">
            <label>Concepto</label>
            <input type="text" placeholder="p.ej. cena, gasolina, paro..." value={concepto} onChange={(e) => cambiarConcepto(e.target.value)} />
          </div>
          {tipo === "gasto" && (
            <div className="full">
              <label>Categoría</label>
              <SelectorCategoria
                value={categoria}
                onChange={(v) => {
                  setCategoria(v);
                  setCategoriaTocada(true);
                }}
                gastosFijos={gastosFijos}
                categorias={presupuestoVariable}
              />
            </div>
          )}
          <button type="submit">Añadir</button>
          {error && <div className="error-msg">{error}</div>}
        </form>
      </div>

      <div className="card">
        <div className="resumen-mes-header">
          <strong>Movimientos</strong>
          <button type="button" className="link-btn" onClick={() => setMostrarTodosMovs((v) => !v)}>
            {mostrarTodosMovs ? "ver solo este mes" : "ver todos"}
          </button>
        </div>
        <div className="tabla-scroll">
        <table>
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Concepto</th>
              <th className="num">Gasto</th>
              <th className="num">Ingreso</th>
              <th className="num">Saldo</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {listaMovsMostrada.map((m) =>
              movEditandoId === m.id ? (
                <FilaMovimientoEditable
                  key={m.id}
                  m={m}
                  gastosFijos={gastosFijos}
                  categorias={presupuestoVariable}
                  onGuardar={actualizarMovimiento}
                  onCancelar={() => setMovEditandoId(null)}
                />
              ) : (
                <tr key={m.id}>
                  <td style={{ whiteSpace: "nowrap" }}>{new Date(m.fecha).toLocaleDateString("es-ES", { day: "numeric", month: "numeric", year: "2-digit" })}</td>
                  <td>{m.concepto}</td>
                  <td className="num gasto">{Number(m.gasto) ? money(m.gasto) : ""}</td>
                  <td className="num ingreso">{Number(m.ingreso) ? money(m.ingreso) : ""}</td>
                  <td className="num saldo-col">{money(m.saldo)}</td>
                  <td className="acciones-mov">
                    <button type="button" className="mini-btn" aria-label="Editar" title="Editar" onClick={() => setMovEditandoId(m.id)}>
                      ✎
                    </button>{" "}
                    <button className="borrar" onClick={() => borrar(m.id)}>✕</button>
                  </td>
                </tr>
              )
            )}
            {!loading && listaMovsMostrada.length === 0 && (
              <tr>
                <td colSpan={6} style={{ color: "var(--color-muted)", padding: "16px 0" }}>
                  {mostrarTodosMovs
                    ? "Todavía no has añadido ningún movimiento."
                    : "No hay movimientos este mes."}
                </td>
              </tr>
            )}
          </tbody>
          <tfoot>
            <tr className="fila-totales">
              <td colSpan={2}>Total</td>
              <td className="num gasto">{money(totalGastoLista)}</td>
              <td className="num ingreso">{money(totalIngresoLista)}</td>
              <td colSpan={2}></td>
            </tr>
          </tfoot>
        </table>
        </div>
      </div>

      <div className="card no-imprimir">
        <button type="button" className="link-btn" onClick={() => setMostrarGestionVar((v) => !v)}>
          {mostrarGestionVar ? "Ocultar gestión de gastos variables" : "Gestionar mis categorías de gastos variables"}
        </button>
        {mostrarGestionVar && (
          <div style={{ marginTop: 12 }}>
            {presupuestoVariable.map((cat) => (
              <CategoriaEditable key={cat.id} cat={cat} onGuardar={actualizarCat} onBorrar={borrarCat} />
            ))}
            <form className="nuevo" onSubmit={anadirCat} style={{ marginTop: 16 }}>
              <div className="full">
                <label>Categoría nueva</label>
                <input
                  type="text"
                  value={nuevaCat.concepto}
                  onChange={(e) => setNuevaCat({ ...nuevaCat, concepto: e.target.value })}
                />
              </div>
              <div className="full">
                <label>Máximo al mes (€) — opcional</label>
                <input
                  type="number"
                  step="0.01"
                  placeholder="Déjalo vacío si no quieres límite"
                  value={nuevaCat.importe}
                  onChange={(e) => setNuevaCat({ ...nuevaCat, importe: e.target.value })}
                />
              </div>
              <button type="submit">Añadir categoría</button>
            </form>
          </div>
        )}
      </div>

      <div className="card no-imprimir">
        <button type="button" className="link-btn" onClick={() => setMostrarGestionIng((v) => !v)}>
          {mostrarGestionIng ? "Ocultar gestión de ingresos fijos" : "Gestionar mis ingresos fijos (el Paro, etc.)"}
        </button>
        {mostrarGestionIng && (
          <div style={{ marginTop: 12 }}>
            {ingresosFijos.map((iff) => (
              <GastoFijoEditable key={iff.id} gf={iff} onGuardar={actualizarIF} onBorrar={borrarIF} />
            ))}
            <form className="nuevo" onSubmit={anadirIF} style={{ marginTop: 16 }}>
              <div>
                <label>Concepto nuevo</label>
                <input
                  type="text"
                  value={nuevoIF.concepto}
                  onChange={(e) => setNuevoIF({ ...nuevoIF, concepto: e.target.value })}
                />
              </div>
              <div>
                <label>Importe (€)</label>
                <input
                  type="number"
                  step="0.01"
                  value={nuevoIF.importe}
                  onChange={(e) => setNuevoIF({ ...nuevoIF, importe: e.target.value })}
                />
              </div>
              <div className="full">
                <label>Día del mes</label>
                <input
                  type="text"
                  placeholder="p.ej. 10"
                  value={nuevoIF.dia}
                  onChange={(e) => setNuevoIF({ ...nuevoIF, dia: e.target.value })}
                />
              </div>
              <button type="submit">Añadir ingreso fijo</button>
            </form>
          </div>
        )}
      </div>

      <div className="card no-imprimir">
        <button type="button" className="link-btn" onClick={() => setMostrarGestion((v) => !v)}>
          {mostrarGestion ? "Ocultar gestión de gastos fijos" : "Gestionar mis gastos fijos (añadir, editar, borrar)"}
        </button>
        {mostrarGestion && (
          <div style={{ marginTop: 12 }}>
            {gastosFijos.map((gf) => (
              <GastoFijoEditable key={gf.id} gf={gf} conMesAlterno onGuardar={actualizarGF} onBorrar={borrarGF} />
            ))}
            <form className="nuevo" onSubmit={anadirGF} style={{ marginTop: 16 }}>
              <div>
                <label>Concepto nuevo</label>
                <input
                  type="text"
                  value={nuevoGF.concepto}
                  onChange={(e) => setNuevoGF({ ...nuevoGF, concepto: e.target.value })}
                />
              </div>
              <div>
                <label>Importe (€)</label>
                <input
                  type="number"
                  step="0.01"
                  value={nuevoGF.importe}
                  onChange={(e) => setNuevoGF({ ...nuevoGF, importe: e.target.value })}
                />
              </div>
              <div className="full">
                <label>Día del mes</label>
                <input
                  type="text"
                  placeholder="p.ej. 1, 1-5, variable..."
                  value={nuevoGF.dia}
                  onChange={(e) => setNuevoGF({ ...nuevoGF, dia: e.target.value })}
                />
              </div>
              <div className="full">
                <OpcionMesAlterno
                  valor={nuevoGF.meses_alternos_desde}
                  onChange={(v) => setNuevoGF({ ...nuevoGF, meses_alternos_desde: v })}
                />
              </div>
              <button type="submit">Añadir gasto fijo</button>
            </form>
          </div>
        )}
      </div>

      <div className="card no-imprimir">
        <strong>Exportar mis datos</strong>
        <p className="subtitle" style={{ margin: "6px 0 12px" }}>
          El Excel lleva el resumen del mes (ingresos, gastos fijos y gastos variables por categoría) y la lista de movimientos. El PDF es un informe con la comparativa del mes anterior y el gráfico de gastos.
        </p>
        <div style={{ display: "flex", gap: 10 }}>
          <button type="button" onClick={exportarExcel} style={{ flex: 1 }}>
            📊 Descargar Excel
          </button>
          <button type="button" onClick={exportarPDF} style={{ flex: 1 }}>
            🖨️ Exportar a PDF
          </button>
        </div>
      </div>
    </div>
  );
}

// "Mes sí, mes no": guarda el primer mes en que toca ("2026-09"), o null.
function OpcionMesAlterno({ valor, onChange }) {
  return (
    <div className="mes-alterno">
      <label className="check">
        <input
          type="checkbox"
          checked={!!valor}
          onChange={(e) => onChange(e.target.checked ? claveDeMes(new Date()) : null)}
        />
        Mes sí, mes no
      </label>
      {valor && (
        <label className="check">
          empezando en
          <input type="month" value={valor} onChange={(e) => onChange(e.target.value || null)} />
        </label>
      )}
    </div>
  );
}

function GastoFijoEditable({ gf, conMesAlterno, onGuardar, onBorrar }) {
  const [local, setLocal] = useState(gf);
  const cambiado =
    local.concepto !== gf.concepto ||
    Number(local.importe) !== Number(gf.importe) ||
    local.dia !== gf.dia ||
    (local.meses_alternos_desde || null) !== (gf.meses_alternos_desde || null);
  return (
    <div className="gf-editable">
      <input
        type="text"
        value={local.concepto}
        onChange={(e) => setLocal({ ...local, concepto: e.target.value })}
      />
      <input
        type="number"
        step="0.01"
        value={local.importe}
        onChange={(e) => setLocal({ ...local, importe: e.target.value })}
      />
      <input
        type="text"
        value={local.dia}
        onChange={(e) => setLocal({ ...local, dia: e.target.value })}
      />
      {cambiado && (
        <button type="button" className="mini-btn" onClick={() => onGuardar(local)}>
          Guardar
        </button>
      )}
      <button type="button" className="borrar" onClick={() => onBorrar(gf.id)}>✕</button>
      {conMesAlterno && (
        <div className="gf-alterno">
          <OpcionMesAlterno
            valor={local.meses_alternos_desde}
            onChange={(v) => setLocal({ ...local, meses_alternos_desde: v })}
          />
        </div>
      )}
    </div>
  );
}

function CategoriaEditable({ cat, onGuardar, onBorrar }) {
  const [local, setLocal] = useState(cat);
  const cambiado = local.concepto !== cat.concepto || Number(local.importe) !== Number(cat.importe);
  return (
    <div className="gf-editable cat-editable">
      <input
        type="text"
        value={local.concepto}
        onChange={(e) => setLocal({ ...local, concepto: e.target.value })}
      />
      <input
        type="number"
        step="0.01"
        placeholder="Sin máximo"
        value={Number(local.importe) ? local.importe : ""}
        onChange={(e) => setLocal({ ...local, importe: e.target.value })}
      />
      {cambiado && (
        <button type="button" className="mini-btn" onClick={() => onGuardar(local)}>
          Guardar
        </button>
      )}
      <button type="button" className="borrar" onClick={() => onBorrar(cat.id)}>✕</button>
    </div>
  );
}

function FilaMovimientoEditable({ m, gastosFijos, categorias, onGuardar, onCancelar }) {
  const categoriaInicial = categorias.some((c) => c.id === m.categoria_id)
    ? "cat-" + m.categoria_id
    : sugerirCategoria(m.concepto, gastosFijos, categorias);
  const [local, setLocal] = useState({
    fecha: m.fecha ? new Date(m.fecha).toISOString().slice(0, 10) : "",
    concepto: m.concepto,
    tipo: Number(m.gasto) > 0 ? "gasto" : "ingreso",
    importe: Number(m.gasto) > 0 ? m.gasto : m.ingreso,
    categoria: categoriaInicial,
  });
  const [aviso, setAviso] = useState("");
  function guardar() {
    const elegida = local.tipo === "gasto" ? resolverCategoria(local.categoria, local.concepto, gastosFijos) : null;
    if (local.tipo === "gasto" && !elegida) {
      setAviso("Elige una categoría para el gasto.");
      return;
    }
    onGuardar({
      ...local,
      id: m.id,
      concepto: elegida ? elegida.concepto : local.concepto,
      categoriaId: elegida ? elegida.categoriaId : null,
    });
  }
  return (
    <tr>
      <td colSpan={6}>
        <div className="fila-edit">
          <div className="tipo-toggle" style={{ marginBottom: 8 }}>
            <button
              type="button"
              className={local.tipo === "gasto" ? "activo gasto" : ""}
              onClick={() => setLocal({ ...local, tipo: "gasto" })}
            >
              Gasto
            </button>
            <button
              type="button"
              className={local.tipo === "ingreso" ? "activo ingreso" : ""}
              onClick={() => setLocal({ ...local, tipo: "ingreso" })}
            >
              Ingreso
            </button>
          </div>
          <input
            type="date"
            value={local.fecha}
            onChange={(e) => setLocal({ ...local, fecha: e.target.value })}
          />
          <input
            type="number"
            step="0.01"
            value={local.importe}
            onChange={(e) => setLocal({ ...local, importe: e.target.value })}
          />
          <input
            type="text"
            value={local.concepto}
            onChange={(e) => setLocal({ ...local, concepto: e.target.value })}
          />
          {local.tipo === "gasto" && (
            <SelectorCategoria
              value={local.categoria}
              onChange={(v) => setLocal({ ...local, categoria: v })}
              gastosFijos={gastosFijos}
              categorias={categorias}
            />
          )}
          {aviso && <div className="error-msg">{aviso}</div>}
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" onClick={guardar}>Guardar</button>
            <button type="button" className="link-btn" onClick={onCancelar}>Cancelar</button>
          </div>
        </div>
      </td>
    </tr>
  );
}
