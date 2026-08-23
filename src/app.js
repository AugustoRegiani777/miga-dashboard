import { signIn, signOut, restoreSession, sbPost, sbDelete } from "./supabase.js";
import { cargarTodo, HORAS_OPERATIVAS } from "./data.js";
import {
  initTooltip, barChart, stackedBarChart, groupedBarChart, lineChart,
  rankingList, renderLegend, euros, pct, SERIES_COLORS, showTip, hideTip
} from "./charts.js";

const dom = {
  loginScreen: document.querySelector("#login-screen"),
  loginForm: document.querySelector("#login-form"),
  loginUsuario: document.querySelector("#login-usuario"),
  loginPassword: document.querySelector("#login-password"),
  loginSubmit: document.querySelector("#login-submit"),
  loginError: document.querySelector("#login-error"),
  dashboardScreen: document.querySelector("#dashboard-screen"),
  rangoSub: document.querySelector("#rango-sub"),
  footerRango: document.querySelector("#footer-rango"),
  logoutBtn: document.querySelector("#logout-btn"),
  tabsNav: document.querySelector("#tabs-nav"),
  loadingMsg: document.querySelector("#loading-msg"),
  stabsProductos: document.querySelector("#stabs-productos"),
  evForm: document.querySelector("#ev-form"),
  evFecha: document.querySelector("#ev-fecha"),
  evCategoria: document.querySelector("#ev-categoria"),
  evDescripcion: document.querySelector("#ev-descripcion"),
  evSubmit: document.querySelector("#ev-submit"),
  evError: document.querySelector("#ev-error"),
  evLista: document.querySelector("#ev-lista")
};

const DOW_ORDER = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
let datos = null;

// ---------- utilidades ----------
function fmtFecha(iso) {
  const [, m, d] = iso.split("-");
  return `${d}/${m}`;
}
function pctTexto(delta) { return `${delta >= 0 ? "+" : ""}${delta.toFixed(1)}%`; }
function insightHtml({ tone = "info", titulo, texto }) {
  return `<div class="insight tone-${tone}"><h4>${titulo}</h4><p>${texto}</p></div>`;
}

// ============================================================
// LOGIN
// ============================================================
function setLoginError(msg) {
  dom.loginError.textContent = msg || "";
  dom.loginError.hidden = !msg;
}
function showDashboard() { dom.loginScreen.hidden = true; dom.dashboardScreen.hidden = false; }
function showLogin() { dom.dashboardScreen.hidden = true; dom.loginScreen.hidden = false; }

async function handleLogin(event) {
  event.preventDefault();
  setLoginError(null);
  dom.loginSubmit.disabled = true;
  dom.loginSubmit.textContent = "Entrando…";
  try {
    await signIn(dom.loginUsuario.value, dom.loginPassword.value);
    showDashboard();
    await boot();
  } catch (error) {
    setLoginError(error.message || "No se pudo iniciar sesión.");
  } finally {
    dom.loginSubmit.disabled = false;
    dom.loginSubmit.textContent = "Entrar";
  }
}
function handleLogout() { signOut(); showLogin(); }

// ============================================================
// RESUMEN
// ============================================================
// KPIs de dias basicos (total, mejor/peor dia, promedio sin lunes) para un
// subconjunto cualquiera de `datos.dias` — se usa para acotar al mes en
// curso sin duplicar la logica de calculo.
function kpisDeDias(diasSubset) {
  const totalCentavos = diasSubset.reduce((s, d) => s + d.total, 0);
  const transacciones = diasSubset.reduce((s, d) => s + d.count, 0);
  const mejorDia = diasSubset.length ? diasSubset.reduce((max, d) => (d.total > max.total ? d : max)) : null;
  const diasSinLunes = diasSubset.filter((d) => d.dow !== "Lun");
  const peorDia = diasSinLunes.length ? diasSinLunes.reduce((min, d) => (d.total < min.total ? d : min)) : null;
  const promedioSinLunes = diasSinLunes.length ? diasSinLunes.reduce((s, d) => s + d.total, 0) / diasSinLunes.length : 0;
  return {
    totalCentavos, transacciones, dias: diasSubset.length,
    ticketPromedioCentavos: transacciones > 0 ? totalCentavos / transacciones : 0,
    mejorDia, peorDia, promedioSinLunes
  };
}

function diasDelMesActual() {
  const mesActual = datos.meses[datos.meses.length - 1];
  return { mesActual, diasMes: datos.dias.filter((d) => d.mesLabel === mesActual) };
}

// Semanas COMPLETAS (Lun-Dom ya terminado) — para records y rachas no
// conviene mezclar la semana en curso, que todavia no termino de jugar.
function semanasCompletas() {
  const { semanas, semanaMeta, hasta } = datos;
  return semanas.filter((s) => semanaMeta.get(s).domingo <= hasta);
}

function calcularHitos() {
  const { dias, mejorDia, producto1, kpis, totalPorSemana, semanaMeta } = datos;
  const completas = semanasCompletas();

  let semanaRecord = null;
  for (const s of completas) {
    const total = totalPorSemana.get(s);
    if (!semanaRecord || total > semanaRecord.total) semanaRecord = { semana: s, total };
  }

  let racha = 0;
  for (let i = completas.length - 1; i > 0; i--) {
    if (totalPorSemana.get(completas[i]) > totalPorSemana.get(completas[i - 1])) racha++;
    else break;
  }

  return { mejorDia, producto1, semanaRecord, racha, pctProducto1: producto1 ? Math.round((producto1.total / kpis.totalCentavos) * 100) : null, semanaMeta };
}

function renderHitos() {
  const h = calcularHitos();
  const items = [
    {
      label: "Mejor día de la historia",
      value: euros(h.mejorDia?.total || 0),
      detalle: h.mejorDia ? `${fmtFecha(h.mejorDia.fecha)} (${h.mejorDia.dow})` : "—"
    },
    {
      label: "Semana récord",
      value: h.semanaRecord ? euros(h.semanaRecord.total) : "—",
      detalle: h.semanaRecord ? h.semanaMeta.get(h.semanaRecord.semana).label : "—"
    },
    {
      label: "Racha de crecimiento",
      value: h.racha > 0 ? `${h.racha + 1} semanas` : "Sin racha activa",
      detalle: h.racha > 0 ? "creciendo semana a semana hasta la última completa" : "la última semana completa bajó vs. la anterior"
    },
    {
      label: "Producto que domina",
      value: h.producto1 ? h.producto1.nombre : "—",
      detalle: h.producto1 ? `${h.pctProducto1}% de toda la facturación histórica` : "—"
    }
  ];
  document.querySelector("#r-hitos").innerHTML = items.map((it) => `
    <div class="hito-card">
      <p class="h-label">${it.label}</p>
      <p class="h-value">${it.value}</p>
      <p class="h-detalle">${it.detalle}</p>
    </div>
  `).join("");
}

function renderResumen() {
  const { horaPico, promedioPorDiaSemana, porDiaSemana, dias } = datos;
  const { mesActual, diasMes } = diasDelMesActual();
  const k = kpisDeDias(diasMes);

  // Headline: mismo tramo de dias del mes anterior, para que "vs mes
  // anterior" compare manzanas con manzanas (no un mes completo contra uno
  // que recien arranca).
  const meses = datos.meses;
  const mesAnterior = meses.length > 1 ? meses[meses.length - 2] : null;
  let deltaMes = null;
  if (mesAnterior) {
    const diasMesAnteriorMismaAltura = dias.filter((d) => d.mesLabel === mesAnterior).slice(0, diasMes.length);
    const totalMesAnteriorMismaAltura = diasMesAnteriorMismaAltura.reduce((s, d) => s + d.total, 0);
    if (totalMesAnteriorMismaAltura > 0) deltaMes = ((k.totalCentavos - totalMesAnteriorMismaAltura) / totalMesAnteriorMismaAltura) * 100;
  }
  document.querySelector("#r-headline").innerHTML = deltaMes != null
    ? `${cap(mesActual)} lleva <strong>${euros(k.totalCentavos)}</strong> en ${k.dias} días — <strong>${pctTexto(deltaMes)}</strong> ${deltaMes >= 0 ? "más" : "menos"} que ${mesAnterior} a esta misma altura del mes.`
    : `${cap(mesActual)} lleva <strong>${euros(k.totalCentavos)}</strong> en ${k.dias} días.`;

  document.querySelector("#r-kpis").innerHTML = [
    { l: "Transacciones", v: String(k.transacciones), s: `ticket medio ${euros(k.ticketPromedioCentavos)}` },
    { l: "Mejor día del mes", v: euros(k.mejorDia?.total || 0), s: k.mejorDia ? `${fmtFecha(k.mejorDia.fecha)} (${k.mejorDia.dow})` : "—" },
    { l: "Promedio/día (sin lunes)", v: euros(k.promedioSinLunes), s: "martes a domingo" },
    { l: "Hora pico de ventas", v: horaPico ? `${horaPico.hora}:00h` : "—", s: horaPico ? `${horaPico.txn} transacciones (histórico)` : "" }
  ].map((k) => `<div class="kpi"><p class="label">${k.l}</p><p class="value">${k.v}</p><span class="delta"><span class="vs">${k.s}</span></span></div>`).join("");

  renderHitos();

  // Chicanas: patrones estructurales que se repiten siempre, no atados a
  // una fecha puntual — calculados, no escritos a mano.
  const lun = promedioPorDiaSemana.find((d) => d.dow === "Lun");
  const resto = promedioPorDiaSemana.filter((d) => d.dow !== "Lun");
  const restoPromHora = resto.reduce((s, d) => s + d.porHoraCentavos, 0) / resto.length;
  const mejorPorHora = [...promedioPorDiaSemana].sort((a, b) => b.porHoraCentavos - a.porHoraCentavos)[0];
  const entreSemana = promedioPorDiaSemana.filter((d) => !["Sáb", "Dom", "Lun"].includes(d.dow));
  const masFloja = [...entreSemana].sort((a, b) => a.porHoraCentavos - b.porHoraCentavos)[0];

  const finde = ["Sáb", "Dom"].map((d) => porDiaSemana.get(d));
  const totalSemanaCompleta = [...porDiaSemana.values()].reduce((s, e) => s + e.total, 0);
  const totalFinde = finde.reduce((s, e) => s + e.total, 0);
  const pctFacturacionFinde = totalSemanaCompleta > 0 ? (totalFinde / totalSemanaCompleta) * 100 : 0;
  const horasFinde = HORAS_OPERATIVAS.Sáb + HORAS_OPERATIVAS.Dom;
  const horasSemana = Object.values(HORAS_OPERATIVAS).reduce((s, h) => s + h, 0);
  const pctHorasFinde = (horasFinde / horasSemana) * 100;

  document.querySelector("#r-insights").innerHTML = [
    insightHtml({
      tone: "info",
      titulo: "Lunes, día atípico",
      texto: `Con horario reducido (${HORAS_OPERATIVAS.Lun}h), factura <strong>${euros(lun.porHoraCentavos)}/hora</strong> — el resto de la semana promedia <strong>${euros(restoPromHora)}/hora</strong>.`
    }),
    insightHtml({
      tone: "good",
      titulo: `${mejorPorHora.dow} lidera €/hora`,
      texto: `<strong>${euros(mejorPorHora.porHoraCentavos)}/hora</strong> de operación — el día más rentable por hora abierta.`
    }),
    insightHtml({
      tone: "warn",
      titulo: `${masFloja.dow}, el más flojo entre semana`,
      texto: `<strong>${euros(masFloja.porHoraCentavos)}/hora</strong>, el más bajo de martes a viernes.`
    }),
    insightHtml({
      tone: pctFacturacionFinde > pctHorasFinde * 1.3 ? "critical" : "info",
      titulo: "El finde concentra la facturación",
      texto: `Sábado y domingo generan <strong>${pctFacturacionFinde.toFixed(0)}%</strong> de la facturación semanal con solo <strong>${pctHorasFinde.toFixed(0)}%</strong> de las horas abiertas.`
    })
  ].join("");

  document.querySelector("#r-chart-dias-sub").textContent = `${cap(mesActual)} · con el fin de semana marcado`;
  barChart(document.querySelector("#r-chart-dias"), diasMes.map((d) => ({
    label: fmtFecha(d.fecha), value: d.total, flag: (d.dow === "Sáb" || d.dow === "Dom") ? "peak" : null
  })), { highlightKey: "peak", tooltipLine: (x) => `<b>${x.label}</b><br>${euros(x.value)}` });

  rankingList(document.querySelector("#r-rank-productos"), datos.todosProductosOrdenados.slice(0, 8));

  barChart(document.querySelector("#r-chart-dow"), resto.map((d) => ({ label: d.dow, value: d.avgCentavos })), {
    tooltipLine: (x) => `<b>${x.label}</b><br>${euros(x.value)} promedio`
  });

  barChart(document.querySelector("#r-chart-hora"), porHora.map((h) => ({ label: h.hora + "h", value: h.txn })), {
    tooltipLine: (x) => `<b>${x.label}</b><br>${x.value} transacciones`
  });
}

// ============================================================
// FACTURACIÓN
// ============================================================
let dowMode = "abs";
// Anomalias: dias que se despegaron mucho de lo que ese dia-de-semana
// factura normalmente (no el dia con mas/menos plata en absoluto — un
// martes que vendio como sabado, o un sabado que vendio como martes, es mas
// raro y mas interesante para investigar que otro dia mas del monton).
// direccion "alto" = picos, "bajo" = caidas. El contexto de 1-2 dias antes
// es para poder cruzarlo a mano con "que hicimos distinto" (posteo,
// feriado, partido, cierre imprevisto, etc.).
function detectarAnomalias(direccion, maxCards = 6, umbralPct = 35) {
  const { dias, promedioPorDiaSemana } = datos;
  const avgPorDow = new Map(promedioPorDiaSemana.map((d) => [d.dow, d.avgCentavos]));
  const candidatos = [];
  for (let i = 0; i < dias.length; i++) {
    const d = dias[i];
    if (d.dow === "Lun") continue; // horario reducido, no comparable
    const avg = avgPorDow.get(d.dow);
    if (!avg) continue;
    const deltaPct = ((d.total - avg) / avg) * 100;
    if (direccion === "alto" && deltaPct < umbralPct) continue;
    if (direccion === "bajo" && deltaPct > -umbralPct) continue;
    candidatos.push({
      fecha: d.fecha, dow: d.dow, total: d.total, deltaPct,
      diaAntes: dias[i - 1] || null,
      dosDiasAntes: dias[i - 2] || null
    });
  }
  const orden = direccion === "alto" ? (a, b) => b.deltaPct - a.deltaPct : (a, b) => a.deltaPct - b.deltaPct;
  return candidatos.sort(orden).slice(0, maxCards);
}

function eventoCardHtml(p, tono) {
  const signo = p.deltaPct >= 0 ? "+" : "";
  return `
    <div class="evento-card evento-card-${tono}">
      <span class="ec-dow">${p.dow}</span>
      <div class="ec-delta">${signo}${Math.round(p.deltaPct)}%</div>
      <p class="ec-total-label">vs. ${p.dow} típico</p>
      <p class="ec-fecha">${fmtFecha(p.fecha)}</p>
      <p class="ec-total">${euros(p.total)}</p>
      <div class="ec-contexto">
        <span class="ec-ctx-item">-2 días<b>${p.dosDiasAntes ? euros(p.dosDiasAntes.total) : "—"}</b></span>
        <span class="ec-ctx-item">-1 día<b>${p.diaAntes ? euros(p.diaAntes.total) : "—"}</b></span>
      </div>
    </div>
  `;
}

function renderEventosPicos() {
  const picos = detectarAnomalias("alto");
  const flojos = detectarAnomalias("bajo");

  const picosContainer = document.querySelector("#f-eventos-picos");
  picosContainer.innerHTML = picos.length
    ? picos.map((p) => eventoCardHtml(p, "alto")).join("")
    : `<p class="empty-msg">Todavía no hay días que se despeguen claramente de lo normal.</p>`;

  const flojosContainer = document.querySelector("#f-eventos-flojos");
  if (flojosContainer) {
    flojosContainer.innerHTML = flojos.length
      ? flojos.map((p) => eventoCardHtml(p, "bajo")).join("")
      : `<p class="empty-msg">Todavía no hay caídas claras respecto a lo normal.</p>`;
  }
}

function renderFacturacion() {
  const { promedioPorDiaSemana, dias, totalPorSemana, porMesDiaSemana, semanas } = datos;
  const { mesActual, diasMes } = diasDelMesActual();
  const k = kpisDeDias(diasMes);
  renderEventosPicos();

  document.querySelector("#f-alert").textContent =
    `El lunes abre con horario reducido (${HORAS_OPERATIVAS.Lun}h en vez de ${HORAS_OPERATIVAS.Mar}-${HORAS_OPERATIVAS.Sáb}h) — se marca aparte y queda fuera de los promedios generales.`;

  const mesesConDatos = [...porMesDiaSemana.keys()];
  const mesAnterior = mesesConDatos.length > 1 ? mesesConDatos[mesesConDatos.length - 2] : null;
  let deltaMes = null;
  if (mesAnterior) {
    const diasMesA = diasMes.filter((d) => d.dow !== "Lun");
    const diasMesB = dias.filter((d) => d.mesLabel === mesAnterior && d.dow !== "Lun");
    const avgA = diasMesA.reduce((s, d) => s + d.total, 0) / (diasMesA.length || 1);
    const avgB = diasMesB.reduce((s, d) => s + d.total, 0) / (diasMesB.length || 1);
    deltaMes = ((avgA - avgB) / avgB) * 100;
  }
  const mejorPorHora = [...promedioPorDiaSemana].sort((a, b) => b.porHoraCentavos - a.porHoraCentavos)[0];

  document.querySelector("#f-kpis").innerHTML = [
    { l: "Total", v: euros(k.totalCentavos), s: `${cap(mesActual)} · ${k.dias} días` },
    { l: "Promedio/día sin lunes", v: euros(k.promedioSinLunes) },
    { l: "Mejor día", v: euros(k.mejorDia?.total || 0), s: k.mejorDia ? `${fmtFecha(k.mejorDia.fecha)} (${k.mejorDia.dow})` : "—" },
    { l: "Peor día (sin lunes)", v: euros(k.peorDia?.total || 0), s: k.peorDia ? fmtFecha(k.peorDia.fecha) : "—" },
    { l: "Ticket medio", v: euros(k.ticketPromedioCentavos) },
    { l: "Mejor €/hora", v: mejorPorHora.dow, s: `${euros(mejorPorHora.porHoraCentavos)}/h` },
    deltaMes != null ? { l: `${mesActual} vs ${mesAnterior}`, v: pctTexto(deltaMes), s: "promedio diario, sin lunes" } : null
  ].filter(Boolean).map((k) => `<div class="kpi"><p class="label">${k.l}</p><p class="value">${k.v}</p>${k.s ? `<span class="delta"><span class="vs">${k.s}</span></span>` : ""}</div>`).join("");

  document.querySelector("#f-chart-dias-titulo").textContent = `Facturación diaria — ${cap(mesActual)}`;
  barChart(document.querySelector("#f-chart-dias"), diasMes.map((d) => ({
    label: fmtFecha(d.fecha), value: d.total, flag: (d.dow === "Sáb" || d.dow === "Dom") ? "peak" : (d.dow === "Lun" ? "lun" : null), dim: d.dow === "Lun"
  })), { highlightKey: "peak", tooltipLine: (x) => `<b>${x.label}</b><br>${euros(x.value)}` });

  barChart(document.querySelector("#f-chart-semanas"), semanas.map((s) => ({ label: s, value: totalPorSemana.get(s) })), {
    tooltipLine: (x) => `<b>Semana ${x.label}</b><br>${euros(x.value)}`
  });

  renderDowChart();

  if (mesAnterior) {
    document.querySelector("#f-meses-titulo").textContent = `${cap(mesAnterior)} vs ${cap(mesActual)}`;
    const seriesMeses = [mesAnterior, mesActual].map((m, i) => ({
      label: cap(m), cssVar: SERIES_COLORS[i],
      data: DOW_ORDER.filter((d) => d !== "Lun").map((dow) => {
        const e = porMesDiaSemana.get(m).get(dow);
        return e.dias > 0 ? Math.round(e.total / e.dias) : 0;
      })
    }));
    renderLegend(document.querySelector("#f-legend-meses"), seriesMeses);
    groupedBarChart(document.querySelector("#f-chart-meses"), DOW_ORDER.filter((d) => d !== "Lun"), seriesMeses);
  } else {
    document.querySelector("#f-chart-meses").innerHTML = `<p class="empty-msg">Todavía no hay dos meses completos para comparar.</p>`;
  }

  lineChart(
    document.querySelector("#f-chart-tendencia"),
    semanas,
    [{ label: "Promedio €/día", cssVar: "--s-sandwiches", data: semanas.map((s) => {
      const diasSemana = dias.filter((d) => d.semana === s && d.dow !== "Lun");
      return diasSemana.length ? Math.round(diasSemana.reduce((sum, d) => sum + d.total, 0) / diasSemana.length / 100) : 0;
    }) }],
    { valueSuffix: "€" }
  );
}
function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

function renderDowChart() {
  const { promedioPorDiaSemana } = datos;
  const items = DOW_ORDER.map((dow) => {
    const e = promedioPorDiaSemana.find((d) => d.dow === dow);
    const val = dowMode === "abs" ? e.avgCentavos : e.porHoraCentavos;
    return { label: dow, value: val, dim: dow === "Lun" };
  });
  barChart(document.querySelector("#f-chart-dow"), items, {
    tooltipLine: (x) => `<b>${x.label}</b><br>${euros(x.value)}${dowMode === "hora" ? "/h" : ""}`
  });
}

// ============================================================
// PERÍODO: ficha diaria, comparación de semanas, vista por mes
// (compartido entre Facturación y Operación)
// ============================================================
const CATEGORIA_LABEL = { sandwiches: "Sandwiches", bolleria: "Bollería", cafe: "Café", bebidas: "Bebidas" };

function fechasDeSemana(semana) { return datos.dias.filter((d) => d.semana === semana).map((d) => d.fecha); }
function fechasDeMes(mes) { return datos.dias.filter((d) => d.mesLabel === mes).map((d) => d.fecha); }
function deltaPct(a, b) { return b === 0 ? null : ((a - b) / b) * 100; }

// Mismo balance que la tabla "Producción vs. ventas" de la ficha diaria,
// sumado sobre un período — cuánto se produjo, vendió, salió por ToGoo y se
// ajustó (solo sandwiches, que es lo único con esa trazabilidad). "drift" es
// lo que sobra o falta de esa cuenta: producido − vendido − ToGoo + ajuste.
// Por construcción es el cambio neto de stock que implican los números del
// período — no un bug, pero un número lejos de 0 en un mes que "debería"
// cerrar parejo es la señal de que hay algo para revisar.
function reconciliacionSandwiches(fechas) {
  const set = new Set(fechas);
  let producido = 0, vendido = 0, togoo = 0, ajuste = 0, sinExplicar = 0;
  for (const [fecha, filas] of datos.produccionVsVentasPorDia) {
    if (!set.has(fecha)) continue;
    for (const f of filas) {
      producido += f.hoy;
      vendido += f.vendidos;
      togoo += f.togoo;
      ajuste += f.ajuste;
      sinExplicar += f.sinExplicar || 0;
    }
  }
  const drift = producido - vendido - togoo + ajuste + sinExplicar;
  return { producido, vendido, togoo, ajuste, sinExplicar, drift };
}

function resumenPeriodo(fechas) {
  const set = new Set(fechas);
  const diasPeriodo = datos.dias.filter((d) => set.has(d.fecha));
  const total = diasPeriodo.reduce((s, d) => s + d.total, 0);
  const transacciones = diasPeriodo.reduce((s, d) => s + d.count, 0);
  const ingresosTogoo = fechas.reduce((s, f) => s + (datos.togooMontoPorDia.get(f) || 0), 0);
  let sandwichesVendidos = 0, produccionTotal = 0, togooUnidades = 0;
  for (const f of fechas) {
    // Ventas reales de sandwiches: siempre disponible (viene de detalle_venta),
    // a diferencia del arrastre de produccionVsVentasPorDia que solo existe
    // desde primerDiaConProduccion — no conviene mezclar ambas fuentes.
    const ventasDia = datos.ventasPorProductoPorDia.get(f);
    if (ventasDia) {
      for (const [id, p] of ventasDia) if (datos.CATEGORIA.get(id) === "sandwiches") sandwichesVendidos += p.cantidad;
    }
    const prodDia = datos.produccionPorDia.get(f);
    if (prodDia) produccionTotal += [...prodDia.values()].reduce((s, c) => s + c, 0);
    const togooDia = datos.togooPorDia.get(f);
    if (togooDia) togooUnidades += [...togooDia.values()].reduce((s, p) => s + p.cantidad, 0);
  }
  return {
    dias: diasPeriodo.length, total, transacciones,
    ticketMedio: transacciones > 0 ? total / transacciones : 0,
    ingresosVentas: total - ingresosTogoo, ingresosTogoo,
    sandwichesVendidos, produccionTotal, togooUnidades
  };
}

function datosDelDia(fecha) {
  const dia = datos.dias.find((d) => d.fecha === fecha);
  const ingresosTogoo = datos.togooMontoPorDia.get(fecha) || 0;
  const totalDia = dia ? dia.total : 0;

  const ventasDia = datos.ventasPorProductoPorDia.get(fecha) || new Map();
  const prodDia = datos.produccionPorDia.get(fecha) || new Map();
  const togooDia = datos.togooPorDia.get(fecha) || new Map();
  const ajustesDia = datos.ajustesPorDia.get(fecha) || [];

  const filasSandwich = datos.produccionVsVentasPorDia.get(fecha) || [];
  const esEstimado = filasSandwich.length > 0 && filasSandwich[0].estimado;

  const sandwichesVendidos = [...ventasDia.entries()].filter(([id]) => datos.CATEGORIA.get(id) === "sandwiches").reduce((s, [, p]) => s + p.cantidad, 0);
  const sandwichesQuedan = filasSandwich.length ? filasSandwich.reduce((s, f) => s + f.quedan, 0) : null;
  const bebidasVendidas = [...ventasDia.values()].filter((p) => p.categoria === "bebidas").reduce((s, p) => s + p.cantidad, 0);
  const togooUnidadesTotal = [...togooDia.values()].reduce((s, p) => s + p.cantidad, 0);

  const produccionPorCategoria = new Map();
  for (const [prodId, cant] of prodDia) {
    const cat = datos.CATEGORIA.get(prodId) || "otros";
    const arr = produccionPorCategoria.get(cat) || [];
    arr.push({ nombre: datos.NOMBRE_PRODUCTO.get(prodId) || prodId, cantidad: cant });
    produccionPorCategoria.set(cat, arr);
  }

  const ventasPorCategoria = new Map();
  for (const p of ventasDia.values()) {
    const arr = ventasPorCategoria.get(p.categoria) || [];
    arr.push(p);
    ventasPorCategoria.set(p.categoria, arr);
  }
  for (const arr of ventasPorCategoria.values()) arr.sort((a, b) => b.total - a.total);

  // Si este es el primer día de su mes, mostrar el recuento explícito que
  // hizo falta para arrancar el mes sin números imposibles (ver data.js) —
  // en vez de un salto raro sin explicar en "Quedan".
  const esInicioDeMes = dia && datos.dias.find((d) => d.mesLabel === dia.mesLabel)?.fecha === fecha;
  const recuentoInicioMes = esInicioDeMes ? datos.recuentosInicioMes.filter((r) => r.mesLabel === dia.mesLabel) : [];

  return {
    fecha, dia, transacciones: dia ? dia.count : 0,
    ingresosVentas: totalDia - ingresosTogoo, ingresosTogoo, totalDia,
    sandwichesVendidos, sandwichesQuedan, bebidasVendidas, togooUnidadesTotal, esEstimado,
    produccionPorCategoria, ventasPorCategoria,
    togooDia: [...togooDia.values()].sort((a, b) => b.cantidad - a.cantidad),
    ajustesDia, filasSandwich, recuentoInicioMes
  };
}

function renderFichaDia(container, fecha) {
  if (!fecha) { container.innerHTML = `<p class="empty-msg">Elegí un día.</p>`; return; }
  const d = datosDelDia(fecha);
  if (!d.dia) { container.innerHTML = `<p class="empty-msg">Sin ventas registradas ese día.</p>`; return; }

  const kpisHtml = [
    { l: "Transacciones", v: String(d.transacciones) },
    { l: "Ingresos ventas", v: euros(d.ingresosVentas) },
    { l: "Ingresos ToGoo", v: euros(d.ingresosTogoo) },
    { l: "Total general", v: euros(d.totalDia) },
    { l: "Sandwiches vendidos", v: String(d.sandwichesVendidos) },
    { l: "Sandwiches quedan", v: d.sandwichesQuedan == null ? "—" : String(d.sandwichesQuedan) },
    { l: "Bebidas vendidas", v: String(d.bebidasVendidas) },
    { l: "Salidas ToGoo (uds)", v: String(d.togooUnidadesTotal) }
  ].map((k) => `<div class="kpi"><p class="label">${k.l}</p><p class="value">${k.v}</p></div>`).join("");

  const recuentoHtml = d.recuentoInicioMes.length ? `
    <div class="ficha-seccion">
      <h3>Recuento al iniciar ${cap(d.dia.mesLabel)}</h3>
      <p class="empty-msg" style="margin-bottom:8px;">El arrastre de estos productos no cerraba solo con producción y ventas registradas — se ajustó al mínimo necesario para que "Quedan" nunca muestre un número imposible (negativo). Mismo criterio que un recuento físico real: la diferencia queda visible acá, no escondida.</p>
      <table class="datatable">
        <thead><tr><th>Producto</th><th class="num">Ajuste de nivelación</th></tr></thead>
        <tbody>${d.recuentoInicioMes.map((r) => `<tr><td>${r.nombre}</td><td class="num strong">+${r.ajuste}</td></tr>`).join("")}</tbody>
      </table>
    </div>` : "";

  const sandwichTableHtml = d.filasSandwich.length ? `
    ${d.esEstimado ? `<p class="empty-msg" style="margin-bottom:8px;">Sin producción real cargada ese día (arranca el ${fmtFecha(datos.primerDiaConProduccion)}) — "Hoy" se estima igual a lo vendido, sin sobra ni falta.</p>` : ""}
    <p class="empty-msg" style="margin-bottom:8px;">"Quedan" es la suma corrida día a día desde el ${fmtFecha(datos.desde)} (producción − vendidos − ToGoo + ajustes). "Sin explicar" muestra otros movimientos del ledger real (ej. devoluciones) ya incluidos en "Quedan".</p>
    ${recuentoHtml}
    <table class="datatable">
      <thead><tr><th>Sandwich</th><th class="num">Ayer</th><th class="num">Hoy</th><th class="num">Vendidos</th><th class="num">ToGoo</th><th class="num">Ajuste</th><th class="num">Sin explicar</th><th class="num">Quedan</th></tr></thead>
      <tbody>${d.filasSandwich.map((f) => `<tr><td>${f.nombre}</td><td class="num">${f.ayer == null ? "—" : f.ayer}</td><td class="num">${f.hoy}</td><td class="num">${f.vendidos}</td><td class="num">${f.togoo}</td><td class="num${f.ajuste ? (f.ajuste < 0 ? " neg" : "") : ""}">${f.ajuste > 0 ? "+" : ""}${f.ajuste || 0}</td><td class="num${f.sinExplicar ? (f.sinExplicar < 0 ? " neg" : "") : ""}">${f.sinExplicar == null ? "—" : (f.sinExplicar > 0 ? "+" : "") + f.sinExplicar}</td><td class="num strong${f.quedan < 0 ? " neg" : ""}">${f.quedan}</td></tr>`).join("")}</tbody>
    </table>` : `<p class="empty-msg">Sin datos ese día.</p>`;

  const produccionHtml = [...d.produccionPorCategoria.entries()].map(([cat, arr]) => `
    <div class="ficha-seccion"><h3>Producción — ${CATEGORIA_LABEL[cat] || cat} (${arr.reduce((s, p) => s + p.cantidad, 0)})</h3>
      <table class="datatable"><tbody>${arr.sort((a, b) => b.cantidad - a.cantidad).map((p) => `<tr><td>${p.nombre}</td><td class="num strong">${p.cantidad}</td></tr>`).join("")}</tbody></table>
    </div>`).join("");

  const ventasHtml = [...d.ventasPorCategoria.entries()].map(([cat, arr]) => `
    <div class="ficha-seccion"><h3>Ventas — ${CATEGORIA_LABEL[cat] || cat}</h3>
      <table class="datatable">
        <thead><tr><th>Producto</th><th class="num">Cant.</th><th class="num">Monto</th></tr></thead>
        <tbody>${arr.map((p) => `<tr><td>${p.nombre}</td><td class="num">${p.cantidad}</td><td class="num strong">${euros(p.total)}</td></tr>`).join("")}</tbody>
      </table>
    </div>`).join("");

  const togooHtml = d.togooDia.length ? `
    <table class="datatable">
      <thead><tr><th>Producto</th><th class="num">Cant.</th></tr></thead>
      <tbody>${d.togooDia.map((p) => `<tr><td>${p.nombre}</td><td class="num strong">${p.cantidad}</td></tr>`).join("")}</tbody>
    </table>` : `<p class="empty-msg">Sin salidas ToGoo ese día.</p>`;

  const ajustesHtml = d.ajustesDia.length ? `
    <table class="datatable">
      <thead><tr><th>Hora</th><th>Producto</th><th class="num">Cant.</th><th>Motivo</th></tr></thead>
      <tbody>${d.ajustesDia.map((a) => `<tr><td>${a.hora}</td><td>${a.nombre}</td><td class="num${a.cantidad < 0 ? " neg" : ""}">${a.cantidad > 0 ? "+" : ""}${a.cantidad}</td><td>${a.motivo}</td></tr>`).join("")}</tbody>
    </table>` : `<p class="empty-msg">Sin ajustes de stock ese día.</p>`;

  container.innerHTML = `
    <div class="ficha-header"><h2>${d.dia.dow} ${fmtFecha(fecha)}</h2><span class="sub">${d.dia.semana}</span></div>
    <section class="kpis">${kpisHtml}</section>
    <div class="ficha-seccion"><h3>Producción vs. ventas — Sandwiches</h3>${sandwichTableHtml}</div>
    ${produccionHtml}
    ${ventasHtml}
    <div class="ficha-seccion"><h3>Salidas ToGoo</h3>${togooHtml}</div>
    <div class="ficha-seccion"><h3>Ajustes de stock</h3>${ajustesHtml}</div>
  `;
}

function renderVistaSemana(semana) {
  const container = document.querySelector("#f-vista-semana");
  if (!semana) { container.innerHTML = `<p class="empty-msg">Elegí una semana.</p>`; return; }
  const fechas = fechasDeSemana(semana);
  const r = resumenPeriodo(fechas);
  const diasSemana = datos.dias.filter((d) => d.semana === semana);
  const meta = datos.semanaMeta.get(semana);

  const kpisHtml = [
    { l: "Facturación total", v: euros(r.total), s: `${r.dias} días` },
    { l: "Transacciones", v: String(r.transacciones), s: `ticket medio ${euros(r.ticketMedio)}` },
    { l: "Ingresos ToGoo", v: euros(r.ingresosTogoo) },
    { l: "Sandwiches vendidos", v: String(r.sandwichesVendidos) },
    { l: "Sandwiches producidos", v: String(r.produccionTotal) }
  ].map((k) => `<div class="kpi"><p class="label">${k.l}</p><p class="value">${k.v}</p>${k.s ? `<span class="delta"><span class="vs">${k.s}</span></span>` : ""}</div>`).join("");

  container.innerHTML = `<section class="kpis">${kpisHtml}</section><div class="card"><h2>Facturación diaria — ${meta.label}</h2><div id="f-semana-chart-dias"></div></div>`;
  barChart(document.querySelector("#f-semana-chart-dias"), diasSemana.map((d) => ({
    label: `${d.dow} ${fmtFecha(d.fecha)}`, value: d.total, flag: (d.dow === "Sáb" || d.dow === "Dom") ? "peak" : (d.dow === "Lun" ? "lun" : null), dim: d.dow === "Lun"
  })), { highlightKey: "peak", tooltipLine: (x) => `<b>${x.label}</b><br>${euros(x.value)}` });
}

function serieDiariaPorDow(semana) {
  const porDow = new Map(datos.dias.filter((d) => d.semana === semana).map((d) => [d.dow, d.total]));
  return DOW_ORDER.map((dow) => (porDow.has(dow) ? Math.round(porDow.get(dow) / 100) : null));
}

function renderComparacionSemanas(semanaA, semanaB) {
  const container = document.querySelector("#f-comparacion-semanas");
  if (!semanaA || !semanaB) { container.innerHTML = `<p class="empty-msg">Elegí dos semanas.</p>`; return; }
  const rA = resumenPeriodo(fechasDeSemana(semanaA));
  const rB = resumenPeriodo(fechasDeSemana(semanaB));
  const labelA = datos.semanaMeta.get(semanaA).label;
  const labelB = datos.semanaMeta.get(semanaB).label;

  const filas = [
    ["Facturación total", rA.total, rB.total, euros],
    ["Transacciones", rA.transacciones, rB.transacciones, (v) => String(v)],
    ["Ticket medio", rA.ticketMedio, rB.ticketMedio, euros],
    ["Ingresos ToGoo", rA.ingresosTogoo, rB.ingresosTogoo, euros],
    ["Sandwiches vendidos", rA.sandwichesVendidos, rB.sandwichesVendidos, (v) => String(v)],
    ["Sandwiches producidos", rA.produccionTotal, rB.produccionTotal, (v) => String(v)],
    ["Unidades ToGoo", rA.togooUnidades, rB.togooUnidades, (v) => String(v)]
  ];
  // deltaPct(b, a): el % siempre se mide sobre B (la semana/mes mas reciente,
  // normalmente el que esta en curso) usando A como base — asi "+10%"
  // significa "B creció 10% respecto a A", la lectura habitual de un
  // cambio porcentual, no al reves.
  const filasHtml = filas.map(([label, a, b, fmt]) => {
    const delta = deltaPct(b, a);
    const deltaHtml = delta == null ? "—" : `<span class="d-value ${delta >= 0 ? "up" : "down"}">${pctTexto(delta)}</span>`;
    return `<tr><td>${label}</td><td class="num strong">${fmt(a)}</td><td class="num">${deltaHtml}</td><td class="num strong">${fmt(b)}</td></tr>`;
  }).join("");

  container.innerHTML = `
    <div class="card" style="margin-bottom:14px;">
      <h2>Facturación diaria — ${labelA} vs ${labelB}</h2>
      <div class="legend" id="f-comparacion-semanas-legend"></div>
      <div id="f-comparacion-semanas-chart"></div>
    </div>
    <table class="datatable">
      <thead><tr><th>Métrica</th><th class="num">${labelA}</th><th class="num">Δ</th><th class="num">${labelB}</th></tr></thead>
      <tbody>${filasHtml}</tbody>
    </table>
  `;

  const seriesSemanas = [
    { label: labelA, cssVar: SERIES_COLORS[0], data: serieDiariaPorDow(semanaA) },
    { label: labelB, cssVar: SERIES_COLORS[1], data: serieDiariaPorDow(semanaB) }
  ];
  renderLegend(document.querySelector("#f-comparacion-semanas-legend"), seriesSemanas);
  lineChart(document.querySelector("#f-comparacion-semanas-chart"), DOW_ORDER, seriesSemanas, { valueSuffix: "€" });
}

function renderVistaMes(mesLabel) {
  const container = document.querySelector("#f-vista-mes");
  if (!mesLabel) { container.innerHTML = `<p class="empty-msg">Elegí un mes.</p>`; return; }
  const fechas = fechasDeMes(mesLabel);
  const r = resumenPeriodo(fechas);
  const rec = reconciliacionSandwiches(fechas);
  const diasDelMes = datos.dias.filter((d) => d.mesLabel === mesLabel);

  const kpisHtml = [
    { l: "Facturación total", v: euros(r.total), s: `${r.dias} días` },
    { l: "Transacciones", v: String(r.transacciones), s: `ticket medio ${euros(r.ticketMedio)}` },
    { l: "Ingresos ToGoo", v: euros(r.ingresosTogoo) },
    // Estas 5 vienen TODAS de reconciliacionSandwiches (no de resumenPeriodo)
    // a proposito: son las mismas que se ven en la tabla "Producción vs.
    // ventas" dia a dia, asi que la cuenta a mano (producido - vendido -
    // ToGoo + ajuste + otros) cierra exacto con lo que se ve en pantalla —
    // antes "Sandwiches producidos" salia de resumenPeriodo y sumaba TODAS
    // las categorias (bolleria incluida), no solo sandwiches, y no cerraba.
    { l: "Sandwiches producidos", v: String(rec.producido) },
    { l: "Sandwiches vendidos", v: String(rec.vendido) },
    { l: "ToGoo (uds, sandwiches)", v: String(rec.togoo) },
    { l: "Ajustes de stock (uds)", v: `${rec.ajuste > 0 ? "+" : ""}${rec.ajuste}`, s: "sandwiches, neto del mes" },
    { l: "Devoluciones / otros (uds)", v: `${rec.sinExplicar > 0 ? "+" : ""}${rec.sinExplicar}`, s: "movimientos del ledger real" },
    { l: "Diferencia sin explicar", v: `${rec.drift > 0 ? "+" : ""}${rec.drift}`, s: "producido − vendido − ToGoo + ajuste + otros" }
  ].map((k) => `<div class="kpi"><p class="label">${k.l}</p><p class="value">${k.v}</p>${k.s ? `<span class="delta"><span class="vs">${k.s}</span></span>` : ""}</div>`).join("");

  container.innerHTML = `<section class="kpis">${kpisHtml}</section><div class="card"><h2>Facturación diaria — ${cap(mesLabel)}</h2><div id="f-mes-chart-dias"></div></div>`;
  barChart(document.querySelector("#f-mes-chart-dias"), diasDelMes.map((d) => ({
    label: fmtFecha(d.fecha), value: d.total, flag: (d.dow === "Sáb" || d.dow === "Dom") ? "peak" : null
  })), { highlightKey: "peak", tooltipLine: (x) => `<b>${x.label}</b><br>${euros(x.value)}` });
}

function serieDiariaPorDiaDelMes(mesLabel, diasDelMesEje) {
  const porDiaDelMes = new Map(
    datos.dias.filter((d) => d.mesLabel === mesLabel).map((d) => [Number(d.fecha.slice(8, 10)), d.total])
  );
  return diasDelMesEje.map((n) => (porDiaDelMes.has(n) ? Math.round(porDiaDelMes.get(n) / 100) : null));
}

// Ultimo dia-del-mes con datos reales para ese mes (no asume que todos los
// dias 1..N existen, valida contra datos.dias).
function ultimoDiaConDatos(mesLabel) {
  const dias = datos.dias.filter((d) => d.mesLabel === mesLabel);
  return dias.length ? Math.max(...dias.map((d) => Number(d.fecha.slice(8, 10)))) : 0;
}

function renderComparacionMeses(mesA, mesB) {
  const container = document.querySelector("#f-comparacion-meses");
  if (!mesA || !mesB) { container.innerHTML = `<p class="empty-msg">Elegí dos meses.</p>`; return; }

  // Mismo criterio que en la tendencia por sabor: cortar los dos meses en el
  // mismo dia-del-mes (el menor de los dos disponibles — normalmente el mes
  // en curso, que llega "hasta hoy") para no comparar un mes completo contra
  // uno a mitad de camino, lo que siempre hace ganar al completo sin que
  // signifique nada real.
  const hastaDia = Math.min(ultimoDiaConDatos(mesA), ultimoDiaConDatos(mesB));
  const fechasHastaDia = (mes) => fechasDeMes(mes).filter((f) => Number(f.slice(8, 10)) <= hastaDia);

  const rA = resumenPeriodo(fechasHastaDia(mesA));
  const rB = resumenPeriodo(fechasHastaDia(mesB));

  const filas = [
    ["Facturación total", rA.total, rB.total, euros],
    ["Transacciones", rA.transacciones, rB.transacciones, (v) => String(v)],
    ["Ticket medio", rA.ticketMedio, rB.ticketMedio, euros],
    ["Ingresos ToGoo", rA.ingresosTogoo, rB.ingresosTogoo, euros],
    ["Sandwiches vendidos", rA.sandwichesVendidos, rB.sandwichesVendidos, (v) => String(v)],
    ["Sandwiches producidos", rA.produccionTotal, rB.produccionTotal, (v) => String(v)],
    ["Unidades ToGoo", rA.togooUnidades, rB.togooUnidades, (v) => String(v)]
  ];
  // Mismo criterio que en semanas: el % se mide sobre B (el mes mas
  // reciente) usando A como base.
  const filasHtml = filas.map(([label, a, b, fmt]) => {
    const delta = deltaPct(b, a);
    const deltaHtml = delta == null ? "—" : `<span class="d-value ${delta >= 0 ? "up" : "down"}">${pctTexto(delta)}</span>`;
    return `<tr><td>${label}</td><td class="num strong">${fmt(a)}</td><td class="num">${deltaHtml}</td><td class="num strong">${fmt(b)}</td></tr>`;
  }).join("");

  container.innerHTML = `
    <div class="card" style="margin-bottom:14px;">
      <h2>Facturación diaria — ${cap(mesA)} vs ${cap(mesB)}</h2>
      <p class="card-sub">Alineado por día del mes (día 1 con día 1, etc.)</p>
      <div class="legend" id="f-comparacion-meses-legend"></div>
      <div id="f-comparacion-meses-chart"></div>
    </div>
    <p class="card-sub" style="margin: -6px 0 10px;">Tabla comparada hasta el día ${hastaDia} de cada mes, para que sea parejo (el mes en curso llega hasta hoy)</p>
    <table class="datatable">
      <thead><tr><th>Métrica</th><th class="num">${cap(mesA)}</th><th class="num">Δ</th><th class="num">${cap(mesB)}</th></tr></thead>
      <tbody>${filasHtml}</tbody>
    </table>
  `;

  const diasA = datos.dias.filter((d) => d.mesLabel === mesA).map((d) => Number(d.fecha.slice(8, 10)));
  const diasB = datos.dias.filter((d) => d.mesLabel === mesB).map((d) => Number(d.fecha.slice(8, 10)));
  const ejeDias = [...new Set([...diasA, ...diasB])].sort((a, b) => a - b);
  const seriesMeses = [
    { label: cap(mesA), cssVar: SERIES_COLORS[0], data: serieDiariaPorDiaDelMes(mesA, ejeDias) },
    { label: cap(mesB), cssVar: SERIES_COLORS[1], data: serieDiariaPorDiaDelMes(mesB, ejeDias) }
  ];
  renderLegend(document.querySelector("#f-comparacion-meses-legend"), seriesMeses);
  lineChart(document.querySelector("#f-comparacion-meses-chart"), ejeDias.map(String), seriesMeses, { valueSuffix: "€" });
}

function poblarSelectores() {
  const diaOpts = datos.dias.map((d) => `<option value="${d.fecha}">${fmtFecha(d.fecha)} (${d.dow})</option>`).join("");
  const ultimaFecha = datos.dias[datos.dias.length - 1]?.fecha;
  for (const sel of [document.querySelector("#f-dia-select"), document.querySelector("#op-dia-select")]) {
    sel.innerHTML = diaOpts;
    if (ultimaFecha) sel.value = ultimaFecha;
  }

  const semanaOpts = datos.semanas.map((s) => `<option value="${s}">${datos.semanaMeta.get(s).label}</option>`).join("");
  const ultimaSemana = datos.semanas[datos.semanas.length - 1];

  // "Por semana": una sola semana a la vez, arranca en la semana en curso
  // (la última con datos), con opción de mirar cualquier semana anterior.
  const semanaVista = document.querySelector("#f-semana-vista-select");
  semanaVista.innerHTML = semanaOpts;
  if (ultimaSemana) semanaVista.value = ultimaSemana;

  const semA = document.querySelector("#f-semana-a");
  const semB = document.querySelector("#f-semana-b");
  semA.innerHTML = semanaOpts;
  semB.innerHTML = semanaOpts;
  if (datos.semanas.length >= 2) {
    semA.value = datos.semanas[datos.semanas.length - 2];
    semB.value = ultimaSemana;
  }

  const mesOpts = datos.meses.map((m) => `<option value="${m}">${cap(m)}</option>`).join("");
  const mesActual = datos.meses[datos.meses.length - 1];
  for (const sel of [document.querySelector("#f-mes-select"), document.querySelector("#op-mes-select")]) {
    sel.innerHTML = mesOpts;
    if (mesActual) sel.value = mesActual;
  }

  const mesA = document.querySelector("#f-mes-a");
  const mesB = document.querySelector("#f-mes-b");
  mesA.innerHTML = mesOpts;
  mesB.innerHTML = mesOpts;
  if (datos.meses.length >= 2) {
    mesA.value = datos.meses[datos.meses.length - 2];
    mesB.value = mesActual;
  } else if (mesActual) {
    mesA.value = mesActual;
    mesB.value = mesActual;
  }
}

function bindModoToggle(toggleSelector, panelPrefix, onModo) {
  document.querySelector(toggleSelector).addEventListener("click", (e) => {
    const btn = e.target.closest(".range-chip");
    if (!btn) return;
    const modo = btn.dataset.modo;
    document.querySelectorAll(`${toggleSelector} .range-chip`).forEach((b) => b.classList.toggle("active", b === btn));
    document.querySelectorAll(`[id^="${panelPrefix}-modo-"]`).forEach((p) => p.classList.remove("active"));
    document.querySelector(`#${panelPrefix}-modo-${modo}`).classList.add("active");
    onModo(modo);
  });
}

// ============================================================
// OPERACIÓN
// ============================================================
function renderOperacionGeneral() {
  const { rankingTogoo, totalUnidadesTogoo, totalIngresosTogoo, pctTogooSobreProduccion, primerDiaConProduccion, ajustesPorDia, produccionPorDia, NOMBRE_PRODUCTO } = datos;

  document.querySelector("#op-alert").textContent = primerDiaConProduccion
    ? `La producción diaria en Supabase arranca el ${fmtFecha(primerDiaConProduccion)} — antes de esa fecha no hay dato de producción cargado (los KPIs de producción solo cuentan desde ahí).`
    : "Todavía no hay producción cargada en Supabase.";

  const produccionTotalGlobal = new Map();
  for (const m of produccionPorDia.values()) {
    for (const [id, cant] of m) produccionTotalGlobal.set(id, (produccionTotalGlobal.get(id) || 0) + cant);
  }
  const rankingProduccion = [...produccionTotalGlobal.entries()]
    .map(([id, cant]) => ({ nombre: NOMBRE_PRODUCTO.get(id) || id, cantidad: cant }))
    .sort((a, b) => b.cantidad - a.cantidad);
  const totalProducido = rankingProduccion.reduce((s, r) => s + r.cantidad, 0);

  let totalAjustes = 0;
  for (const arr of ajustesPorDia.values()) totalAjustes += arr.length;

  document.querySelector("#op-kpis").innerHTML = [
    { l: "Unidades ToGoo", v: String(totalUnidadesTogoo) },
    { l: "Ingresos ToGoo", v: euros(totalIngresosTogoo) },
    { l: "% ToGoo sobre producción", v: pctTogooSobreProduccion != null ? `${pctTogooSobreProduccion.toFixed(1)}%` : "—", s: "solo sandwiches" },
    { l: "Total producido", v: String(totalProducido), s: "todas las categorías" },
    { l: "Ajustes de stock", v: String(totalAjustes), s: "movimientos registrados" }
  ].map((k) => `<div class="kpi"><p class="label">${k.l}</p><p class="value">${k.v}</p>${k.s ? `<span class="delta"><span class="vs">${k.s}</span></span>` : ""}</div>`).join("");

  rankingListHorizontal("#op-rank-togoo", rankingTogoo, (p) => p.cantidad, (v) => `${v} uds`);
  rankingListHorizontal("#op-rank-produccion", rankingProduccion, (p) => p.cantidad, (v) => `${v} uds`);

  const togooSandwiches = rankingTogoo
    .filter((p) => datos.CATEGORIA.get(p.id) === "sandwiches")
    .sort((a, b) => b.cantidad - a.cantidad);
  barChart(document.querySelector("#op-chart-togoo-sandwich"), togooSandwiches.map((p) => ({
    label: p.nombre, value: p.cantidad
  })), { tooltipLine: (x) => `<b>${x.label}</b><br>${x.value} uds por ToGoo` });

  const todosAjustes = [...ajustesPorDia.entries()]
    .flatMap(([fecha, arr]) => arr.map((a) => ({ fecha, ...a })))
    .sort((a, b) => b.fecha.localeCompare(a.fecha) || b.hora.localeCompare(a.hora));

  barChart(document.querySelector("#op-chart-ajustes"), datos.dias.map((d) => {
    const arr = ajustesPorDia.get(d.fecha) || [];
    const unidades = arr.reduce((s, a) => s + Math.abs(a.cantidad), 0);
    return { label: fmtFecha(d.fecha), value: arr.length, unidades, flag: arr.length >= 3 ? "peak" : null };
  }), { highlightKey: "peak", tooltipLine: (x) => `<b>${x.label}</b><br>${x.value} ajustes · ${x.unidades} uds movidas` });
  document.querySelector("#op-tabla-ajustes").innerHTML = todosAjustes.length ? `
    <table class="datatable">
      <thead><tr><th>Fecha</th><th>Hora</th><th>Producto</th><th class="num">Cant.</th><th>Motivo</th></tr></thead>
      <tbody>${todosAjustes.map((a) => `<tr><td>${fmtFecha(a.fecha)}</td><td>${a.hora}</td><td>${a.nombre}</td><td class="num${a.cantidad < 0 ? " neg" : ""}">${a.cantidad > 0 ? "+" : ""}${a.cantidad}</td><td>${a.motivo}</td></tr>`).join("")}</tbody>
    </table>` : `<p class="empty-msg">Sin ajustes de stock en el período.</p>`;
}

function renderOperacionMes(mesLabel) {
  const container = document.querySelector("#op-vista-mes");
  if (!mesLabel) { container.innerHTML = `<p class="empty-msg">Elegí un mes.</p>`; return; }
  const r = resumenPeriodo(fechasDeMes(mesLabel));
  container.innerHTML = `<section class="kpis">${[
    { l: "Unidades ToGoo", v: String(r.togooUnidades) },
    { l: "Ingresos ToGoo", v: euros(r.ingresosTogoo) },
    { l: "Sandwiches producidos", v: String(r.produccionTotal) },
    { l: "Sandwiches vendidos", v: String(r.sandwichesVendidos) }
  ].map((k) => `<div class="kpi"><p class="label">${k.l}</p><p class="value">${k.v}</p></div>`).join("")}</section>`;
}

// ============================================================
// PRODUCTOS
// ============================================================
function statsDeLista(lista) {
  const cantidad = lista.reduce((s, p) => s + p.cantidad, 0);
  const total = lista.reduce((s, p) => s + p.total, 0);
  const top = lista[0] || null;
  return { cantidad, total, top, precioMedio: cantidad > 0 ? total / cantidad : 0 };
}
function porHoraDeLista(lista) {
  const acc = new Map();
  for (const p of lista) for (const [h, c] of p.porHora) acc.set(h, (acc.get(h) || 0) + c);
  return [...acc.entries()].sort((a, b) => a[0] - b[0]);
}

// Tendencia por sabor: unidades vendidas mes actual vs. mes anterior — no
// facturacion, para no mezclar el ruido de combos/descuentos con si el sabor
// se vende mas o menos. Banda muerta del 15% para que no cambie de flecha
// por cualquier cosa, y un piso de volumen para no marcar "creció 150%" en
// un sabor que vendio 2 unidades el mes pasado y 5 este mes.
//
// "hastaDiaDelMes" corta la cuenta en el mismo dia-del-mes para los dos
// meses — sin esto, un agosto a mitad de mes siempre pierde contra un julio
// completo, sin que eso signifique que vendio menos. Se valida dia por dia
// que exista data en `datos.dias` (algunos dias pueden faltar) antes de
// sumarlo, en vez de asumir que todos los dias 1..N tienen filas.
function unidadesDeProductoEnMes(productoId, mesLabel, hastaDiaDelMes = null) {
  let total = 0;
  for (const d of datos.dias) {
    if (d.mesLabel !== mesLabel) continue;
    if (hastaDiaDelMes != null && Number(d.fecha.slice(8, 10)) > hastaDiaDelMes) continue;
    const ventasDia = datos.ventasPorProductoPorDia.get(d.fecha);
    total += ventasDia?.get(productoId)?.cantidad || 0;
  }
  return total;
}

// Umbrales asimetricos a proposito: alcanza con +5% para marcar verde (un
// crecimiento chico ya vale la pena mostrarlo), pero hace falta una caida
// bastante mas grande (-20%) para marcar rojo — asi el rojo queda reservado
// para algo que de verdad amerita mirar, no para el ruido normal mes a mes.
function tendenciaSabor(productoId, umbralSubida = 5, umbralBajada = -20, volumenMinimo = 10) {
  // "Promo bebiba" / "Promo Café con leche" viven en la categoria sandwiches
  // por motivos de precio/combo pero no son un sabor real (son bebidas de
  // regalo, nunca se producen) — sandwichIds ya las excluye en todos lados,
  // asi que tampoco tienen que mostrar flecha de tendencia aca.
  if (!datos.sandwichIds.includes(productoId)) return null;

  const meses = datos.meses;
  if (meses.length < 2) return null;
  const mesActual = meses[meses.length - 1];
  const mesAnterior = meses[meses.length - 2];

  const diasMesActual = datos.dias.filter((d) => d.mesLabel === mesActual);
  const ultimoDia = diasMesActual.length ? Math.max(...diasMesActual.map((d) => Number(d.fecha.slice(8, 10)))) : null;

  const actual = unidadesDeProductoEnMes(productoId, mesActual, ultimoDia);
  const anterior = unidadesDeProductoEnMes(productoId, mesAnterior, ultimoDia);
  if (anterior < volumenMinimo) return null;
  const deltaPct = ((actual - anterior) / anterior) * 100;
  const clase = deltaPct >= umbralSubida ? "up" : deltaPct <= umbralBajada ? "down" : "stable";
  const diferencia = actual - anterior;

  // Impacto en euros: no el precio de catalogo, el precio PROMEDIO real que
  // termino cobrando ese sabor en el periodo (total facturado / unidades) —
  // ya absorbe combos y descuentos, asi que es mas honesto que el de lista.
  const producto = datos.productos.sandwiches.find((p) => p.id === productoId);
  const precioPromedioCentavos = producto && producto.cantidad > 0 ? producto.total / producto.cantidad : 0;
  const impactoCentavos = Math.round(diferencia * precioPromedioCentavos);

  return { deltaPct, clase, actual, anterior, mesActual, mesAnterior, hastaDia: ultimoDia, diferencia, impactoCentavos };
}

const TENDENCIA_FLECHA = { up: "▲", stable: "▬", down: "▼" };

// El tooltip nativo (title) tarda en aparecer y en una etiqueta chica no
// siempre dispara bien — se arma el contenido de nuevo al pasar el mouse
// (barato, son un par de sumas) y se muestra con el mismo tooltip propio que
// usan los graficos (showTip/hideTip), inmediato y con el estilo del resto
// del dashboard, en vez de depender del tooltip del navegador.
function tendenciaTooltipHtml(t) {
  const signoDif = t.diferencia > 0 ? "+" : "";
  const signoImpacto = t.impactoCentavos > 0 ? "+" : t.impactoCentavos < 0 ? "−" : "";
  return `<b>${t.anterior} → ${t.actual} uds</b> (${signoDif}${t.diferencia})<br>`
    + `${cap(t.mesAnterior)} vs. ${cap(t.mesActual)}, ambos hasta el día ${t.hastaDia}<br>`
    + `si el precio promedio se mantiene, son ${signoImpacto}${euros(Math.abs(t.impactoCentavos))} de facturación`;
}

function tendenciaBadgeHtml(productoId) {
  const t = tendenciaSabor(productoId);
  if (!t) return "";
  const signoPct = t.deltaPct > 0 ? "+" : "";
  return ` <span class="tendencia tendencia-${t.clase}" data-tendencia-producto="${productoId}">${TENDENCIA_FLECHA[t.clase]} ${signoPct}${t.deltaPct.toFixed(0)}%</span>`;
}

function renderSandwiches() {
  const lista = datos.productos.sandwiches;
  const st = statsDeLista(lista);
  const top2 = lista[1];
  const menosVendido = lista.length ? [...lista].sort((a, b) => a.cantidad - b.cantidad)[0] : null;
  document.querySelector("#sw-kpis").innerHTML = [
    { l: "Total uds", v: String(st.cantidad) },
    { l: "Facturación", v: euros(st.total), s: st.total > 0 ? `${Math.round(st.total / datos.kpis.totalCentavos * 100)}% del total` : "" },
    { l: "Precio medio", v: euros(st.precioMedio) },
    { l: "#1 sabor", v: st.top ? st.top.nombre : "—", s: st.top ? `${st.top.cantidad} uds` : "" },
    { l: "Ratio top1/top2", v: (st.top && top2 && top2.cantidad > 0) ? `${(st.top.cantidad / top2.cantidad).toFixed(1)}x` : "—" },
    { l: "Menos vendido", v: menosVendido ? menosVendido.nombre : "—", s: menosVendido ? `${menosVendido.cantidad} uds` : "" }
  ].map((k) => `<div class="pk"><div class="l">${k.l}</div><div class="v">${k.v}</div>${k.s ? `<div class="s">${k.s}</div>` : ""}</div>`).join("");

  // Unidades por sabor ordenado por unidades (no por facturación) para que
  // "menos vendido" tambien se vea claro de abajo hacia arriba en el propio
  // ranking, no solo en el KPI de arriba.
  const listaPorUnidades = [...lista].sort((a, b) => b.cantidad - a.cantidad);
  rankingListHorizontal("#sw-chart-qty", listaPorUnidades, (p) => p.cantidad, (v) => `${v} uds`, (p) => tendenciaBadgeHtml(p.id));
  rankingListHorizontal("#sw-chart-rev", lista, (p) => p.total, euros, (p) => tendenciaBadgeHtml(p.id));

  const top3 = lista.slice(0, 3);
  const seriesDow = top3.map((p, i) => ({ label: p.nombre, cssVar: SERIES_COLORS[i], data: DOW_ORDER.map((d) => p.porDia.get(d) || 0) }));
  renderLegend(document.querySelector("#sw-legend-dow"), seriesDow);
  groupedBarChart(document.querySelector("#sw-chart-dow"), DOW_ORDER, seriesDow, { fmt: (v) => `${v} uds` });

  const horasPresentes = [...new Set(top3.flatMap((p) => [...p.porHora.keys()]))].sort((a, b) => a - b);
  const seriesHora = top3.map((p, i) => ({ label: p.nombre, cssVar: SERIES_COLORS[i], data: horasPresentes.map((h) => p.porHora.get(h) || 0) }));
  renderLegend(document.querySelector("#sw-legend-hora"), seriesHora);
  lineChart(document.querySelector("#sw-chart-hora"), horasPresentes.map((h) => h + "h"), seriesHora, { valueSuffix: " uds" });
}

function rankingListHorizontal(selector, lista, valueFn, fmt, tendenciaFn = null) {
  const container = document.querySelector(selector);
  container.innerHTML = "";
  if (lista.length === 0) { container.innerHTML = `<p class="empty-msg">Sin datos.</p>`; return; }
  const max = Math.max(...lista.map(valueFn), 1);
  const wrap = document.createElement("div");
  wrap.className = "rank-list";
  lista.forEach((p, i) => {
    const val = valueFn(p);
    const row = document.createElement("div");
    row.className = "rank-row";
    row.innerHTML = `
      <span class="n">${i + 1}</span>
      <span class="name">${p.nombre}${tendenciaFn ? tendenciaFn(p) : ""}</span>
      <span class="amt">${fmt(val)}</span>
      <span class="rank-track"><span class="rank-fill" style="width:${(val / max * 100).toFixed(1)}%"></span></span>
    `;
    wrap.appendChild(row);
  });
  container.appendChild(wrap);

  if (tendenciaFn) {
    wrap.addEventListener("mousemove", (e) => {
      const badge = e.target.closest(".tendencia");
      if (!badge) { hideTip(); return; }
      const t = tendenciaSabor(badge.dataset.tendenciaProducto);
      if (t) showTip(e, tendenciaTooltipHtml(t));
    });
    wrap.addEventListener("mouseleave", hideTip);
  }
}

function renderCategoriaSimple(nombreCat, prefijo, tono) {
  const lista = datos.productos[nombreCat];
  const st = statsDeLista(lista);
  const horaPico = porHoraDeLista(lista).reduce((max, [h, c]) => (c > (max?.c || 0) ? { h, c } : max), null);

  document.querySelector(`#${prefijo}-kpis`).innerHTML = [
    { l: "Total uds", v: String(st.cantidad) },
    { l: "Facturación", v: euros(st.total), s: st.total > 0 ? `${Math.round(st.total / datos.kpis.totalCentavos * 100)}% del total` : "" },
    { l: "Precio medio", v: euros(st.precioMedio) },
    { l: "#1", v: st.top ? st.top.nombre : "—", s: st.top ? `${st.top.cantidad} uds` : "" },
    { l: "Hora pico", v: horaPico ? `${horaPico.h}:00h` : "—", s: horaPico ? `${horaPico.c} uds` : "" }
  ].map((k) => `<div class="pk"><div class="l">${k.l}</div><div class="v">${k.v}</div>${k.s ? `<div class="s">${k.s}</div>` : ""}</div>`).join("");

  const insights = [];
  if (st.top && st.cantidad > 0) {
    insights.push(insightHtml({ tone: "good", titulo: `${st.top.nombre} domina`, texto: `<strong>${st.top.cantidad} uds</strong> — ${Math.round(st.top.cantidad / st.cantidad * 100)}% de la categoría.` }));
  }
  if (horaPico) {
    insights.push(insightHtml({ tone: "info", titulo: "Hora pico", texto: `<strong>${horaPico.h}:00h</strong> concentra la mayor venta (${horaPico.c} uds).` }));
  }
  const menosVendido = [...lista].filter((p) => p.cantidad > 0).sort((a, b) => a.cantidad - b.cantidad)[0];
  if (menosVendido && lista.length > 1) {
    insights.push(insightHtml({ tone: "warn", titulo: `${menosVendido.nombre}, el que menos rota`, texto: `Solo <strong>${menosVendido.cantidad} uds</strong> en todo el período.` }));
  }
  document.querySelector(`#${prefijo}-insights`).innerHTML = insights.join("");

  rankingListHorizontal(`#${prefijo}-chart-qty`, lista, (p) => p.cantidad, (v) => `${v} uds`);
  const horas = porHoraDeLista(lista);
  barChart(document.querySelector(`#${prefijo}-chart-hora`), horas.map(([h, c]) => ({ label: h + "h", value: c })), {
    tooltipLine: (x) => `<b>${x.label}</b><br>${x.value} uds`
  });
}

const productosRenderizados = { sandwiches: false, cafe: false, bolleria: false, bebidas: false };
function renderProductosTab(name) {
  if (productosRenderizados[name]) return;
  productosRenderizados[name] = true;
  if (name === "sandwiches") renderSandwiches();
  else renderCategoriaSimple(name, name === "cafe" ? "ca" : name === "bolleria" ? "bo" : "be");
}

// ============================================================
// HORARIOS
// ============================================================
function renderHorarios() {
  const { porHora, slots } = datos;

  document.querySelector("#h-alert").textContent =
    "Cada franja agrupa varias horas del día — útil para pensar turnos y refuerzos de personal, no solo picos puntuales.";

  document.querySelector("#h-slots").innerHTML = slots.map((s) => `
    <div class="slot-card">
      <div class="s-label">${s.label} (${s.desde}–${s.hasta}h)</div>
      <div class="s-value">${s.txn}</div>
      <div class="s-sub">transacciones · ${euros(s.revenue)}</div>
      ${s.top ? `<div class="s-top">Más vendido: <strong>${s.top.nombre}</strong> (${s.top.uds} uds)</div>` : ""}
    </div>
  `).join("");

  barChart(document.querySelector("#h-chart-txn"), porHora.map((h) => ({ label: h.hora + "h", value: h.txn })), {
    tooltipLine: (x) => `<b>${x.label}</b><br>${x.value} transacciones`
  });
  barChart(document.querySelector("#h-chart-rev"), porHora.map((h) => ({ label: h.hora + "h", value: h.revenue })), {
    tooltipLine: (x) => `<b>${x.label}</b><br>${euros(x.value)}`
  });

  const CATS = [
    { key: "sandwiches", label: "Sandwiches", cssVar: "--s-sandwiches" },
    { key: "bolleria", label: "Bollería", cssVar: "--s-bolleria" },
    { key: "cafe", label: "Café", cssVar: "--s-cafe" },
    { key: "bebidas", label: "Bebidas", cssVar: "--s-bebidas" }
  ];
  renderLegend(document.querySelector("#h-legend-cat"), CATS);
  stackedBarChart(document.querySelector("#h-chart-cat"), porHora.map((h) => ({
    label: h.hora + "h", values: { sandwiches: h.sandwiches, bolleria: h.bolleria, cafe: h.cafe, bebidas: h.bebidas }
  })), CATS, { fmt: (v) => `${v} uds`, tooltipLabel: (w) => w.label });

  const seriesDual = [
    { label: "Café", cssVar: "--s-cafe", data: porHora.map((h) => h.cafe) },
    { label: "Bebidas", cssVar: "--s-bebidas", data: porHora.map((h) => h.bebidas) }
  ];
  renderLegend(document.querySelector("#h-legend-dual"), seriesDual);
  lineChart(document.querySelector("#h-chart-dual"), porHora.map((h) => h.hora + "h"), seriesDual, { valueSuffix: " uds" });

  const picoTxn = [...porHora].sort((a, b) => b.txn - a.txn);
  const picoCafe = [...porHora].sort((a, b) => b.cafe - a.cafe)[0];
  const picoTxnGlobal = picoTxn[0];
  const masFloja = [...porHora].filter((h) => h.hora >= 9 && h.hora <= 21).sort((a, b) => a.txn - b.txn)[0];
  document.querySelector("#h-insights").innerHTML = [
    insightHtml({ tone: "info", titulo: "Hora pico #1", texto: `<strong>${picoTxn[0].hora}:00h</strong> — ${picoTxn[0].txn} transacciones.` }),
    picoTxn[1] ? insightHtml({ tone: "good", titulo: "Hora pico #2", texto: `<strong>${picoTxn[1].hora}:00h</strong> — ${picoTxn[1].txn} transacciones.` }) : "",
    (picoCafe && picoCafe.hora !== picoTxnGlobal.hora) ? insightHtml({ tone: "warn", titulo: "El café pica en otro momento", texto: `El pico de café es a las <strong>${picoCafe.hora}:00h</strong>, distinto del pico general de ventas.` }) : "",
    masFloja ? insightHtml({ tone: "critical", titulo: "Hora más floja", texto: `<strong>${masFloja.hora}:00h</strong>, con solo ${masFloja.txn} transacciones.` }) : ""
  ].join("");
}

// ============================================================
// EVENTOS (registro manual de eventos de negocio — unica vista que escribe)
// ============================================================
const CATEGORIA_EVENTO_LABEL = { marketing: "Marketing", feriado: "Feriado", clima: "Clima", otro: "Otro" };

function fmtFechaLarga(iso) {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

function eventoRowHtml(ev) {
  return `
    <div class="evento-row">
      <div class="evento-row-main">
        <span class="evento-tag">${CATEGORIA_EVENTO_LABEL[ev.categoria] || ev.categoria}</span>
        <span class="evento-fecha">${fmtFechaLarga(ev.fecha)}</span>
        <p class="evento-desc">${ev.descripcion}</p>
      </div>
      <button type="button" class="ghost-btn evento-del" data-id="${ev.id}">Borrar</button>
    </div>
  `;
}

function renderEventos() {
  const eventos = datos.eventos || [];
  dom.evLista.innerHTML = eventos.length
    ? eventos.map(eventoRowHtml).join("")
    : `<p class="empty-msg">Todavía no cargaste ningún evento.</p>`;
}

async function handleAddEvento(event) {
  event.preventDefault();
  dom.evError.hidden = true;
  const fecha = dom.evFecha.value;
  const descripcion = dom.evDescripcion.value.trim();
  const categoria = dom.evCategoria.value;
  if (!fecha || !descripcion) return;

  dom.evSubmit.disabled = true;
  dom.evSubmit.textContent = "Agregando…";
  try {
    const fila = await sbPost("/eventos_negocio", { fecha, descripcion, categoria });
    datos.eventos = [fila, ...(datos.eventos || [])];
    dom.evForm.reset();
    renderEventos();
  } catch (error) {
    dom.evError.textContent = error.message || "No se pudo guardar el evento.";
    dom.evError.hidden = false;
  } finally {
    dom.evSubmit.disabled = false;
    dom.evSubmit.textContent = "Agregar evento";
  }
}

async function handleDeleteEvento(id) {
  if (!confirm("¿Borrar este evento? No se puede deshacer.")) return;
  try {
    await sbDelete(`/eventos_negocio?id=eq.${id}`);
    datos.eventos = (datos.eventos || []).filter((e) => e.id !== id);
    renderEventos();
  } catch (error) {
    alert(error.message || "No se pudo borrar el evento.");
  }
}

// ============================================================
// NAVEGACIÓN
// ============================================================
let operacionRenderizado = false;
function switchTab(name) {
  document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
  document.querySelectorAll(".tab-btn").forEach((b) => b.classList.toggle("active", b.dataset.tab === name));
  document.querySelector(`#tab-${name}`).classList.add("active");
  if (name === "resumen") renderResumen();
  if (name === "facturacion") renderFacturacion();
  if (name === "productos") renderProductosTab(document.querySelector(".stab.active")?.dataset.stab || "sandwiches");
  if (name === "horarios") renderHorarios();
  if (name === "operacion" && !operacionRenderizado) { renderOperacionGeneral(); operacionRenderizado = true; }
  if (name === "eventos") renderEventos();
}

function switchStab(name) {
  document.querySelectorAll(".stab-panel").forEach((p) => p.classList.remove("active"));
  document.querySelectorAll(".stab").forEach((b) => b.classList.toggle("active", b.dataset.stab === name));
  document.querySelector(`#sp-${name}`).classList.add("active");
  renderProductosTab(name);
}

function bindEvents() {
  dom.loginForm.addEventListener("submit", handleLogin);
  dom.logoutBtn.addEventListener("click", handleLogout);
  dom.tabsNav.addEventListener("click", (e) => {
    const btn = e.target.closest(".tab-btn");
    if (btn) switchTab(btn.dataset.tab);
  });
  dom.stabsProductos.addEventListener("click", (e) => {
    const btn = e.target.closest(".stab");
    if (btn) switchStab(btn.dataset.stab);
  });
  document.querySelector("#f-dow-toggle").addEventListener("click", (e) => {
    const btn = e.target.closest(".range-chip");
    if (!btn) return;
    dowMode = btn.dataset.mode;
    document.querySelectorAll("#f-dow-toggle .range-chip").forEach((b) => b.classList.toggle("active", b === btn));
    renderDowChart();
  });

  bindModoToggle("#f-modo-toggle", "f", (modo) => {
    if (modo === "dia") renderFichaDia(document.querySelector("#f-ficha-dia"), document.querySelector("#f-dia-select").value);
    if (modo === "semana-vista") renderVistaSemana(document.querySelector("#f-semana-vista-select").value);
    if (modo === "semana") renderComparacionSemanas(document.querySelector("#f-semana-a").value, document.querySelector("#f-semana-b").value);
    if (modo === "mes") renderVistaMes(document.querySelector("#f-mes-select").value);
    if (modo === "mes-comparar") renderComparacionMeses(document.querySelector("#f-mes-a").value, document.querySelector("#f-mes-b").value);
  });
  document.querySelector("#f-dia-select").addEventListener("change", (e) => renderFichaDia(document.querySelector("#f-ficha-dia"), e.target.value));
  document.querySelector("#f-semana-vista-select").addEventListener("change", (e) => renderVistaSemana(e.target.value));
  document.querySelector("#f-semana-a").addEventListener("change", () => renderComparacionSemanas(document.querySelector("#f-semana-a").value, document.querySelector("#f-semana-b").value));
  document.querySelector("#f-semana-b").addEventListener("change", () => renderComparacionSemanas(document.querySelector("#f-semana-a").value, document.querySelector("#f-semana-b").value));
  document.querySelector("#f-mes-select").addEventListener("change", (e) => renderVistaMes(e.target.value));
  document.querySelector("#f-mes-a").addEventListener("change", () => renderComparacionMeses(document.querySelector("#f-mes-a").value, document.querySelector("#f-mes-b").value));
  document.querySelector("#f-mes-b").addEventListener("change", () => renderComparacionMeses(document.querySelector("#f-mes-a").value, document.querySelector("#f-mes-b").value));

  bindModoToggle("#op-modo-toggle", "op", (modo) => {
    if (modo === "dia") renderFichaDia(document.querySelector("#op-ficha-dia"), document.querySelector("#op-dia-select").value);
    if (modo === "mes") renderOperacionMes(document.querySelector("#op-mes-select").value);
  });
  document.querySelector("#op-dia-select").addEventListener("change", (e) => renderFichaDia(document.querySelector("#op-ficha-dia"), e.target.value));
  document.querySelector("#op-mes-select").addEventListener("change", (e) => renderOperacionMes(e.target.value));

  dom.evForm.addEventListener("submit", handleAddEvento);
  dom.evLista.addEventListener("click", (e) => {
    const btn = e.target.closest(".evento-del");
    if (btn) handleDeleteEvento(Number(btn.dataset.id));
  });
}

async function boot() {
  dom.loadingMsg.hidden = false;
  try {
    datos = await cargarTodo();
    dom.rangoSub.textContent = `Del ${fmtFecha(datos.desde)} al ${fmtFecha(datos.hasta)} · datos en vivo desde Supabase`;
    dom.footerRango.textContent = ` (${fmtFecha(datos.desde)} – ${fmtFecha(datos.hasta)})`;
    dom.loadingMsg.hidden = true;
    poblarSelectores();
    renderResumen();
  } catch (error) {
    dom.loadingMsg.textContent = `No se pudo cargar: ${error.message}`;
  }
}

async function start() {
  initTooltip();
  bindEvents();
  const session = await restoreSession();
  if (session) {
    showDashboard();
    await boot();
  } else {
    showLogin();
  }
}

start();
