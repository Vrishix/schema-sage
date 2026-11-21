import type { DatabaseModel } from "../model/types.js";
import { erdSvg, ERD_CSS } from "./erd.js";
import { esc } from "./escape.js";
import { createHash } from "node:crypto";

/** Filter & interactive script. Inlined and secured by SHA-256 in CSP. */
export const FILTER_SCRIPT = `(function(){
  var filterInput = document.getElementById("filter");
  if(filterInput) {
    filterInput.addEventListener("input", function() {
      var q = filterInput.value.trim().toLowerCase();
      document.querySelectorAll(".table-card").forEach(function(card) {
        var name = (card.getAttribute("data-table") || "").toLowerCase();
        card.style.display = (q === "" || name.indexOf(q) >= 0) ? "" : "none";
      });
      document.querySelectorAll("g.entity").forEach(function(g) {
        var name = (g.getAttribute("data-name") || "").toLowerCase();
        g.style.display = (q === "" || name.indexOf(q) >= 0) ? "" : "none";
      });
    });
  }

  // Zoom controls for ERD
  var currentScale = 1;
  var canvas = document.querySelector(".erd-canvas");
  window.zoomErd = function(delta) {
    if(!canvas) return;
    currentScale = Math.min(2.5, Math.max(0.3, currentScale + delta));
    canvas.style.transform = "scale(" + currentScale + ")";
    canvas.style.transformOrigin = "top left";
  };
  window.resetZoom = function() {
    if(!canvas) return;
    currentScale = 1;
    canvas.style.transform = "none";
  };
  var btnIn = document.getElementById("zoom-in");
  var btnOut = document.getElementById("zoom-out");
  var btnReset = document.getElementById("zoom-reset");
  if(btnIn) btnIn.onclick = function(){ zoomErd(0.15); };
  if(btnOut) btnOut.onclick = function(){ zoomErd(-0.15); };
  if(btnReset) btnReset.onclick = function(){ resetZoom(); };

  // Highlight connections on entity hover
  document.querySelectorAll("g.entity").forEach(function(el) {
    var tableName = el.getAttribute("data-name");
    el.addEventListener("mouseenter", function() {
      document.querySelectorAll(".edge").forEach(function(edge) {
        var from = (edge.getAttribute("data-from") || "").toLowerCase();
        var to = (edge.getAttribute("data-to") || "").toLowerCase();
        if(from === tableName || to === tableName) {
          edge.style.strokeWidth = "3.5";
          edge.style.opacity = "1";
        } else {
          edge.style.opacity = "0.15";
        }
      });
    });
    el.addEventListener("mouseleave", function() {
      document.querySelectorAll(".edge").forEach(function(edge) {
        edge.style.strokeWidth = "";
        edge.style.opacity = "1";
      });
    });
  });
})();`;

export const FILTER_HASH = "sha256-" + createHash("sha256").update(FILTER_SCRIPT).digest("base64");
export { esc };

function appSection(m: DatabaseModel): string {
  const app = m.application;
  if (!app) return "";
  const byTable = new Map<string, { read: number; write: number; delete: number; places: string[] }>();
  for (const u of app.usages) {
    const e = byTable.get(u.table) ?? { read: 0, write: 0, delete: 0, places: [] };
    e[u.operation]++;
    if (e.places.length < 6) e.places.push(`${u.file}:${u.line}${u.fn ? " (" + u.fn + ")" : ""}`);
    byTable.set(u.table, e);
  }
  const rows = [...byTable.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([t, e]) =>
    `<tr><td><strong>${esc(t)}</strong></td><td>${e.read}</td><td>${e.write}</td><td>${e.delete}</td><td>${e.places.map((p) => `<code>${esc(p)}</code>`).join("<br>")}</td></tr>`).join("");
  const flows = app.flows.map((f) =>
    `<tr><td><code>${esc(f.endpoint.method)} ${esc(f.endpoint.path)}</code></td><td>${esc(f.endpoint.handler)}<br><code>${esc(f.endpoint.file)}:${f.endpoint.line}</code></td><td>${f.chain.map((c) => esc(c.fn)).join(" → ")}</td><td>${f.operations.map((o) => `${esc(o.operation)} <strong>${esc(o.table)}</strong> <code>${esc(o.file)}:${o.line}</code>`).join("<br>")}${f.ambiguousCalls.length ? `<br><em>Not followed: ${f.ambiguousCalls.map(esc).join(", ")}</em>` : ""}</td></tr>`).join("");

  return `
  <div class="section-head" id="usage">
    <h2>Application usage</h2>
  </div>
  <div class="table-card">
    <table class="modern-table"><thead><tr><th>Table</th><th>Reads</th><th>Writes</th><th>Deletes</th><th>Where</th></tr></thead><tbody>${rows || "<tr><td colspan=5>No calls found.</td></tr>"}</tbody></table>
  </div>
  <div class="section-head" id="flows">
    <h2>Flows</h2>
  </div>
  <div class="table-card">
    <table class="modern-table"><thead><tr><th>Endpoint</th><th>Handler</th><th>Call Chain</th><th>Database Operations</th></tr></thead><tbody>${flows || "<tr><td colspan=4>No flows mapped.</td></tr>"}</tbody></table>
  </div>
  `;
}

export function databaseHtml(m: DatabaseModel): string {
  const tableCards = m.tables.map((t) => {
    return `
    <div class="table-card" id="${esc(t.name)}" data-table="${esc(t.name)}">
      <div class="table-header">
        <div class="table-title">
          <span class="table-badge">TABLE</span>
          <h3>${esc(t.name)}</h3>
          ${t.dbName && t.dbName !== t.name ? `<span class="db-mapped">mapped to <code>${esc(t.dbName)}</code></span>` : ""}
        </div>
        <div class="column-count">${t.columns.length} columns</div>
      </div>
      <div class="table-body">
        <table class="modern-table">
          <thead>
            <tr>
              <th>Column</th>
              <th>Type</th>
              <th>Attributes</th>
              <th>Source Evidence</th>
            </tr>
          </thead>
          <tbody>
          ${t.columns.map((c) => {
            const isPk = c.isPrimaryKey;
            const isUq = c.isUnique && !isPk;
            const isNull = c.nullable;
            return `
            <tr class="col-row ${isPk ? "row-pk" : ""}">
              <td class="col-name">
                <span class="name-text">${esc(c.name)}</span>
                ${isPk ? `<span class="tag tag-pk">PRIMARY KEY</span>` : ""}
                ${isUq ? `<span class="tag tag-uq">UNIQUE</span>` : ""}
              </td>
              <td class="col-type"><code>${esc(c.type)}</code></td>
              <td class="col-attrs">
                <span class="attr-pill ${isNull ? "nullable" : "not-null"}">${isNull ? "nullable" : "not null"}</span>
                ${c.default ? `<span class="attr-default">default: <code>${esc(c.default)}</code></span>` : ""}
              </td>
              <td class="col-source">
                <code>${esc(c.evidence[0]?.file ?? "")}:${c.evidence[0]?.lines?.[0] ?? ""}</code>
              </td>
            </tr>`;
          }).join("")}
          </tbody>
        </table>
      </div>
    </div>`;
  }).join("");

  const relRows = m.relationships.map((r, idx) => `
    <tr id="rel-${idx}" class="rel-row">
      <td><code class="from-pill">${esc(r.from)}</code></td>
      <td class="arrow-cell">→</td>
      <td><code class="to-pill">${esc(r.to)}</code></td>
      <td><span class="cardinality-badge">${esc(r.cardinality)}</span></td>
      <td><span class="enforcement-badge ${esc(r.enforcement)}">${esc(r.enforcement)}</span></td>
    </tr>
  `).join("");

  const findings = m.findings.length
    ? m.findings.map((f) => `
      <div class="finding-card">
        <div class="finding-title"><strong>${esc(f.category)}</strong></div>
        <p class="finding-desc">${esc(f.explanation)}</p>
        <div class="finding-recom">💡 ${esc(f.recommendation)}</div>
      </div>`).join("")
    : `<div class="empty-state">No schema warnings or findings. Everything looks clean!</div>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src '${FILTER_HASH}'; img-src 'self' data:">
<title>SchemaSage Database Report: ${esc(m.source.adapter)}</title>
<style>
:root {
  --font: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  --mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  --bg: #f8fafc;
  --canvas-bg: #f1f5f9;
  --fg: #0f172a;
  --muted: #64748b;
  --line: #e2e8f0;
  --card-bg: #ffffff;
  --card-border: #e2e8f0;
  --card-head: #f8fafc;
  --accent: #3b82f6;
  --accent-light: #eff6ff;
  --accent-dark: #1d4ed8;
  --accent-hover: #2563eb;
  --solid: #0d9488;
  --dash: #d97706;
  --amber-light: #fef3c7;
  --header-bg: #ffffff;
}

@media (prefers-color-scheme: dark) {
  :root {
    --bg: #0b0f19;
    --canvas-bg: #070a12;
    --fg: #f1f5f9;
    --muted: #94a3b8;
    --line: #1e293b;
    --card-bg: #111827;
    --card-border: #1f2937;
    --card-head: #172033;
    --accent: #60a5fa;
    --accent-light: #1e3a8a;
    --accent-dark: #93c5fd;
    --accent-hover: #3b82f6;
    --solid: #2dd4bf;
    --dash: #fbbf24;
    --amber-light: #78350f;
    --header-bg: #111827;
  }
}

* { box-sizing: border-box; }
body {
  font-family: var(--font);
  margin: 0;
  padding: 0;
  color: var(--fg);
  background: var(--bg);
  line-height: 1.6;
}

header {
  background: var(--header-bg);
  border-bottom: 1px solid var(--line);
  padding: 24px 32px;
  position: sticky;
  top: 0;
  z-index: 100;
  backdrop-filter: blur(8px);
}

.header-container {
  max-width: 1400px;
  margin: 0 auto;
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 16px;
}

.brand-title {
  display: flex;
  align-items: center;
  gap: 12px;
}

.logo-badge {
  background: linear-gradient(135deg, #3b82f6, #06b6d4);
  color: #fff;
  font-weight: 800;
  padding: 4px 10px;
  border-radius: 8px;
  font-size: 13px;
  letter-spacing: 0.5px;
}

h1 {
  font-size: 22px;
  font-weight: 700;
  margin: 0;
  letter-spacing: -0.5px;
}

.sub {
  color: var(--muted);
  font-size: 13px;
  margin: 4px 0 0;
}

nav {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

nav a {
  color: var(--muted);
  text-decoration: none;
  font-weight: 600;
  font-size: 13px;
  padding: 6px 12px;
  border-radius: 8px;
  transition: all 0.15s;
}

nav a:hover {
  color: var(--fg);
  background: var(--line);
}

main {
  max-width: 1400px;
  margin: 0 auto;
  padding: 32px;
}

.stats-bar {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 16px;
  margin-bottom: 32px;
}

.stat-box {
  background: var(--card-bg);
  border: 1px solid var(--card-border);
  padding: 16px 20px;
  border-radius: 12px;
  box-shadow: 0 1px 3px rgba(0,0,0,0.03);
}

.stat-label {
  font-size: 12px;
  color: var(--muted);
  text-transform: uppercase;
  font-weight: 600;
  letter-spacing: 0.5px;
}

.stat-value {
  font-size: 26px;
  font-weight: 800;
  margin-top: 4px;
}

.section-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 16px;
  margin: 40px 0 16px;
}

.section-head h2 {
  font-size: 19px;
  font-weight: 700;
  margin: 0;
  display: flex;
  align-items: center;
  gap: 8px;
}

.search-box {
  display: flex;
  align-items: center;
  gap: 10px;
  background: var(--card-bg);
  border: 1px solid var(--card-border);
  padding: 6px 14px;
  border-radius: 10px;
  width: 100%;
  max-width: 320px;
}

.search-box input {
  border: none;
  background: transparent;
  outline: none;
  color: var(--fg);
  font-size: 14px;
  width: 100%;
}

.zoom-bar {
  display: flex;
  gap: 6px;
}

.btn-ctrl {
  background: var(--card-bg);
  border: 1px solid var(--card-border);
  color: var(--fg);
  font-size: 13px;
  font-weight: 600;
  padding: 6px 12px;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.15s;
}

.btn-ctrl:hover {
  background: var(--line);
}

.table-card {
  background: var(--card-bg);
  border: 1px solid var(--card-border);
  border-radius: 14px;
  margin-bottom: 24px;
  overflow: hidden;
  box-shadow: 0 2px 5px rgba(0,0,0,0.02);
  transition: border-color 0.2s, box-shadow 0.2s;
}

.table-card:hover {
  border-color: var(--accent);
  box-shadow: 0 6px 18px rgba(0,0,0,0.05);
}

.table-header {
  padding: 16px 20px;
  background: var(--card-head);
  border-bottom: 1px solid var(--line);
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.table-title {
  display: flex;
  align-items: center;
  gap: 10px;
}

.table-badge {
  background: var(--line);
  color: var(--muted);
  font-size: 10px;
  font-weight: 700;
  padding: 3px 6px;
  border-radius: 4px;
}

.table-title h3 {
  margin: 0;
  font-size: 16px;
  font-weight: 700;
}

.db-mapped {
  font-size: 12px;
  color: var(--muted);
}

.column-count {
  font-size: 12px;
  color: var(--muted);
  font-weight: 500;
}

.modern-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
  text-align: left;
}

.modern-table th {
  padding: 10px 16px;
  background: var(--card-head);
  color: var(--muted);
  font-weight: 600;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  border-bottom: 1px solid var(--line);
}

.modern-table td {
  padding: 10px 16px;
  border-bottom: 1px solid var(--line);
  vertical-align: middle;
}

.modern-table tr:last-child td {
  border-bottom: none;
}

.modern-table tr:hover {
  background: rgba(59, 130, 246, 0.03);
}

.name-text {
  font-weight: 600;
  font-family: var(--mono);
}

.tag {
  display: inline-block;
  font-size: 9px;
  font-weight: 700;
  padding: 2px 5px;
  border-radius: 4px;
  margin-left: 6px;
  vertical-align: middle;
}

.tag-pk {
  background: var(--accent-light);
  color: var(--accent);
}

.tag-uq {
  background: var(--amber-light);
  color: var(--dash);
}

code {
  font-family: var(--mono);
  font-size: 12px;
  background: var(--line);
  padding: 2px 6px;
  border-radius: 5px;
}

.attr-pill {
  font-size: 11px;
  font-weight: 500;
  padding: 2px 7px;
  border-radius: 10px;
}

.attr-pill.not-null {
  background: rgba(13, 148, 136, 0.12);
  color: var(--solid);
}

.attr-pill.nullable {
  background: rgba(100, 116, 139, 0.12);
  color: var(--muted);
}

.attr-default {
  font-size: 11px;
  color: var(--muted);
  margin-left: 8px;
}

.from-pill, .to-pill {
  font-weight: 600;
}

.arrow-cell {
  color: var(--muted);
  font-size: 16px;
  text-align: center;
}

.cardinality-badge {
  background: var(--line);
  font-size: 11px;
  font-weight: 600;
  padding: 3px 8px;
  border-radius: 6px;
}

.enforcement-badge {
  font-size: 11px;
  font-weight: 700;
  padding: 3px 8px;
  border-radius: 6px;
}

.enforcement-badge.db-enforced {
  background: rgba(13, 148, 136, 0.12);
  color: var(--solid);
}

.enforcement-badge.orm-declared {
  background: rgba(217, 119, 6, 0.12);
  color: var(--dash);
}

.finding-card {
  background: var(--card-bg);
  border: 1px solid var(--card-border);
  border-left: 4px solid var(--accent);
  padding: 16px;
  border-radius: 8px;
  margin-bottom: 12px;
}

.finding-title {
  font-size: 14px;
  margin-bottom: 4px;
}

.finding-desc {
  font-size: 13px;
  color: var(--muted);
  margin: 0 0 8px;
}

.finding-recom {
  font-size: 12px;
  font-weight: 500;
}

.empty-state {
  padding: 32px;
  text-align: center;
  color: var(--muted);
  background: var(--card-bg);
  border: 1px dashed var(--line);
  border-radius: 12px;
}

${ERD_CSS}
</style>
</head>
<body>

<header>
  <div class="header-container">
    <div class="brand-title">
      <span class="logo-badge">SCHEMASAGE</span>
      <div>
        <h1>Database Architecture</h1>
        <div class="sub">Adapter: <strong>${esc(m.source.adapter)}</strong> &bull; Generated: ${new Date(m.generatedAt).toLocaleString()}</div>
      </div>
    </div>
    <nav aria-label="Main Sections">
      <a href="#erd">Diagram</a>
      <a href="#tables">Tables (${m.tables.length})</a>
      <a href="#relationships">Relationships (${m.relationships.length})</a>
      <a href="#findings">Findings (${m.findings.length})</a>
      <a href="#coverage">Coverage</a>
    </nav>
  </div>
</header>

<main>
  <div class="stats-bar">
    <div class="stat-box">
      <div class="stat-label">Tables / Collections</div>
      <div class="stat-value">${m.tables.length}</div>
    </div>
    <div class="stat-box">
      <div class="stat-label">Total Columns</div>
      <div class="stat-value">${m.tables.reduce((sum, t) => sum + t.columns.length, 0)}</div>
    </div>
    <div class="stat-box">
      <div class="stat-label">Relationships</div>
      <div class="stat-value">${m.relationships.length}</div>
    </div>
    <div class="stat-box">
      <div class="stat-label">Adapter Engine</div>
      <div class="stat-value" style="font-size: 18px; line-height: 38px;">${esc(m.source.adapter)}</div>
    </div>
  </div>

  <div class="section-head" id="erd">
    <h2>Interactive Entity-Relationship Diagram</h2>
    <div class="zoom-bar">
      <button id="zoom-in" class="btn-ctrl" title="Zoom in">+</button>
      <button id="zoom-out" class="btn-ctrl" title="Zoom out">-</button>
      <button id="zoom-reset" class="btn-ctrl" title="Reset Zoom">Reset</button>
    </div>
  </div>

  <div class="erd-wrap">
    ${erdSvg(m)}
  </div>

  <div class="section-head" id="tables">
    <h2>Tables &amp; Schemas (${m.tables.length})</h2>
    <div class="search-box">
      <input id="filter" type="search" placeholder="Quick filter tables / columns..." autocomplete="off">
    </div>
  </div>

  <div class="tables-container">
    ${tableCards}
  </div>

  ${appSection(m)}

  <div class="section-head" id="relationships">
    <h2>Relationships (${m.relationships.length})</h2>
  </div>

  <div class="table-card">
    <table class="modern-table">
      <thead>
        <tr>
          <th>From</th>
          <th></th>
          <th>To</th>
          <th>Cardinality</th>
          <th>Enforcement</th>
        </tr>
      </thead>
      <tbody>
        ${relRows}
      </tbody>
    </table>
  </div>

  <div class="section-head" id="findings">
    <h2>Schema Insights &amp; Findings (${m.findings.length})</h2>
  </div>
  ${findings}

  <div class="section-head" id="coverage">
    <h2>Coverage &amp; Inspected Sources</h2>
  </div>
  <div class="table-card" style="padding: 20px;">
    <p><strong>Files Scanned (${m.coverage.filesScanned.length}):</strong></p>
    <p style="font-size: 12px; line-height: 1.8;">
      ${m.coverage.filesScanned.map((f) => `<code>${esc(f)}</code>`).join(" ")}
    </p>
  </div>
</main>

<script>${FILTER_SCRIPT}</script>
</body>
</html>
`;
}
