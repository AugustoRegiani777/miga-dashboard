import { signIn, signOut, restoreSession } from "./supabase.js";
import { cargarTodo, HORAS_OPERATIVAS } from "./data.js";
import {
  initTooltip, barChart, stackedBarChart, groupedBarChart, lineChart, heatStrip,
  rankingList, renderLegend, euros, pct, SERIES_COLORS
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
  stabsProductos: document.querySelector("#stabs-productos")
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
function renderResumen() {
  const { kpis, mejorDia, promedioSinLunes, horaPico, producto1, promedioPorDiaSemana, dias, porHora, totalPorSemana } = datos;

  document.querySelector("#r-kpis").innerHTML = [
    { l: "Facturación total", v: euros(kpis.totalCentavos), s: `${kpis.dias} días` },
    { l: "Transacciones", v: String(kpis.transacciones), s: `ticket medio ${euros(kpis.ticketPromedioCentavos)}` },
    { l: "Mejor día", v: euros(mejorDia?.total || 0), s: mejorDia ? `${fmtFecha(mejorDia.fecha)} (${mejorDia.dow})` : "—" },
    { l: "Promedio/día (sin lunes)", v: euros(promedioSinLunes), s: "martes a domingo" },
    { l: "Producto #1", v: producto1 ? producto1.nombre : "—", s: producto1 ? `${producto1.cantidad} uds · ${euros(producto1.total)}` : "" },
    { l: "Hora pico de ventas", v: horaPico ? `${horaPico.hora}:00h` : "—", s: horaPico ? `${horaPico.txn} transacciones` : "" }
  ].map((k) => `<div class="kpi"><p class="label">${k.l}</p><p class="value">${k.v}</p><span class="delta"><span class="vs">${k.s}</span></span></div>`).join("");

  // Insights calculados, no escritos a mano.
  const lun = promedioPorDiaSemana.find((d) => d.dow === "Lun");
  const resto = promedioPorDiaSemana.filter((d) => d.dow !== "Lun");
  const restoPromHora = resto.reduce((s, d) => s + d.porHoraCentavos, 0) / resto.length;
  const mejorPorHora = [...promedioPorDiaSemana].sort((a, b) => b.porHoraCentavos - a.porHoraCentavos)[0];
  const entreSemana = promedioPorDiaSemana.filter((d) => !["Sáb", "Dom", "Lun"].includes(d.dow));
  const masFloja = [...entreSemana].sort((a, b) => a.porHoraCentavos - b.porHoraCentavos)[0];
  const semanasOrdenadas = [...totalPorSemana.entries()].sort((a, b) => a[1] - b[1]);
  const semanaFloja = semanasOrdenadas[0];
  const semanaFuerte = semanasOrdenadas[semanasOrdenadas.length - 1];

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
      tone: "critical",
      titulo: `${semanaFloja[0]} fue la semana floja`,
      texto: `<strong>${euros(semanaFloja[1])}</strong> vs. <strong>${euros(semanaFuerte[1])}</strong> de ${semanaFuerte[0]}, la mejor.`
    })
  ].join("");

  barChart(document.querySelector("#r-chart-dias"), dias.map((d) => ({
    label: fmtFecha(d.fecha), value: d.total, flag: (d.dow === "Sáb" || d.dow === "Dom") ? "peak" : null
  })), { highlightKey: "peak", tooltipLine: (x) => `<b>${x.label}</b><br>${euros(x.value)}` });

  rankingList(document.querySelector("#r-rank-productos"), datos.todosProductosOrdenados.slice(0, 8));

  barChart(document.querySelector("#r-chart-dow"), resto.map((d) => ({ label: d.dow, value: d.avgCentavos })), {
    tooltipLine: (x) => `<b>${x.label}</b><br>${euros(x.value)} promedio`
  });

  heatStrip(document.querySelector("#r-chart-hora"), porHora.map((h) => ({ label: String(h.hora), value: h.txn })));
}

// ============================================================
// FACTURACIÓN
// ============================================================
let dowMode = "abs";
function renderFacturacion() {
  const { kpis, mejorDia, peorDiaNormal, promedioSinLunes, promedioPorDiaSemana, dias, totalPorSemana, porMesDiaSemana, semanas } = datos;

  document.querySelector("#f-alert").textContent =
    `El lunes abre con horario reducido (${HORAS_OPERATIVAS.Lun}h en vez de ${HORAS_OPERATIVAS.Mar}-${HORAS_OPERATIVAS.Sáb}h) — se marca aparte y queda fuera de los promedios generales.`;

  const mesesConDatos = [...porMesDiaSemana.keys()];
  const mesActual = mesesConDatos[mesesConDatos.length - 1];
  const mesAnterior = mesesConDatos.length > 1 ? mesesConDatos[mesesConDatos.length - 2] : null;
  let deltaMes = null;
  if (mesAnterior) {
    const diasMesA = dias.filter((d) => d.mesLabel === mesActual && d.dow !== "Lun");
    const diasMesB = dias.filter((d) => d.mesLabel === mesAnterior && d.dow !== "Lun");
    const avgA = diasMesA.reduce((s, d) => s + d.total, 0) / (diasMesA.length || 1);
    const avgB = diasMesB.reduce((s, d) => s + d.total, 0) / (diasMesB.length || 1);
    deltaMes = ((avgA - avgB) / avgB) * 100;
  }
  const mejorPorHora = [...promedioPorDiaSemana].sort((a, b) => b.porHoraCentavos - a.porHoraCentavos)[0];

  document.querySelector("#f-kpis").innerHTML = [
    { l: "Total", v: euros(kpis.totalCentavos), s: `${kpis.dias} días` },
    { l: "Promedio/día sin lunes", v: euros(promedioSinLunes) },
    { l: "Mejor día", v: euros(mejorDia?.total || 0), s: mejorDia ? `${fmtFecha(mejorDia.fecha)} (${mejorDia.dow})` : "—" },
    { l: "Peor día (sin lunes)", v: euros(peorDiaNormal?.total || 0), s: peorDiaNormal ? fmtFecha(peorDiaNormal.fecha) : "—" },
    { l: "Ticket medio", v: euros(kpis.ticketPromedioCentavos) },
    { l: "Mejor €/hora", v: mejorPorHora.dow, s: `${euros(mejorPorHora.porHoraCentavos)}/h` },
    deltaMes != null ? { l: `${mesActual} vs ${mesAnterior}`, v: pctTexto(deltaMes), s: "promedio diario, sin lunes" } : null
  ].filter(Boolean).map((k) => `<div class="kpi"><p class="label">${k.l}</p><p class="value">${k.v}</p>${k.s ? `<span class="delta"><span class="vs">${k.s}</span></span>` : ""}</div>`).join("");

  barChart(document.querySelector("#f-chart-dias"), dias.map((d) => ({
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

function renderSandwiches() {
  const lista = datos.productos.sandwiches;
  const st = statsDeLista(lista);
  const top2 = lista[1];
  document.querySelector("#sw-kpis").innerHTML = [
    { l: "Total uds", v: String(st.cantidad) },
    { l: "Facturación", v: euros(st.total), s: st.total > 0 ? `${Math.round(st.total / datos.kpis.totalCentavos * 100)}% del total` : "" },
    { l: "Precio medio", v: euros(st.precioMedio) },
    { l: "#1 sabor", v: st.top ? st.top.nombre : "—", s: st.top ? `${st.top.cantidad} uds` : "" },
    { l: "Ratio top1/top2", v: (st.top && top2 && top2.cantidad > 0) ? `${(st.top.cantidad / top2.cantidad).toFixed(1)}x` : "—" }
  ].map((k) => `<div class="pk"><div class="l">${k.l}</div><div class="v">${k.v}</div>${k.s ? `<div class="s">${k.s}</div>` : ""}</div>`).join("");

  rankingListHorizontal("#sw-chart-qty", lista, (p) => p.cantidad, (v) => `${v} uds`);
  rankingListHorizontal("#sw-chart-rev", lista, (p) => p.total, euros);

  const top3 = lista.slice(0, 3);
  const seriesDow = top3.map((p, i) => ({ label: p.nombre, cssVar: SERIES_COLORS[i], data: DOW_ORDER.map((d) => p.porDia.get(d) || 0) }));
  renderLegend(document.querySelector("#sw-legend-dow"), seriesDow);
  groupedBarChart(document.querySelector("#sw-chart-dow"), DOW_ORDER, seriesDow, { fmt: (v) => `${v} uds` });

  const horasPresentes = [...new Set(top3.flatMap((p) => [...p.porHora.keys()]))].sort((a, b) => a - b);
  const seriesHora = top3.map((p, i) => ({ label: p.nombre, cssVar: SERIES_COLORS[i], data: horasPresentes.map((h) => p.porHora.get(h) || 0) }));
  renderLegend(document.querySelector("#sw-legend-hora"), seriesHora);
  lineChart(document.querySelector("#sw-chart-hora"), horasPresentes.map((h) => h + "h"), seriesHora, { valueSuffix: " uds" });
}

function rankingListHorizontal(selector, lista, valueFn, fmt) {
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
      <span class="name">${p.nombre}</span>
      <span class="amt">${fmt(val)}</span>
      <span class="rank-track"><span class="rank-fill" style="width:${(val / max * 100).toFixed(1)}%"></span></span>
    `;
    wrap.appendChild(row);
  });
  container.appendChild(wrap);
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
// NAVEGACIÓN
// ============================================================
function switchTab(name) {
  document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
  document.querySelectorAll(".tab-btn").forEach((b) => b.classList.toggle("active", b.dataset.tab === name));
  document.querySelector(`#tab-${name}`).classList.add("active");
  if (name === "resumen") renderResumen();
  if (name === "facturacion") renderFacturacion();
  if (name === "productos") renderProductosTab(document.querySelector(".stab.active")?.dataset.stab || "sandwiches");
  if (name === "horarios") renderHorarios();
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
}

async function boot() {
  dom.loadingMsg.hidden = false;
  try {
    datos = await cargarTodo();
    dom.rangoSub.textContent = `Del ${fmtFecha(datos.desde)} al ${fmtFecha(datos.hasta)} · datos en vivo desde Supabase`;
    dom.footerRango.textContent = ` (${fmtFecha(datos.desde)} – ${fmtFecha(datos.hasta)})`;
    dom.loadingMsg.hidden = true;
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
