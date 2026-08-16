import { sbGet } from "./supabase.js";

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
function fmtCorta(iso) { const [, m, d] = iso.split("-"); return `${d}/${m}`; }

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
// necesitan las pestañas se deriva de ahi en memoria — evita reconsultar
// Supabase por cada grafico.
// ---------------------------------------------------------------------
export async function cargarTodo() {
  const desde = PRIMER_DIA_CON_DATOS;
  const hasta = ayerISO();

  const hoy = hoyISO();
  const [ventas, detalles, productosSupabase, produccionRaw, movimientosRaw, stockActualRaw] = await Promise.all([
    sbGet(`/ventas?select=id,fecha,hora,total_centavos,sale_mode,anulada&anulada=eq.false&fecha=gte.${desde}&fecha=lte.${hasta}&order=fecha.asc,id.asc`),
    sbGet(`/detalle_venta?select=venta_id,producto_id,producto_nombre,cantidad,subtotal_centavos,fecha&fecha=gte.${desde}&fecha=lte.${hasta}`),
    sbGet(`/productos?select=id,categoria_id,nombre,controla_stock`),
    sbGet(`/produccion_diaria?select=producto_id,fecha,cantidad&fecha=gte.${desde}&fecha=lte.${hasta}`),
    // Ledger COMPLETO de movimientos_stock (venta/produccion/ajuste/devolucion,
    // sin filtrar por tipo) hasta HOY inclusive — es el registro autentico
    // de cada cambio real de stock, se usa para anclar el arrastre contra la
    // realidad en vez de reconstruirlo a ciegas desde una suposicion.
    sbGet(`/movimientos_stock?select=producto_id,tipo,cantidad,motivo,fecha,creado_en&fecha=gte.${desde}&fecha=lte.${hoy}`),
    sbGet(`/stock_productos?select=id,stock_actual`)
  ]);

  // Categoria/nombre por producto, leidos en vivo de la tabla real (antes
  // era un mapeo copiado a mano acá, que se desincronizaba si el catalogo
  // cambiaba del lado de la app y nadie se acordaba de actualizar la copia).
  const CATEGORIA = new Map(productosSupabase.map((p) => [p.id, p.categoria_id]));
  const NOMBRE_PRODUCTO = new Map(productosSupabase.map((p) => [p.id, p.nombre]));
  const CONTROLA_STOCK = new Map(productosSupabase.map((p) => [p.id, p.controla_stock]));

  const ventaById = new Map(ventas.map((v) => [v.id, v]));

  // ---- dias, semanas ----
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

  const semanas = [...new Set(dias.map((d) => d.semana))].sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));

  // Metadata de cada semana (lunes/domingo reales por aritmetica, no por el
  // primer/ultimo dia CON VENTAS — asi una semana con el lunes cerrado
  // igual arranca bien). El mes de la semana es el mes del lunes: una
  // semana que cruza fin de mes (ej. S4 con dias de agosto) pertenece
  // entera al mes en que arrancó, a proposito.
  const semanaMetaBase = new Map(semanas.map((s) => {
    const idx = Number(s.slice(1)) - 1;
    const lunes = addDays(primerLunes, idx * 7);
    const domingo = addDays(lunes, 6);
    const mesLabel = lunes.toLocaleDateString("es-ES", { month: "short", timeZone: "UTC" });
    return [s, { lunes: toISO(lunes), domingo: toISO(domingo), mesLabel }];
  }));

  // Semana DENTRO del mes (S1, S2... arranca de nuevo en cada mes) — para
  // poder comparar "sábado S1 julio" contra "sábado S1 agosto" en vez de
  // solo semanas globales que no se alinean entre meses. "semana" (arriba)
  // sigue siendo la clave global única, esto es solo para mostrar/agrupar.
  const semanaDelMesIdx = new Map(); // semana global -> indice 1-based dentro del mes
  {
    const contadorPorMes = new Map();
    for (const s of semanas) {
      const mesLabel = semanaMetaBase.get(s).mesLabel;
      const n = (contadorPorMes.get(mesLabel) || 0) + 1;
      contadorPorMes.set(mesLabel, n);
      semanaDelMesIdx.set(s, n);
    }
  }
  const semanaMeta = new Map(semanas.map((s) => {
    const { lunes, domingo, mesLabel } = semanaMetaBase.get(s);
    const semanaDelMes = `S${semanaDelMesIdx.get(s)}`;
    return [s, {
      lunes, domingo, mesLabel, semanaDelMes,
      label: `${semanaDelMes} ${mesLabel} (${fmtCorta(lunes)}–${fmtCorta(domingo)})`
    }];
  }));

  // Mes real por dia — ya NO es el mes calendario del propio dia, es el mes
  // de la semana a la que pertenece (ver semanaMeta arriba).
  for (const d of dias) {
    const meta = semanaMeta.get(d.semana);
    d.mesLabel = meta.mesLabel;
    d.semanaDelMes = meta.semanaDelMes;
  }

  const meses = [...new Set(semanas.map((s) => semanaMeta.get(s).mesLabel))];

  // Mismo dia-de-semana + misma semana-del-mes, comparado entre todos los
  // meses presentes (ej. "Sábado S1" en julio vs agosto) — la comparativa
  // mes-a-mes que pidió el dueño explicitamente, no solo semana global vs
  // semana global.
  const comparacionSemanaDelMes = new Map(); // "S1|Sáb" -> [{mesLabel, fecha, total}, ...]
  for (const d of dias) {
    const key = `${d.semanaDelMes}|${d.dow}`;
    const arr = comparacionSemanaDelMes.get(key) || [];
    arr.push({ mesLabel: d.mesLabel, fecha: d.fecha, total: d.total });
    comparacionSemanaDelMes.set(key, arr);
  }

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

  // ---- productos (por categoria) + su detalle por hora / por dia-semana / por dia ----
  const productosPorId = new Map();
  const porCategoria = new Map();
  const porHoraGlobal = new Map(); // hora -> {txn, revenue}
  const porHoraCategoria = new Map();
  const ventasPorProductoPorDia = new Map(); // fecha -> Map(productoId -> {nombre, cantidad, total})

  function horaDe(ventaId) {
    const v = ventaById.get(ventaId);
    if (!v || v.sale_mode !== "normal" || !v.hora) return null;
    return Number(v.hora.slice(0, 2));
  }
  function dowDe(fecha) {
    return DIAS[new Date(fecha + "T00:00:00Z").getUTCDay()];
  }

  for (const d of detalles) {
    // Si la venta no esta en ventaById es porque quedo afuera del fetch de
    // ventas (anulada=true) — sus lineas de detalle_venta NO se borran ni
    // se marcan cuando se deshace una venta, asi que sin este chequeo se
    // seguirian contando como vendidas para siempre.
    if (!ventaById.has(d.venta_id)) continue;
    if (esLineaExcluida(d)) continue;
    const cat = CATEGORIA.get(d.producto_id) || "otros";
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

    const porDiaMap = ventasPorProductoPorDia.get(d.fecha) || new Map();
    const curDia = porDiaMap.get(d.producto_id) || { nombre: d.producto_nombre, cantidad: 0, total: 0, categoria: cat };
    curDia.cantidad += d.cantidad;
    curDia.total += d.subtotal_centavos;
    porDiaMap.set(d.producto_id, curDia);
    ventasPorProductoPorDia.set(d.fecha, porDiaMap);
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
      .filter(([id]) => CATEGORIA.get(id) === cat)
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

  // =======================================================================
  // OPERACIÓN: producción, ToGoo itemizado y ajustes de stock, todo por día
  // =======================================================================

  // Producción por día y producto (ojo: produccion_diaria en Supabase solo
  // tiene historial desde el 17/07 — antes de eso queda vacío a proposito,
  // no hay forma de reconstruirlo).
  const produccionPorDia = new Map(); // fecha -> Map(productoId -> cantidad)
  for (const r of produccionRaw) {
    const m = produccionPorDia.get(r.fecha) || new Map();
    m.set(r.producto_id, (m.get(r.producto_id) || 0) + r.cantidad);
    produccionPorDia.set(r.fecha, m);
  }
  const primerDiaConProduccion = produccionRaw.length ? [...new Set(produccionRaw.map((r) => r.fecha))].sort()[0] : null;

  // ToGoo itemizado: las lineas reales (producto, cantidad) viven en
  // detalle_venta con subtotal 0 — la plata esta aparte, en la linea
  // "Tarifa ToGoo" (producto_id = togoo-fee). Se recorren TODAS las lineas
  // (sin el filtro esLineaExcluida, que las saca a proposito de las ventas
  // normales) de ventas cuyo sale_mode sea togoo.
  const togooPorDia = new Map(); // fecha -> Map(productoId -> {nombre, cantidad})
  const togooMontoPorDia = new Map(); // fecha -> centavos (tarifas)
  const togooPorProductoGlobal = new Map(); // productoId -> {nombre, cantidad}
  for (const d of detalles) {
    const v = ventaById.get(d.venta_id);
    if (!v || v.sale_mode !== "togoo") continue;
    if (d.producto_id === "togoo-fee") {
      togooMontoPorDia.set(d.fecha, (togooMontoPorDia.get(d.fecha) || 0) + d.subtotal_centavos);
      continue;
    }
    const nombreLimpio = (d.producto_nombre || "").replace(/ ToGoo$/, "");
    const mDia = togooPorDia.get(d.fecha) || new Map();
    const curDia = mDia.get(d.producto_id) || { nombre: nombreLimpio, cantidad: 0 };
    curDia.cantidad += d.cantidad;
    mDia.set(d.producto_id, curDia);
    togooPorDia.set(d.fecha, mDia);

    const curGlobal = togooPorProductoGlobal.get(d.producto_id) || { nombre: nombreLimpio, cantidad: 0 };
    curGlobal.cantidad += d.cantidad;
    togooPorProductoGlobal.set(d.producto_id, curGlobal);
  }

  // ToGoo histórico: días donde nunca se cargó una venta ToGoo real en
  // Supabase pero el TXT de cierre sí mostraba una salida ToGoo — se
  // reconstruyó a mano y se guardó como movimiento_stock con motivo dedicado
  // (ver carga de backfill). Se suma al MISMO togooPorDia/togooPorProductoGlobal
  // que el ToGoo real (nunca a los días que ya tienen venta real: eso
  // duplicaría la salida) para que ranking, % y el arrastre de stock lo
  // cuenten una sola vez, sea cual sea la fuente.
  for (const r of movimientosRaw) {
    if (!(r.motivo || "").startsWith("ToGoo historico")) continue;
    const nombreLimpio = NOMBRE_PRODUCTO.get(r.producto_id) || r.producto_id;
    const cantidad = Math.abs(r.cantidad);
    const mDia = togooPorDia.get(r.fecha) || new Map();
    const curDia = mDia.get(r.producto_id) || { nombre: nombreLimpio, cantidad: 0 };
    curDia.cantidad += cantidad;
    mDia.set(r.producto_id, curDia);
    togooPorDia.set(r.fecha, mDia);

    const curGlobal = togooPorProductoGlobal.get(r.producto_id) || { nombre: nombreLimpio, cantidad: 0 };
    curGlobal.cantidad += cantidad;
    togooPorProductoGlobal.set(r.producto_id, curGlobal);
  }

  const rankingTogoo = [...togooPorProductoGlobal.entries()]
    .map(([id, v]) => ({ id, nombre: v.nombre, cantidad: v.cantidad }))
    .sort((a, b) => b.cantidad - a.cantidad);
  const totalUnidadesTogoo = rankingTogoo.reduce((s, r) => s + r.cantidad, 0);
  const totalIngresosTogoo = [...togooMontoPorDia.values()].reduce((s, c) => s + c, 0);

  // % de ToGoo sobre produccion total de sandwiches — comparando ambos
  // lados en la MISMA ventana de fechas (la que tenga produccion_diaria),
  // para no inflar el porcentaje contra un ToGoo que arranca antes.
  let pctTogooSobreProduccion = null;
  if (primerDiaConProduccion) {
    const totalProducidoSandwiches = produccionRaw
      .filter((r) => CATEGORIA.get(r.producto_id) === "sandwiches")
      .reduce((s, r) => s + r.cantidad, 0);
    const togooSandwichesMismaVentana = [...togooPorDia.entries()]
      .filter(([fecha]) => fecha >= primerDiaConProduccion)
      .flatMap(([, m]) => [...m.entries()])
      .filter(([id]) => CATEGORIA.get(id) === "sandwiches")
      .reduce((s, [, v]) => s + v.cantidad, 0);
    pctTogooSobreProduccion = totalProducidoSandwiches > 0 ? (togooSandwichesMismaVentana / totalProducidoSandwiches) * 100 : null;
  }

  // Ajustes de stock por día (bajas/recuentos manuales) — solo para MOSTRAR
  // el detalle, filtrado del ledger completo de movimientos_stock.
  const ajustesPorDia = new Map(); // fecha -> [{productoId, nombre, cantidad, motivo, hora}]
  for (const r of movimientosRaw) {
    if (r.tipo !== "ajuste_stock" && r.tipo !== "ajuste_manual") continue;
    const arr = ajustesPorDia.get(r.fecha) || [];
    arr.push({
      productoId: r.producto_id,
      nombre: NOMBRE_PRODUCTO.get(r.producto_id) || r.producto_id,
      cantidad: r.cantidad,
      motivo: r.motivo || "",
      hora: (r.creado_en || "").slice(11, 16)
    });
    ajustesPorDia.set(r.fecha, arr);
  }

  const STOCK_ACTUAL = new Map(stockActualRaw.map((r) => [r.id, r.stock_actual]));

  // "Promo bebiba" / "Promo Cafe con leche" están catalogados como categoria
  // "sandwiches" (por precio/combo) pero nunca se producen — son bebidas de
  // regalo, no algo que sale del horno. controla_stock=false es la misma
  // bandera que usa la app (business.js) para esa distinción.
  const sandwichIds = productos.sandwiches.filter((p) => CONTROLA_STOCK.get(p.id) !== false).map((p) => p.id);

  // Ajustes de stock, por producto y por día — se usan tanto para mostrar el
  // desglose como para el ancla del arrastre.
  const ajustePorProductoPorDia = new Map(); // productoId -> Map(fecha -> suma)
  for (const [fecha, arr] of ajustesPorDia) {
    for (const a of arr) {
      const m = ajustePorProductoPorDia.get(a.productoId) || new Map();
      m.set(fecha, (m.get(fecha) || 0) + a.cantidad);
      ajustePorProductoPorDia.set(a.productoId, m);
    }
  }

  // Movimientos "raros" — todo lo que el ledger real tiene registrado que NO
  // sea venta/produccion/ajuste (ej. "devolucion" al deshacer una venta).
  // Estos SI son confiables tal cual vienen del ledger: a diferencia de
  // venta/produccion (que el backfill historico de TXT no siempre reflejo en
  // movimientos_stock — confirmado con huecos reales), "devolucion" solo lo
  // escribe la app en vivo al deshacer una venta, nunca un backfill.
  const otrosPorProductoPorDia = new Map(); // productoId -> Map(fecha -> suma)
  for (const r of movimientosRaw) {
    if (r.tipo === "venta" || r.tipo === "produccion" || r.tipo === "ajuste_stock" || r.tipo === "ajuste_manual") continue;
    const m = otrosPorProductoPorDia.get(r.producto_id) || new Map();
    m.set(r.fecha, (m.get(r.fecha) || 0) + r.cantidad);
    otrosPorProductoPorDia.set(r.producto_id, m);
  }

  // Movimiento neto de cada día, por producto — reconstruido desde las
  // fuentes ya verificadas a fondo contra los TXT reales (produccion_diaria,
  // detalle_venta para ventas y ToGoo), no desde movimientos_stock "venta"/
  // "produccion" — esos dos tipos del ledger tienen huecos reales en el
  // tramo con backfill historico (confirmado: el backfill de ventas nunca
  // escribio su espejo en movimientos_stock para varios dias de julio).
  // "ajuste" y "otros" (devolucion, etc.) SI se toman del ledger real.
  const movimientoNetoPorProductoPorDia = new Map(); // productoId -> Map(fecha -> {hoy,vendidos,togoo,ajuste,otros,estimado})
  for (const id of sandwichIds) {
    const porDia = new Map();
    for (const d of dias) {
      const fecha = d.fecha;
      const prodDiaReal = produccionPorDia.get(fecha) || new Map();
      const esEstimado = prodDiaReal.size === 0;
      const vendidos = ventasPorProductoPorDia.get(fecha)?.get(id)?.cantidad || 0;
      const togoo = togooPorDia.get(fecha)?.get(id)?.cantidad || 0;
      const ajuste = ajustePorProductoPorDia.get(id)?.get(fecha) || 0;
      const otros = otrosPorProductoPorDia.get(id)?.get(fecha) || 0;
      const hoy = esEstimado ? (vendidos + togoo) : (prodDiaReal.get(id) || 0);
      porDia.set(fecha, { hoy, vendidos, togoo, ajuste, otros, estimado: esEstimado });
    }
    movimientoNetoPorProductoPorDia.set(id, porDia);
  }

  // Ancla real por mes: el primer mes del rango arranca en 0 porque no hay
  // forma de saber el stock antes de PRIMER_DIA_CON_DATOS (ni el backfill
  // historico de TXT tiene ledger completo de ahi para atras). Pero a partir
  // del segundo mes, SÍ se puede calcular el stock real exacto al arrancar
  // ese mes: stock_actual de AHORA menos todo lo que registra el ledger
  // completo desde ese primer día — no es una suposición, es álgebra sobre
  // datos reales. Así cada mes nuevo (agosto en adelante) arranca limpio,
  // sin cargar el ruido de transcripción del backfill de julio.
  const primerDiaDeMes = new Map(); // mesLabel -> fecha del primer dia en `dias`
  for (const d of dias) if (!primerDiaDeMes.has(d.mesLabel)) primerDiaDeMes.set(d.mesLabel, d.fecha);
  const ledgerNetoDesde = new Map(); // productoId -> Map(fecha -> suma de movimientosRaw.cantidad desde esa fecha)
  function netoLedgerDesde(productoId, fechaDesde) {
    let key = ledgerNetoDesde.get(productoId);
    if (!key) { key = new Map(); ledgerNetoDesde.set(productoId, key); }
    if (key.has(fechaDesde)) return key.get(fechaDesde);
    const total = movimientosRaw.reduce((s, r) => (r.producto_id === productoId && r.fecha >= fechaDesde ? s + r.cantidad : s), 0);
    key.set(fechaDesde, total);
    return total;
  }
  // A veces ni el ancla exacta alcanza: si todavía falta algún movimiento
  // puntual en el ledger de esos primeros días (el mismo tipo de hueco que
  // ya se encontró y corrigió en otros casos), el ancla puede dar negativa
  // — imposible en la realidad — o el mes puede seguir tocando negativo un
  // par de días después de arrancar. En vez de dejar ese número imposible o
  // esconder el bache, se sube el ancla lo mínimo necesario y esa diferencia
  // queda registrada como "ajusteRecuento": un recuento explícito al cierre
  // del mes anterior, visible en vez de un salto raro sin explicación.
  const anclaPorProductoPorMes = new Map(); // productoId -> Map(mesLabel -> stock real al arrancar ese mes)
  const ajusteRecuentoPorProductoPorMes = new Map(); // productoId -> Map(mesLabel -> cuanto se subio el ancla, 0 si no hizo falta)
  for (const id of sandwichIds) {
    const anclas = new Map();
    const ajustes = new Map();
    const movDia = movimientoNetoPorProductoPorDia.get(id);
    for (const mes of meses.slice(1)) { // el primer mes no tiene ancla (ver arriba)
      const fechaInicio = primerDiaDeMes.get(mes);
      const stockAhora = STOCK_ACTUAL.get(id);
      if (stockAhora == null) { anclas.set(mes, null); ajustes.set(mes, 0); continue; }
      const anclaCruda = stockAhora - netoLedgerDesde(id, fechaInicio);

      let acumuladoDesdeAncla = 0;
      let minDentroDelMes = 0;
      for (const d of dias) {
        if (d.mesLabel !== mes) continue;
        const m = movDia.get(d.fecha);
        acumuladoDesdeAncla += m.hoy - m.vendidos - m.togoo + m.ajuste + m.otros;
        if (acumuladoDesdeAncla < minDentroDelMes) minDentroDelMes = acumuladoDesdeAncla;
      }
      const anclaMinimaNecesaria = -minDentroDelMes;
      const anclaFinal = Math.max(anclaCruda, anclaMinimaNecesaria, 0);
      anclas.set(mes, anclaFinal);
      ajustes.set(mes, anclaFinal - anclaCruda);
    }
    anclaPorProductoPorMes.set(id, anclas);
    ajusteRecuentoPorProductoPorMes.set(id, ajustes);
  }

  // Lista plana, solo lo que de verdad hizo falta ajustar — para mostrar en
  // la UI como "recuento al iniciar el mes", explícito y trazable.
  const recuentosInicioMes = []; // [{mesLabel, productoId, nombre, ajuste}]
  for (const id of sandwichIds) {
    for (const [mes, ajuste] of ajusteRecuentoPorProductoPorMes.get(id)) {
      if (ajuste > 0) recuentosInicioMes.push({ mesLabel: mes, productoId: id, nombre: NOMBRE_PRODUCTO.get(id) || id, ajuste });
    }
  }

  // Arrastre encadenado hacia adelante dentro de cada mes: julio (primer mes)
  // arranca en 0 y arrastra su imprecisión conocida SOLO dentro de julio —
  // agosto y los meses siguientes arrancan anclados al valor real calculado
  // arriba, no heredan el ruido de julio. Cada día suma lo producido y resta
  // lo que salió (vendido + ToGoo) más ajustes y "otros" del ledger. A
  // diferencia del anclado hacia atrás de una sola pieza (que forzaba el
  // ÚLTIMO día del rango ENTERO a calzar y podía esconder un error real de
  // cualquier día del medio) — acá cada día es una suma directa de
  // movimientos reales: si algo no fue trazado, se ve ese mismo día como un
  // salto raro en "quedan", no escondido.
  const quedanPorProductoPorDia = new Map(); // productoId -> Map(fecha -> quedan)
  for (const id of sandwichIds) {
    const movDia = movimientoNetoPorProductoPorDia.get(id);
    const anclaPorMes = anclaPorProductoPorMes.get(id);
    const porDia = new Map();
    let acumulado = 0;
    let mesActual = null;
    for (const d of dias) {
      if (d.mesLabel !== mesActual) {
        mesActual = d.mesLabel;
        const ancla = anclaPorMes.get(mesActual);
        if (ancla != null) acumulado = ancla;
      }
      const m = movDia.get(d.fecha);
      acumulado += m.hoy - m.vendidos - m.togoo + m.ajuste + m.otros;
      porDia.set(d.fecha, acumulado);
    }
    quedanPorProductoPorDia.set(id, porDia);
  }

  // Deriva contra el stock real de ahora (stock_productos): cuánto difiere
  // lo calculado del último día del rango respecto al conteo real actual.
  // No se usa para "corregir" el cálculo — se expone tal cual para que la
  // UI pueda mostrar la diferencia en vez de ocultarla.
  const derivaStockUltimoDia = new Map(); // productoId -> {calculado, real, diferencia}
  if (dias.length) {
    const ultimaFecha = dias[dias.length - 1].fecha;
    for (const id of sandwichIds) {
      const calculado = quedanPorProductoPorDia.get(id)?.get(ultimaFecha);
      const real = STOCK_ACTUAL.get(id);
      if (calculado == null || real == null) continue;
      derivaStockUltimoDia.set(id, { calculado, real, diferencia: real - calculado });
    }
  }

  // Producción vs ventas por sandwich: "quedan" es la suma corrida desde el
  // primer día (arriba). "sinExplicar" = "otros" del ledger (ej.
  // devoluciones) — se muestra aparte para que quede visible sin mezclarlo.
  const produccionVsVentasPorDia = new Map(); // fecha -> [{productoId, nombre, ayer, hoy, vendidos, togoo, ajuste, quedan, sinExplicar, estimado}]
  for (let i = 0; i < dias.length; i++) {
    const fecha = dias[i].fecha;
    const filas = [];
    for (const id of sandwichIds) {
      const quedanMap = quedanPorProductoPorDia.get(id);
      const quedan = quedanMap.get(fecha);
      const ayer = i === 0 ? null : quedanMap.get(dias[i - 1].fecha);
      const m = movimientoNetoPorProductoPorDia.get(id).get(fecha);
      filas.push({
        productoId: id, nombre: NOMBRE_PRODUCTO.get(id) || id,
        ayer, hoy: m.hoy, vendidos: m.vendidos, togoo: m.togoo, ajuste: m.ajuste,
        quedan, sinExplicar: m.otros, estimado: m.estimado
      });
    }
    produccionVsVentasPorDia.set(fecha, filas);
  }

  return {
    desde, hasta,
    dias, semanas, semanaMeta, meses, totalPorSemana,
    porDiaSemana, promedioPorDiaSemana,
    porMesDiaSemana, comparacionSemanaDelMes,
    productos, todosProductosOrdenados,
    porHora, slots,
    porCategoria,
    kpis, mejorDia, promedioSinLunes, peorDiaNormal, horaPico, producto1,
    // crudo por dia, para que la capa de UI arme cualquier vista (dia/semana/mes)
    ventasPorProductoPorDia,
    produccionPorDia, primerDiaConProduccion,
    togooPorDia, togooMontoPorDia, rankingTogoo, totalUnidadesTogoo, totalIngresosTogoo, pctTogooSobreProduccion,
    ajustesPorDia,
    produccionVsVentasPorDia, derivaStockUltimoDia, recuentosInicioMes,
    CATEGORIA, NOMBRE_PRODUCTO, sandwichIds
  };
}
