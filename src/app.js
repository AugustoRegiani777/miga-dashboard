import { signIn, signOut, restoreSession } from "./supabase.js";
import { cargarDatos, cargarMezclaCategorias, rangoPara, rangoAnterior, CATEGORIA } from "./data.js";
import { initTooltip, barChart, stackedBarChart, heatStrip, rankingList, euros, pct } from "./charts.js";

const dom = {
  loginScreen: document.querySelector("#login-screen"),
  loginForm: document.querySelector("#login-form"),
  loginUsuario: document.querySelector("#login-usuario"),
  loginPassword: document.querySelector("#login-password"),
  loginSubmit: document.querySelector("#login-submit"),
  loginError: document.querySelector("#login-error"),
  dashboardScreen: document.querySelector("#dashboard-screen"),
  rangoSub: document.querySelector("#rango-sub"),
  rangePicker: document.querySelector("#range-picker"),
  logoutBtn: document.querySelector("#logout-btn"),
  kpis: document.querySelector("#kpis"),
  diasSub: document.querySelector("#dias-sub"),
  chartDias: document.querySelector("#chart-dias"),
  rankProductos: document.querySelector("#rank-productos"),
  legendCategorias: document.querySelector("#legend-categorias"),
  chartCategorias: document.querySelector("#chart-categorias"),
  focoTrio: document.querySelector("#foco-trio"),
  chartHoras: document.querySelector("#chart-horas"),
  chartSemana: document.querySelector("#chart-semana")
};

const CATS = [
  { key: "sandwiches", label: "Sandwiches", cssVar: "--s-sandwiches" },
  { key: "bolleria", label: "Bollería", cssVar: "--s-bolleria" },
  { key: "cafe", label: "Café", cssVar: "--s-cafe" },
  { key: "bebidas", label: "Bebidas", cssVar: "--s-bebidas" }
];

let currentPreset = "semana";
let loading = false;

function setLoginError(msg) {
  dom.loginError.textContent = msg || "";
  dom.loginError.hidden = !msg;
}

function showDashboard() {
  dom.loginScreen.hidden = true;
  dom.dashboardScreen.hidden = false;
}
function showLogin() {
  dom.dashboardScreen.hidden = true;
  dom.loginScreen.hidden = false;
}

async function handleLogin(event) {
  event.preventDefault();
  setLoginError(null);
  dom.loginSubmit.disabled = true;
  dom.loginSubmit.textContent = "Entrando…";
  try {
    await signIn(dom.loginUsuario.value, dom.loginPassword.value);
    showDashboard();
    await bootDashboard();
  } catch (error) {
    setLoginError(error.message || "No se pudo iniciar sesión.");
  } finally {
    dom.loginSubmit.disabled = false;
    dom.loginSubmit.textContent = "Entrar";
  }
}

function handleLogout() {
  signOut();
  showLogin();
}

function fmtRango(desde, hasta) {
  const f = (iso) => {
    const [y, m, d] = iso.split("-");
    return `${d}/${m}`;
  };
  return `${f(desde)} – ${f(hasta)}`;
}

function renderKpis(actual, anterior) {
  const items = [
    { label: "Facturado", val: actual.kpis.totalCentavos, prev: anterior?.kpis.totalCentavos, fmt: euros },
    { label: "Transacciones", val: actual.kpis.transacciones, prev: anterior?.kpis.transacciones, fmt: (n) => String(n) },
    { label: "Ticket promedio", val: actual.kpis.ticketPromedioCentavos, prev: anterior?.kpis.ticketPromedioCentavos, fmt: euros },
    { label: "Facturado ToGoo", val: actual.kpis.togooCentavos, prev: anterior?.kpis.togooCentavos, fmt: euros }
  ];
  dom.kpis.innerHTML = items.map((it) => {
    let deltaHtml = "";
    if (anterior && it.prev > 0) {
      const delta = ((it.val - it.prev) / it.prev) * 100;
      const cls = delta >= 0 ? "up" : "down";
      deltaHtml = `<span class="delta ${cls}">${pct(delta)} <span class="vs">vs. período anterior</span></span>`;
    }
    return `
      <div class="kpi">
        <p class="label">${it.label}</p>
        <p class="value">${it.fmt(it.val)}</p>
        ${deltaHtml}
      </div>
    `;
  }).join("");
}

async function cargarRango(preset) {
  if (loading) return;
  loading = true;
  currentPreset = preset;
  [...dom.rangePicker.querySelectorAll(".range-chip")].forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.range === preset);
  });

  const rango = rangoPara(preset);
  const anteriorRango = preset === "todo" ? null : rangoAnterior(rango);
  dom.rangoSub.textContent = `Del ${fmtRango(rango.desde, rango.hasta)} · datos en vivo desde Supabase`;
  dom.diasSub.textContent = fmtRango(rango.desde, rango.hasta);

  try {
    const [actual, anterior] = await Promise.all([
      cargarDatos(rango),
      anteriorRango ? cargarDatos(anteriorRango) : Promise.resolve(null)
    ]);

    renderKpis(actual, anterior);

    barChart(
      dom.chartDias,
      actual.porDia.map(([fecha, e]) => ({ label: fecha.slice(8, 10) + "/" + fecha.slice(5, 7), value: e.total })),
      { tooltipLine: (d) => `<b>${d.label}</b><br>${euros(d.value)}` }
    );

    rankingList(dom.rankProductos, actual.topProductos);

    const diaMax = actual.porDiaSemana.reduce((max, [, e]) => Math.max(max, e.total), 0);
    barChart(
      dom.chartSemana,
      actual.porDiaSemana.map(([dia, e]) => ({ label: dia, value: e.total, flag: e.total === diaMax ? "peak" : null })),
      { highlightKey: "peak", tooltipLine: (d) => `<b>${d.label}</b><br>${euros(d.value)}` }
    );

    heatStrip(
      dom.chartHoras,
      actual.porHora.map(([hora, count]) => ({ label: String(hora), value: count }))
    );

    // Foco cafe/alfajor/medialuna: usa lo que ya vino en topProductos si esta
    // adentro del top 8; si no, se completa con un 0 visible en vez de
    // inventar un numero.
    const buscar = (id) => actual.todosLosProductos.find((p) => p.id === id);
    const cafeTotal = actual.porCategoria.get("cafe") || 0;
    const alfajor = buscar("alfajor-havana");
    const medialuna = buscar("medialunas");
    dom.focoTrio.innerHTML = `
      <div class="stat">
        <div class="t-label">Café (todos)</div>
        <div class="t-value">${euros(cafeTotal)}</div>
      </div>
      <div class="stat">
        <div class="t-label">Alfajor Havana</div>
        <div class="t-value">${alfajor ? euros(alfajor.total) : "—"}</div>
        <div class="t-unit">${alfajor ? alfajor.cantidad + " unidades" : "sin ventas en el período"}</div>
      </div>
      <div class="stat">
        <div class="t-label">Medialunas</div>
        <div class="t-value">${medialuna ? euros(medialuna.total) : "—"}</div>
        <div class="t-unit">${medialuna ? medialuna.cantidad + " unidades" : "sin ventas en el período"}</div>
      </div>
    `;
  } catch (error) {
    dom.rangoSub.textContent = `No se pudo cargar: ${error.message}`;
  } finally {
    loading = false;
  }
}

async function cargarMezcla() {
  dom.legendCategorias.innerHTML = CATS.map((c) =>
    `<span class="item"><span class="swatch" style="background:var(${c.cssVar})"></span>${c.label}</span>`
  ).join("");
  try {
    const semanas = await cargarMezclaCategorias(4);
    stackedBarChart(
      dom.chartCategorias,
      semanas.map(([inicio, valores]) => ({
        label: inicio.slice(8, 10) + "/" + inicio.slice(5, 7),
        values: valores
      })),
      CATS
    );
  } catch (error) {
    dom.chartCategorias.innerHTML = `<p class="empty-msg">No se pudo cargar: ${error.message}</p>`;
  }
}

async function bootDashboard() {
  await Promise.all([cargarRango(currentPreset), cargarMezcla()]);
}

function bindEvents() {
  dom.loginForm.addEventListener("submit", handleLogin);
  dom.logoutBtn.addEventListener("click", handleLogout);
  dom.rangePicker.addEventListener("click", (e) => {
    const btn = e.target.closest(".range-chip");
    if (!btn || btn.disabled) return;
    cargarRango(btn.dataset.range);
  });
}

async function start() {
  initTooltip();
  bindEvents();
  const session = await restoreSession();
  if (session) {
    showDashboard();
    await bootDashboard();
  } else {
    showLogin();
  }
}

start();
