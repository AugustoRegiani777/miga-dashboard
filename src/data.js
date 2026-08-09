import { sbGet } from "./supabase.js";

// Catalogo local (nombre -> categoria). No sincronizado en Supabase (el
// catalogo vive en el codigo de miga-pos-v2, es identico en todos los
// dispositivos vía seed) — se copia aca solo lo necesario para agrupar por
// categoria en los graficos.
export const CATEGORIA = {
  "jamon-queso": "sandwiches", "pasta-oliva-queso": "sandwiches", "pimiento-gouda-philp": "sandwiches",
  "pesto-tomate-queso": "sandwiches", "berenjena-brie": "sandwiches", "jamon-serrano-rucula": "sandwiches",
  "atun-palta-queso": "sandwiches", "huevo-jamon": "sandwiches", "huevo-queso": "sandwiches",
  "especial-semanal": "sandwiches", "promo-bebida": "sandwiches", "promo-cafe-con-leche": "sandwiches",
  "croissant": "bolleria", "mini-croissant": "bolleria", "mini-croissant-ddl": "bolleria",
  "pain-au-chocolat": "bolleria", "chipa": "bolleria", "alfajor-havana": "bolleria", "cookies": "bolleria", "medialunas": "bolleria",
  "expresso-30ml": "cafe", "cortado": "cafe", "latte": "cafe", "cafe-con-leche": "cafe", "capuccino": "cafe",
  "americano": "cafe", "flat-white": "cafe", "ice-latte": "cafe", "ice-caramel": "cafe",
  "cerveza": "bebidas", "coca-cola": "bebidas", "sprite": "bebidas", "nestea": "bebidas", "aquiaros": "bebidas", "jugo": "bebidas", "agua": "bebidas"
};

const DIAS = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
export const PRIMER_DIA_CON_DATOS = "2026-07-02";

function toISO(date) {
  return date.toISOString().slice(0, 10);
}

function addDays(date, n) {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + n);
  return d;
}

function mondayOf(date) {
  const d = new Date(date);
  const dow = d.getUTCDay(); // 0=domingo
  const back = dow === 0 ? 6 : dow - 1;
  return addDays(d, -back);
}

// "Ayer" es siempre el limite superior: el dia en curso todavia se esta
// generando, no se cuenta en ninguna metrica (evita un final de grafico
// enganoso que en realidad es solo "todavia no termino el dia").
export function rangoPara(preset) {
  const hoyUTC = new Date(new Date().toISOString().slice(0, 10) + "T00:00:00Z");
  const ayer = addDays(hoyUTC, -1);

  if (preset === "semana") {
    const desde = mondayOf(hoyUTC);
    return { desde: toISO(desde), hasta: toISO(ayer) };
  }
  if (preset === "semana-pasada") {
    const desde = addDays(mondayOf(hoyUTC), -7);
    const hasta = addDays(desde, 6);
    return { desde: toISO(desde), hasta: toISO(hasta) };
  }
  if (preset === "mes") {
    const desde = new Date(Date.UTC(hoyUTC.getUTCFullYear(), hoyUTC.getUTCMonth(), 1));
    return { desde: toISO(desde), hasta: toISO(ayer) };
  }
  // "todo"
  return { desde: PRIMER_DIA_CON_DATOS, hasta: toISO(ayer) };
}

// Periodo inmediatamente anterior, misma duracion, para las comparaciones
// "vs periodo anterior" del panel de KPIs.
export function rangoAnterior({ desde, hasta }) {
  const d1 = new Date(desde + "T00:00:00Z");
  const d2 = new Date(hasta + "T00:00:00Z");
  const dias = Math.round((d2 - d1) / 86400000) + 1;
  const nuevaHasta = addDays(d1, -1);
  const nuevaDesde = addDays(nuevaHasta, -(dias - 1));
  return { desde: toISO(nuevaDesde), hasta: toISO(nuevaHasta) };
}

function esLineaExcluida(d) {
  return !d.producto_id || d.producto_id === "combo-6" || d.producto_id === "combo-12" ||
    d.producto_id === "togoo-fee" || (d.producto_nombre || "").includes("ToGoo") ||
    (d.producto_nombre || "").startsWith("Descuento");
}

export async function cargarDatos({ desde, hasta }) {
  const [ventas, detalles] = await Promise.all([
    sbGet(`/ventas?select=id,fecha,hora,total_centavos,sale_mode,anulada&anulada=eq.false&fecha=gte.${desde}&fecha=lte.${hasta}&order=fecha.asc`),
    sbGet(`/detalle_venta?select=venta_id,producto_id,producto_nombre,cantidad,subtotal_centavos,fecha&fecha=gte.${desde}&fecha=lte.${hasta}`)
  ]);

  const kpis = { totalCentavos: 0, transacciones: ventas.length, togooCentavos: 0 };
  const porDiaMap = new Map();
  const porDiaSemanaMap = new Map();
  for (const v of ventas) {
    kpis.totalCentavos += v.total_centavos;
    if (v.sale_mode === "togoo") kpis.togooCentavos += v.total_centavos;

    const eDia = porDiaMap.get(v.fecha) || { total: 0, count: 0 };
    eDia.total += v.total_centavos;
    eDia.count += 1;
    porDiaMap.set(v.fecha, eDia);

    const dow = DIAS[new Date(v.fecha + "T00:00:00Z").getUTCDay()];
    const eSem = porDiaSemanaMap.get(dow) || { total: 0, count: 0 };
    eSem.total += v.total_centavos;
    eSem.count += 1;
    porDiaSemanaMap.set(dow, eSem);
  }
  kpis.ticketPromedioCentavos = kpis.transacciones > 0 ? kpis.totalCentavos / kpis.transacciones : 0;

  const porProductoMap = new Map();
  const porCategoriaMap = new Map();
  for (const d of detalles) {
    if (esLineaExcluida(d)) continue;
    const eProd = porProductoMap.get(d.producto_id) || { nombre: d.producto_nombre, cantidad: 0, total: 0 };
    eProd.cantidad += d.cantidad;
    eProd.total += d.subtotal_centavos;
    porProductoMap.set(d.producto_id, eProd);

    const cat = CATEGORIA[d.producto_id] || "otros";
    porCategoriaMap.set(cat, (porCategoriaMap.get(cat) || 0) + d.subtotal_centavos);
  }

  const porHoraMap = new Map();
  for (const v of ventas) {
    if (v.sale_mode !== "normal" || !v.hora) continue;
    const hora = Number(v.hora.slice(0, 2));
    porHoraMap.set(hora, (porHoraMap.get(hora) || 0) + 1);
  }

  // Todos los productos ordenados por facturacion — el panel de ranking solo
  // muestra los primeros N, pero el panel de cafe/alfajor/medialuna necesita
  // poder encontrar un producto puntual aunque no este entre los mas
  // vendidos, asi que se devuelve la lista completa.
  const todosLosProductos = [...porProductoMap.entries()]
    .map(([id, v]) => ({ id, ...v }))
    .sort((a, b) => b.total - a.total);

  return {
    kpis,
    porDia: [...porDiaMap.entries()].sort((a, b) => a[0].localeCompare(b[0])),
    porDiaSemana: DIAS.map((d) => [d, porDiaSemanaMap.get(d) || { total: 0, count: 0 }]),
    topProductos: todosLosProductos.slice(0, 8),
    todosLosProductos,
    porCategoria: porCategoriaMap,
    porHora: [...porHoraMap.entries()].sort((a, b) => a[0] - b[0])
  };
}

// Mezcla de categorias por semana, para el grafico apilado — pide un rango
// mas largo por separado porque agrupa distinto (por semana, no por dia).
export async function cargarMezclaCategorias(nSemanas = 4) {
  const hoyUTC = new Date(new Date().toISOString().slice(0, 10) + "T00:00:00Z");
  const desde = addDays(mondayOf(hoyUTC), -7 * nSemanas);
  const hasta = addDays(hoyUTC, -1);
  const detalles = await sbGet(
    `/detalle_venta?select=producto_id,producto_nombre,subtotal_centavos,fecha&fecha=gte.${toISO(desde)}&fecha=lte.${toISO(hasta)}`
  );
  const porSemana = new Map();
  for (const d of detalles) {
    if (esLineaExcluida(d)) continue;
    const cat = CATEGORIA[d.producto_id] || "otros";
    if (cat === "otros") continue;
    const fecha = new Date(d.fecha + "T00:00:00Z");
    const inicio = toISO(mondayOf(fecha));
    const e = porSemana.get(inicio) || {};
    e[cat] = (e[cat] || 0) + d.subtotal_centavos;
    porSemana.set(inicio, e);
  }
  return [...porSemana.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}
