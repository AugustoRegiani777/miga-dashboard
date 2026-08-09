let tooltipEl = null;

export function initTooltip() {
  tooltipEl = document.getElementById("tooltip");
  document.addEventListener("mousemove", (e) => {
    if (tooltipEl.classList.contains("show")) {
      tooltipEl.style.left = e.clientX + "px";
      tooltipEl.style.top = (e.clientY - 10) + "px";
    }
  });
}

function showTip(evt, html) {
  tooltipEl.innerHTML = html;
  tooltipEl.style.left = evt.clientX + "px";
  tooltipEl.style.top = (evt.clientY - 10) + "px";
  tooltipEl.classList.add("show");
}
function hideTip() { tooltipEl.classList.remove("show"); }

function svgEl(tag, attrs) {
  const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const k in attrs) el.setAttribute(k, attrs[k]);
  return el;
}

export function euros(c) {
  return (c / 100).toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
}

export function pct(delta) {
  const sign = delta >= 0 ? "▲" : "▼";
  return `${sign} ${Math.abs(delta).toFixed(1)}%`;
}

// ---------- Barras verticales (ventas por dia / por dia de semana) ----------
export function barChart(container, items, { tooltipLine, highlightKey } = {}) {
  container.innerHTML = "";
  if (items.length === 0) {
    container.innerHTML = `<p class="empty-msg">Sin datos en este período.</p>`;
    return;
  }
  const W = 720, H = 220, padL = 10, padR = 10, padT = 12, padB = 28;
  const max = Math.max(...items.map((d) => d.value), 1);
  const n = items.length;
  const bw = (W - padL - padR) / n;
  const svg = svgEl("svg", { viewBox: `0 0 ${W} ${H}`, width: "100%", height: H, role: "img" });

  [0.25, 0.5, 0.75, 1].forEach((f) => {
    const y = padT + (H - padT - padB) * (1 - f);
    svg.appendChild(svgEl("line", { x1: padL, x2: W - padR, y1: y, y2: y, class: "grid-line" }));
  });
  svg.appendChild(svgEl("line", { x1: padL, x2: W - padR, y1: H - padB, y2: H - padB, class: "axis-line" }));

  items.forEach((d, i) => {
    const h = (d.value / max) * (H - padT - padB);
    const x = padL + i * bw + bw * 0.18;
    const w = bw * 0.64;
    const y = H - padB - h;
    const isHighlight = d.flag === highlightKey;
    const rect = svgEl("rect", {
      x, y, width: w, height: Math.max(h, 2), rx: 4, ry: 4,
      fill: isHighlight ? "var(--accent)" : "var(--s-sandwiches)",
      opacity: d.dim ? 0.5 : 1,
      class: "bar-rect"
    });
    rect.addEventListener("mousemove", (e) => showTip(e, tooltipLine ? tooltipLine(d) : `<b>${d.label}</b><br>${euros(d.value)}`));
    rect.addEventListener("mouseleave", hideTip);
    svg.appendChild(rect);

    if (n <= 16 || i % 2 === 0) {
      const t = svgEl("text", { x: x + w / 2, y: H - padB + 14, "text-anchor": "middle", class: "cat-label" });
      t.textContent = d.label;
      svg.appendChild(t);
    }
  });
  container.appendChild(svg);
}

// ---------- Apilado (mezcla de categorias por semana) ----------
export function stackedBarChart(container, weeks, cats, { fmt = euros, tooltipLabel = (w) => `semana del ${w.label}` } = {}) {
  container.innerHTML = "";
  if (weeks.length === 0) {
    container.innerHTML = `<p class="empty-msg">Sin datos suficientes todavía.</p>`;
    return;
  }
  const W = 620, H = 230, padL = 10, padR = 10, padT = 10, padB = 26;
  const totals = weeks.map((w) => cats.reduce((s, c) => s + (w.values[c.key] || 0), 0));
  const max = Math.max(...totals, 1);
  const n = weeks.length;
  const bw = (W - padL - padR) / n;
  const svg = svgEl("svg", { viewBox: `0 0 ${W} ${H}`, width: "100%", height: H, role: "img" });

  [0.25, 0.5, 0.75, 1].forEach((f) => {
    const y = padT + (H - padT - padB) * (1 - f);
    svg.appendChild(svgEl("line", { x1: padL, x2: W - padR, y1: y, y2: y, class: "grid-line" }));
  });
  svg.appendChild(svgEl("line", { x1: padL, x2: W - padR, y1: H - padB, y2: H - padB, class: "axis-line" }));

  weeks.forEach((w, i) => {
    const x = padL + i * bw + bw * 0.2;
    const barW = bw * 0.6;
    let cursorY = H - padB;
    cats.forEach((c) => {
      const val = w.values[c.key] || 0;
      const h = (val / max) * (H - padT - padB);
      const y = cursorY - h;
      const rect = svgEl("rect", {
        x, y: y + 1, width: barW, height: Math.max(h - 2, 0), rx: 3, ry: 3,
        fill: `var(${c.cssVar})`, class: "bar-rect"
      });
      rect.addEventListener("mousemove", (e) => showTip(e, `<b>${c.label}</b> · ${tooltipLabel(w)}<br>${fmt(val)}`));
      rect.addEventListener("mouseleave", hideTip);
      svg.appendChild(rect);
      cursorY = y;
    });
    const t = svgEl("text", { x: x + barW / 2, y: H - padB + 15, "text-anchor": "middle", class: "cat-label" });
    t.textContent = "sem. " + w.label;
    svg.appendChild(t);
  });
  container.appendChild(svg);
}

// ---------- Tira de calor (patron horario) ----------
export function heatStrip(container, items) {
  container.innerHTML = "";
  if (items.length === 0) {
    container.innerHTML = `<p class="empty-msg">Sin datos en este período.</p>`;
    return;
  }
  const heatSteps = ["--heat-1", "--heat-2", "--heat-3", "--heat-4", "--heat-5", "--heat-6"];
  const W = 620, H = 110, padL = 10, padR = 10, padT = 6, cellH = 46;
  const max = Math.max(...items.map((h) => h.value), 1);
  const n = items.length;
  const cw = (W - padL - padR) / n;
  const svg = svgEl("svg", { viewBox: `0 0 ${W} ${H}`, width: "100%", height: H, role: "img" });

  items.forEach((d, i) => {
    const t = d.value / max;
    const stepIdx = Math.min(heatSteps.length - 1, Math.floor(t * heatSteps.length));
    const x = padL + i * cw;
    const rect = svgEl("rect", {
      x: x + 1, y: padT, width: cw - 2, height: cellH, rx: 5, ry: 5,
      fill: `var(${heatSteps[stepIdx]})`, class: "bar-rect"
    });
    rect.addEventListener("mousemove", (e) => showTip(e, `<b>${d.label}</b><br>${d.value} ventas`));
    rect.addEventListener("mouseleave", hideTip);
    svg.appendChild(rect);

    const label = svgEl("text", { x: x + cw / 2, y: padT + cellH + 16, "text-anchor": "middle", class: "cat-label" });
    label.textContent = d.label;
    svg.appendChild(label);

    if (d.value === max) {
      const peak = svgEl("text", { x: x + cw / 2, y: padT + cellH / 2 + 4, "text-anchor": "middle", fill: "#fff", "font-size": "10.5", "font-weight": "700" });
      peak.textContent = "pico";
      svg.appendChild(peak);
    }
  });
  container.appendChild(svg);
}

export function renderLegend(container, series) {
  container.innerHTML = series.map((s) =>
    `<span class="item"><span class="swatch" style="background:var(${s.cssVar})"></span>${s.label}</span>`
  ).join("");
}

// Paleta generica para comparaciones ad-hoc (top 3 productos, mes A vs mes
// B) que no son las 4 categorias fijas — reutiliza los mismos 4 tonos ya
// validados en vez de inventar colores nuevos sin chequear.
export const SERIES_COLORS = ["--s-sandwiches", "--s-cafe", "--s-bebidas", "--s-bolleria"];

// ---------- Barras agrupadas (ej. Julio vs Agosto por dia de semana) ----------
export function groupedBarChart(container, groupLabels, series, { fmt = euros } = {}) {
  container.innerHTML = "";
  if (groupLabels.length === 0 || series.length === 0) {
    container.innerHTML = `<p class="empty-msg">Sin datos suficientes todavía.</p>`;
    return;
  }
  const W = 620, H = 230, padL = 10, padR = 10, padT = 10, padB = 26;
  const max = Math.max(...series.flatMap((s) => s.data), 1);
  const n = groupLabels.length;
  const groupW = (W - padL - padR) / n;
  const barW = (groupW * 0.72) / series.length;
  const svg = svgEl("svg", { viewBox: `0 0 ${W} ${H}`, width: "100%", height: H, role: "img" });

  [0.25, 0.5, 0.75, 1].forEach((f) => {
    const y = padT + (H - padT - padB) * (1 - f);
    svg.appendChild(svgEl("line", { x1: padL, x2: W - padR, y1: y, y2: y, class: "grid-line" }));
  });
  svg.appendChild(svgEl("line", { x1: padL, x2: W - padR, y1: H - padB, y2: H - padB, class: "axis-line" }));

  groupLabels.forEach((label, gi) => {
    const gx = padL + gi * groupW + groupW * 0.14;
    series.forEach((s, si) => {
      const val = s.data[gi] || 0;
      const h = (val / max) * (H - padT - padB);
      const x = gx + si * barW;
      const y = H - padB - h;
      const rect = svgEl("rect", {
        x, y, width: barW * 0.86, height: Math.max(h, 2), rx: 3, ry: 3,
        fill: `var(${s.cssVar})`, class: "bar-rect"
      });
      rect.addEventListener("mousemove", (e) => showTip(e, `<b>${s.label}</b> · ${label}<br>${fmt(val)}`));
      rect.addEventListener("mouseleave", hideTip);
      svg.appendChild(rect);
    });
    const t = svgEl("text", { x: gx + (barW * series.length) / 2, y: H - padB + 15, "text-anchor": "middle", class: "cat-label" });
    t.textContent = label;
    svg.appendChild(t);
  });
  container.appendChild(svg);
}

// ---------- Lineas (ej. top 3 productos por hora) ----------
export function lineChart(container, xLabels, series, { valueSuffix = "" } = {}) {
  container.innerHTML = "";
  if (xLabels.length === 0 || series.length === 0) {
    container.innerHTML = `<p class="empty-msg">Sin datos suficientes todavía.</p>`;
    return;
  }
  const W = 620, H = 220, padL = 10, padR = 10, padT = 12, padB = 26;
  const max = Math.max(...series.flatMap((s) => s.data), 1);
  const n = xLabels.length;
  const stepX = (W - padL - padR) / Math.max(n - 1, 1);
  const svg = svgEl("svg", { viewBox: `0 0 ${W} ${H}`, width: "100%", height: H, role: "img" });

  [0.25, 0.5, 0.75, 1].forEach((f) => {
    const y = padT + (H - padT - padB) * (1 - f);
    svg.appendChild(svgEl("line", { x1: padL, x2: W - padR, y1: y, y2: y, class: "grid-line" }));
  });
  svg.appendChild(svgEl("line", { x1: padL, x2: W - padR, y1: H - padB, y2: H - padB, class: "axis-line" }));

  const yOf = (v) => H - padB - (v / max) * (H - padT - padB);
  const xOf = (i) => padL + i * stepX;

  series.forEach((s) => {
    const pts = s.data.map((v, i) => [xOf(i), yOf(v)]);
    const d = pts.map((p, i) => (i === 0 ? `M${p[0]},${p[1]}` : `L${p[0]},${p[1]}`)).join(" ");
    svg.appendChild(svgEl("path", { d, fill: "none", stroke: `var(${s.cssVar})`, "stroke-width": 2, "stroke-linecap": "round", "stroke-linejoin": "round" }));
    pts.forEach(([x, y], i) => {
      const dot = svgEl("circle", { cx: x, cy: y, r: 7, fill: "transparent", class: "bar-rect" });
      dot.addEventListener("mousemove", (e) => showTip(e, `<b>${s.label}</b> · ${xLabels[i]}<br>${s.data[i]}${valueSuffix}`));
      dot.addEventListener("mouseleave", hideTip);
      svg.appendChild(dot);
      svg.appendChild(svgEl("circle", { cx: x, cy: y, r: 3, fill: `var(${s.cssVar})`, "pointer-events": "none" }));
    });
  });

  xLabels.forEach((label, i) => {
    if (n > 16 && i % 2 !== 0) return;
    const t = svgEl("text", { x: xOf(i), y: H - padB + 14, "text-anchor": "middle", class: "cat-label" });
    t.textContent = label;
    svg.appendChild(t);
  });
  container.appendChild(svg);
}

// ---------- Ranking (lista con barras) ----------
export function rankingList(container, items) {
  container.innerHTML = "";
  if (items.length === 0) {
    container.innerHTML = `<p class="empty-msg">Sin datos en este período.</p>`;
    return;
  }
  const max = items[0].total;
  items.forEach((p, i) => {
    const row = document.createElement("div");
    row.className = "rank-row";
    row.innerHTML = `
      <span class="n">${i + 1}</span>
      <span class="name">${p.nombre}</span>
      <span class="amt">${euros(p.total)}</span>
      <span class="rank-track"><span class="rank-fill" style="width:${(p.total / max * 100).toFixed(1)}%"></span></span>
    `;
    container.appendChild(row);
  });
}
