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

// Horas operativas por dia de la semana — sin esto, comparar "facturacion
// promedio" de un lunes de 4,5h contra un sabado de 13h abierto hace ver al
// lunes mucho peor de lo que realmente es por hora trabajada. Es un
// supuesto, no un dato leido de ningun lado: si el horario real cambio,
// actualizar aca.
export const HORAS_OPERATIVAS = { Lun: 4.5, Mar: 12, Mié: 12, Jue: 12, Vie: 12, Sáb: 13, Dom: 13 };

function toISO(date) { return date.toISOString().slice(0, 10); }
function addDays(date, n) { const d = new Date(date); d.setUTCDate(d.getUTCDate() + n); return d; }
function mondayOf(date) {
  const d = new Date(date);
  const dow = d.getUTCDay();
  return addDays(d, dow === 0 ? -6 : -(dow - 1));
}
function hoyISO() { return new Date().toISOString().slice(0, 10); }
function ayerISO() { return toISO(addDays(new Date(hoyISO() + "T00:00:00Z"), -1)); }

function esLineaExcluida(d) {
  return !d.producto_id || d.producto_id.startsWith("combo-") ||
    d.producto_id === "togoo-fee" || (d.producto_nombre || "").includes("ToGoo") ||
    (d.producto_nombre || "").startsWith("Descuento");
}

function vacioProducto(nombre) {
  return { nombre, cantidad: 0, total: 0, porHora: new Map(), porDia: new Map() };
}

// ---------------------------------------------------------------------
// Un solo fetch (desde el primer dia con datos hasta ayer) y todo lo que
// necesitan las 4 pestañas se deriva de ahi en memoria — evita reconsultar
// Supabase por cada grafico.
// ---------------------------------------------------------------------
export async function cargarTodo() {
  const desde = PRIMER_DIA_CON_DATOS;
  const hasta = ayerISO();

  const [ventas, detalles] = await Promise.all([
    sbGet(`/ventas?select=id,fecha,hora,total_centavos,sale_mode,anulada&anulada=eq.false&fecha=gte.${desde}&fecha=lte.${hasta}&order=fecha.asc`),
    sbGet(`/detalle_venta?select=venta_id,producto_id,producto_nombre,cantidad,subtotal_centavos,fecha&fecha=gte.${desde}&fecha=lte.${hasta}`)
  ]);

  const ventaById = new Map(ventas.map((v) => [v.id, v]));

  // ---- dias, semanas, meses ----
  const fechasUnicas = [...new Set(ventas.map((v) => v.fecha))].sort();
  const primerLunes = mondayOf(new Date(desde + "T00:00:00Z"));
  const dias = fechasUnicas.map((fecha) => {
    const fechaDt = new Date(fecha + "T00:00:00Z");
    const dow = DIAS[fechaDt.getUTCDay()];
    const semanaIdx = Math.floor((fechaDt - primerLunes) / (7 * 86400000));
    return { fecha, dow, semana: "S" + (semanaIdx + 1), total: 0, count: 0 };
  });
  const diaByFecha = new Map(dias.map((d) => [d.fecha, d]));
  for (const v of ventas) {
    const d = diaByFecha.get(v.fecha);
    d.total += v.total_centavos;
    d.count += 1;
  }
  // Mes real (nombre corto), no relativo — usado para Jul vs Ago.
  for (const d of dias) {
    d.mesLabel = new Date(d.fecha + "T00:00:00Z").toLocaleDateString("es-ES", { month: "short", timeZone: "UTC" });
  }

  const semanas = [...new Set(dias.map((d) => d.semana))].sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));
  const totalPorSemana = new Map(semanas.map((s) => [s, 0]));
  for (const d of dias) totalPorSemana.set(d.semana, totalPorSemana.get(d.semana) + d.total);

  // ---- por dia de semana (crudo y ajustado por hora operativa) ----
  const porDiaSemana = new Map(DIAS.map((d) => [d, { total: 0, count: 0, dias: 0 }]));
  for (const d of dias) {
    const e = porDiaSemana.get(d.dow);
    e.total += d.total;
    e.count += d.count;
    e.dias += 1;
  }
  const promedioPorDiaSemana = DIAS.map((dow) => {
    const e = porDiaSemana.get(dow);
    const avg = e.dias > 0 ? e.total / e.dias : 0;
    return { dow, avgCentavos: avg, porHoraCentavos: avg / HORAS_OPERATIVAS[dow] };
  });

  // ---- Jul vs Ago (u otros dos meses, los que haya) por dia de semana ----
  const mesesPresentes = [...new Set(dias.map((d) => d.mesLabel))];
  const porMesDiaSemana = new Map(mesesPresentes.map((m) => [m, new Map(DIAS.map((d) => [d, { total: 0, dias: 0 }]))]));
  for (const d of dias) {
    const e = porMesDiaSemana.get(d.mesLabel).get(d.dow);
    e.total += d.total;
    e.dias += 1;
  }

  // ---- productos (por categoria) + su detalle por hora / por dia-semana ----
  const productosPorId = new Map();
  const porCategoria = new Map();
  const porHoraGlobal = new Map(); // hora -> {txn(set venta ids), sandwiches, bolleria, cafe, bebidas}
  const porHoraCategoria = new Map();

  function horaDe(ventaId) {
    const v = ventaById.get(ventaId);
    if (!v || v.sale_mode !== "normal" || !v.hora) return null;
    return Number(v.hora.slice(0, 2));
  }
  function dowDe(fecha) {
    return DIAS[new Date(fecha + "T00:00:00Z").getUTCDay()];
  }

  for (const d of detalles) {
    if (esLineaExcluida(d)) continue;
    const cat = CATEGORIA[d.producto_id] || "otros";
    if (cat === "otros") continue;

    const prod = productosPorId.get(d.producto_id) || vacioProducto(d.producto_nombre);
    prod.cantidad += d.cantidad;
    prod.total += d.subtotal_centavos;
    productosPorId.set(d.producto_id, prod);

    porCategoria.set(cat, (porCategoria.get(cat) || 0) + d.subtotal_centavos);

    const hora = horaDe(d.venta_id);
    if (hora != null) {
      prod.porHora.set(hora, (prod.porHora.get(hora) || 0) + d.cantidad);
      const eHora = porHoraCategoria.get(hora) || { sandwiches: 0, bolleria: 0, cafe: 0, bebidas: 0 };
      eHora[cat] += d.cantidad;
      porHoraCategoria.set(hora, eHora);
    }
    const dow = dowDe(d.fecha);
    prod.porDia.set(dow, (prod.porDia.get(dow) || 0) + d.cantidad);
  }

  // Transacciones e ingresos por hora — a nivel venta, no linea de detalle,
  // para que "hora pico de ventas" cuente tickets, no items sueltos.
  for (const v of ventas) {
    if (v.sale_mode !== "normal" || !v.hora) continue;
    const hora = Number(v.hora.slice(0, 2));
    const e = porHoraGlobal.get(hora) || { txn: 0, revenue: 0 };
    e.txn += 1;
    e.revenue += v.total_centavos;
    porHoraGlobal.set(hora, e);
  }

  const horas = [...porHoraGlobal.keys()].sort((a, b) => a - b);
  const porHora = horas.map((h) => ({
    hora: h,
    txn: porHoraGlobal.get(h).txn,
    revenue: porHoraGlobal.get(h).revenue,
    ...{ sandwiches: 0, bolleria: 0, cafe: 0, bebidas: 0 },
    ...(porHoraCategoria.get(h) || {})
  }));

  function productosDeCategoria(cat) {
    return [...productosPorId.entries()]
      .filter(([id]) => CATEGORIA[id] === cat)
      .map(([id, p]) => ({ id, nombre: p.nombre, cantidad: p.cantidad, total: p.total, porHora: p.porHora, porDia: p.porDia }))
      .sort((a, b) => b.total - a.total);
  }

  const productos = {
    sandwiches: productosDeCategoria("sandwiches"),
    bolleria: productosDeCategoria("bolleria"),
    cafe: productosDeCategoria("cafe"),
    bebidas: productosDeCategoria("bebidas")
  };

  // ---- franjas horarias (mañana / mediodia / tarde / noche) ----
  const FRANJAS = [
    { key: "manana", label: "Mañana", desde: 9, hasta: 12 },
    { key: "mediodia", label: "Mediodía", desde: 12, hasta: 15 },
    { key: "tarde", label: "Tarde", desde: 15, hasta: 18 },
    { key: "noche", label: "Noche", desde: 18, hasta: 21 }
  ];
  const slots = FRANJAS.map((f) => {
    const horasFranja = porHora.filter((h) => h.hora >= f.desde && h.hora < f.hasta);
    const txn = horasFranja.reduce((s, h) => s + h.txn, 0);
    const revenue = horasFranja.reduce((s, h) => s + h.revenue, 0);
    // producto que mas vende dentro de esta franja, entre todas las categorias
    let top = null;
    for (const cat of Object.values(productos)) {
      for (const p of cat) {
        const uds = [...p.porHora.entries()].filter(([h]) => h >= f.desde && h < f.hasta).reduce((s, [, c]) => s + c, 0);
        if (uds > 0 && (!top || uds > top.uds)) top = { nombre: p.nombre, uds };
      }
    }
    return { ...f, txn, revenue, top };
  });

  const kpis = {
    totalCentavos: dias.reduce((s, d) => s + d.total, 0),
    transacciones: ventas.length,
    dias: dias.length
  };
  kpis.ticketPromedioCentavos = kpis.transacciones > 0 ? kpis.totalCentavos / kpis.transacciones : 0;

  const mejorDia = dias.reduce((max, d) => (d.total > max.total ? d : max), dias[0] || { total: 0 });
  const diasSinLunes = dias.filter((d) => d.dow !== "Lun");
  const promedioSinLunes = diasSinLunes.length > 0 ? diasSinLunes.reduce((s, d) => s + d.total, 0) / diasSinLunes.length : 0;
  const peorDiaNormal = diasSinLunes.length > 0 ? diasSinLunes.reduce((min, d) => (d.total < min.total ? d : min), diasSinLunes[0]) : null;

  const horaPico = porHora.reduce((max, h) => (h.txn > (max?.txn || 0) ? h : max), null);
  const todosProductosOrdenados = [...productosPorId.entries()].map(([id, p]) => ({ id, nombre: p.nombre, cantidad: p.cantidad, total: p.total })).sort((a, b) => b.total - a.total);
  const producto1 = todosProductosOrdenados[0] || null;

  return {
    desde, hasta,
    dias, semanas, totalPorSemana,
    porDiaSemana, promedioPorDiaSemana,
    porMesDiaSemana,
    productos, todosProductosOrdenados,
    porHora, slots,
    porCategoria,
    kpis, mejorDia, promedioSinLunes, peorDiaNormal, horaPico, producto1
  };
}
