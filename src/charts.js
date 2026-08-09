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
export function stackedBarChart(container, weeks, cats) {
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
      rect.addEventListener("mousemove", (e) => showTip(e, `<b>${c.label}</b> · semana del ${w.label}<br>${euros(val)}`));
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
