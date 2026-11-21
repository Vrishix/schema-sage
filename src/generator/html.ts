import type { DatabaseModel } from "../model/types.js";
import { erdSvg, ERD_CSS } from "./erd.js";
import { esc } from "./escape.js";
import { createHash } from "node:crypto";

/** Filter, interactive diagram, pan/zoom, detail modal, collapsible sidebar, and Archify-style relationship inspection tooltip. */
export const FILTER_SCRIPT = `(function(){
  // 1. Search & Filter across table cards, ERD entities, and Sidebar links
  var filterInput = document.getElementById("filter");
  var sidebarFilter = document.getElementById("sidebar-filter");

  function handleFilter(q) {
    q = q.trim().toLowerCase();
    document.querySelectorAll(".table-card").forEach(function(card) {
      var name = (card.getAttribute("data-table") || "").toLowerCase();
      card.style.display = (q === "" || name.indexOf(q) >= 0) ? "" : "none";
    });
    document.querySelectorAll("g.entity").forEach(function(g) {
      var name = (g.getAttribute("data-name") || "").toLowerCase();
      g.style.display = (q === "" || name.indexOf(q) >= 0) ? "" : "none";
    });
    document.querySelectorAll(".sidebar-table-item").forEach(function(item) {
      var name = (item.getAttribute("data-name") || "").toLowerCase();
      item.style.display = (q === "" || name.indexOf(q) >= 0) ? "" : "none";
    });
  }

  if(filterInput) {
    filterInput.addEventListener("input", function() {
      if(sidebarFilter) sidebarFilter.value = filterInput.value;
      handleFilter(filterInput.value);
    });
  }
  if(sidebarFilter) {
    sidebarFilter.addEventListener("input", function() {
      if(filterInput) filterInput.value = sidebarFilter.value;
      handleFilter(sidebarFilter.value);
    });
  }

  // 2. Sidebar Toggle (ChatGPT style slide out / in)
  var sidebar = document.getElementById("sidebar");
  var toggleBtn = document.getElementById("sidebar-toggle");

  function toggleSidebar() {
    if(!sidebar) return;
    sidebar.classList.toggle("collapsed");
    document.body.classList.toggle("sidebar-closed");
  }

  if(toggleBtn) toggleBtn.onclick = toggleSidebar;

  // 3. Pan and Zoom controls for ERD
  var currentScale = 1;
  var panX = 0, panY = 0;
  var isPanning = false;
  var startX = 0, startY = 0;
  var canvas = document.querySelector(".erd-canvas");
  var wrap = document.querySelector(".erd-wrap");

  function applyTransform() {
    if(!canvas) return;
    canvas.style.transform = "translate(" + panX + "px, " + panY + "px) scale(" + currentScale + ")";
    canvas.style.transformOrigin = "top left";
    var scaleIndicator = document.getElementById("zoom-indicator");
    if(scaleIndicator) scaleIndicator.textContent = Math.round(currentScale * 100) + "%";
  }

  window.zoomErd = function(delta) {
    currentScale = Math.min(3, Math.max(0.2, currentScale + delta));
    applyTransform();
  };
  window.resetZoom = function() {
    currentScale = 1;
    panX = 0;
    panY = 0;
    applyTransform();
  };

  var btnIn = document.getElementById("zoom-in");
  var btnOut = document.getElementById("zoom-out");
  var btnReset = document.getElementById("zoom-reset");
  if(btnIn) btnIn.onclick = function(){ zoomErd(0.15); };
  if(btnOut) btnOut.onclick = function(){ zoomErd(-0.15); };
  if(btnReset) btnReset.onclick = function(){ resetZoom(); };

  if(wrap && canvas) {
    wrap.addEventListener("mousedown", function(e) {
      if(e.target.closest(".edge-group") || e.target.closest(".entity")) return;
      isPanning = true;
      startX = e.clientX - panX;
      startY = e.clientY - panY;
      wrap.style.cursor = "grabbing";
    });
    window.addEventListener("mousemove", function(e) {
      if(!isPanning) return;
      panX = e.clientX - startX;
      panY = e.clientY - startY;
      applyTransform();
    });
    window.addEventListener("mouseup", function() {
      isPanning = false;
      if(wrap) wrap.style.cursor = "grab";
    });
    wrap.addEventListener("wheel", function(e) {
      if(e.ctrlKey || e.metaKey) {
        e.preventDefault();
        var delta = e.deltaY < 0 ? 0.1 : -0.1;
        zoomErd(delta);
      }
    });
  }

  // 4. Archify-Style Relationship Inspector Tooltip
  var tooltip = document.getElementById("rel-tooltip");

  function showRelTooltip(e, fromT, toT, fromC, toC, card, enf, src) {
    if(!tooltip) return;
    var badgeClass = enf === "db-enforced" ? "db-enforced" : "orm-declared";
    var enfText = enf === "db-enforced" ? "Database Enforced (Foreign Key)" : "ORM Declared (Application Virtual)";
    
    tooltip.innerHTML = 
      '<div class="tt-header">' +
        '<span class="tt-title">Relationship Link</span>' +
        '<span class="tt-badge ' + badgeClass + '">' + card + '</span>' +
      '</div>' +
      '<div class="tt-body">' +
        '<div class="tt-flow">' +
          '<div class="tt-endpoint">' +
            '<span class="tt-table">' + fromT + '</span>' +
            '<span class="tt-col">.' + fromC + '</span>' +
          '</div>' +
          '<div class="tt-arrow">→</div>' +
          '<div class="tt-endpoint">' +
            '<span class="tt-table">' + toT + '</span>' +
            '<span class="tt-col">.' + toC + '</span>' +
          '</div>' +
        '</div>' +
        '<div class="tt-meta">' +
          '<div class="tt-meta-item"><strong>Enforcement:</strong> <span class="' + badgeClass + '">' + enfText + '</span></div>' +
          (src ? '<div class="tt-meta-item"><strong>Source:</strong> <code>' + src + '</code></div>' : '') +
        '</div>' +
      '</div>';

    tooltip.style.display = "block";
    updateTooltipPos(e);
  }

  function updateTooltipPos(e) {
    if(!tooltip || tooltip.style.display !== "block") return;
    var x = e.clientX + 16;
    var y = e.clientY + 16;
    var w = tooltip.offsetWidth || 300;
    var h = tooltip.offsetHeight || 160;
    if(x + w > window.innerWidth - 20) x = e.clientX - w - 16;
    if(y + h > window.innerHeight - 20) y = e.clientY - h - 16;
    tooltip.style.left = x + "px";
    tooltip.style.top = y + "px";
  }

  function hideRelTooltip() {
    if(tooltip) tooltip.style.display = "none";
  }

  document.querySelectorAll(".edge-group").forEach(function(group) {
    group.addEventListener("mouseenter", function(e) {
      var fromT = group.getAttribute("data-from") || "";
      var toT = group.getAttribute("data-to") || "";
      var fromC = group.getAttribute("data-from-col") || "";
      var toC = group.getAttribute("data-to-col") || "";
      var card = group.getAttribute("data-card") || "";
      var enf = group.getAttribute("data-enf") || "";
      var src = group.getAttribute("data-src") || "";

      document.querySelectorAll(".edge").forEach(function(edge) {
        edge.style.opacity = "0.1";
      });
      var edgeEl = group.querySelector(".edge");
      if(edgeEl) {
        edgeEl.style.opacity = "1";
        edgeEl.style.strokeWidth = "4";
      }
      showRelTooltip(e, fromT, toT, fromC, toC, card, enf, src);
    });

    group.addEventListener("mousemove", function(e) {
      updateTooltipPos(e);
    });

    group.addEventListener("mouseleave", function() {
      document.querySelectorAll(".edge").forEach(function(edge) {
        edge.style.strokeWidth = "";
        edge.style.opacity = "1";
      });
      hideRelTooltip();
    });

    group.addEventListener("click", function() {
      var relIdx = group.getAttribute("data-rel");
      var target = document.getElementById("rel-" + relIdx);
      if(target) {
        target.scrollIntoView({ behavior: "smooth", block: "center" });
        target.classList.add("highlight-flash");
        setTimeout(function(){ target.classList.remove("highlight-flash"); }, 2000);
      }
    });
  });

  // 5. Highlight connections on entity hover & click to jump
  document.querySelectorAll("g.entity").forEach(function(el) {
    var tableName = el.getAttribute("data-name");
    el.addEventListener("mouseenter", function() {
      document.querySelectorAll(".edge").forEach(function(edge) {
        var from = (edge.getAttribute("data-from") || "").toLowerCase();
        var to = (edge.getAttribute("data-to") || "").toLowerCase();
        if(from === tableName || to === tableName) {
          edge.style.strokeWidth = "3.8";
          edge.style.opacity = "1";
        } else {
          edge.style.opacity = "0.12";
        }
      });
    });
    el.addEventListener("mouseleave", function() {
      document.querySelectorAll(".edge").forEach(function(edge) {
        edge.style.strokeWidth = "";
        edge.style.opacity = "1";
      });
    });

    el.addEventListener("click", function() {
      jumpToTable(tableName);
    });
  });

  // 6. Jump to Table Card with visual flash
  window.jumpToTable = function(tableName) {
    var target = document.getElementById(tableName);
    if(target) {
      target.scrollIntoView({ behavior: "smooth", block: "center" });
      target.classList.add("highlight-flash");
      setTimeout(function(){ target.classList.remove("highlight-flash"); }, 2000);
      document.querySelectorAll(".sidebar-table-item").forEach(function(it) {
        it.classList.toggle("active", (it.getAttribute("data-name") || "").toLowerCase() === tableName.toLowerCase());
      });
    }
  };

  document.querySelectorAll(".sidebar-table-item").forEach(function(item) {
    item.addEventListener("click", function(e) {
      e.preventDefault();
      var tName = item.getAttribute("data-name");
      jumpToTable(tName);
    });
  });

  // 7. Diagram View Mode Switcher (Visual Canvas vs Mermaid Code)
  var tabVisual = document.getElementById("tab-visual");
  var tabMermaid = document.getElementById("tab-mermaid");
  var viewVisual = document.getElementById("view-visual");
  var viewMermaid = document.getElementById("view-mermaid");

  if(tabVisual && tabMermaid && viewVisual && viewMermaid) {
    tabVisual.onclick = function() {
      tabVisual.classList.add("active");
      tabMermaid.classList.remove("active");
      viewVisual.style.display = "block";
      viewMermaid.style.display = "none";
    };
    tabMermaid.onclick = function() {
      tabMermaid.classList.add("active");
      tabVisual.classList.remove("active");
      viewVisual.style.display = "none";
      viewMermaid.style.display = "block";
    };
  }

  // 8. Copy Mermaid Code
  var copyBtn = document.getElementById("btn-copy-mermaid");
  if(copyBtn) {
    copyBtn.onclick = function() {
      var code = document.getElementById("mermaid-code");
      if(code) {
        navigator.clipboard.writeText(code.textContent).then(function() {
          copyBtn.textContent = "Copied to clipboard!";
          setTimeout(function(){ copyBtn.textContent = "Copy Mermaid Code"; }, 2000);
        });
      }
    };
  }
})();`;

export const FILTER_HASH = "sha256-" + createHash("sha256").update(FILTER_SCRIPT).digest("base64");
export { esc };

function generateMermaidEr(m: DatabaseModel): string {
  const lines: string[] = ["erDiagram"];
  for (const t of m.tables) {
    lines.push(`    ${t.name} {`);
    for (const c of t.columns) {
      const typeClean = c.type.replace(/[^a-zA-Z0-9_]/g, "_");
      const keyType = c.isPrimaryKey ? "PK" : c.isUnique ? "UK" : "";
      lines.push(`        ${typeClean} ${c.name} ${keyType}`);
    }
    lines.push(`    }`);
  }

  for (const r of m.relationships) {
    const fromT = r.from.replace(/^column:/, "").split(".")[0];
    const toT = r.to.replace(/^column:/, "").split(".")[0];
    let relSymbol = "||--o{";
    if (r.cardinality === "one-to-one") relSymbol = "||--||";
    if (r.cardinality === "many-to-many") relSymbol = "}o--o{";
    lines.push(`    ${toT} ${relSymbol} ${fromT} : "${r.enforcement}"`);
  }

  return lines.join("\n");
}

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
  const mermaidCode = generateMermaidEr(m);

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
                ${isPk ? `<span class="tag tag-pk" title="Primary Key">PRIMARY KEY</span>` : ""}
                ${isUq ? `<span class="tag tag-uq" title="Unique Constraint">UNIQUE</span>` : ""}
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

  const sidebarItems = m.tables.map((t) => `
    <a href="#${esc(t.name)}" class="sidebar-table-item" data-name="${esc(t.name)}" title="${esc(t.name)} (${t.columns.length} columns)">
      <span class="sidebar-item-name">${esc(t.name)}</span>
      <span class="sidebar-item-count">${t.columns.length}</span>
    </a>
  `).join("");

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
    : `<div class="empty-state">No schema warnings or findings. Everything looks clean and optimized!</div>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src '${FILTER_HASH}'; img-src 'self' data:">
<title>SchemaSage Database Architecture &amp; ER Explorer</title>
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
  --sidebar-w: 280px;
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
  display: flex;
}

/* Sidebar */
#sidebar {
  width: var(--sidebar-w);
  height: 100vh;
  position: sticky;
  top: 0;
  background: var(--card-bg);
  border-right: 1px solid var(--line);
  display: flex;
  flex-direction: column;
  transition: transform 0.25s cubic-bezier(0.16, 1, 0.3, 1), margin-left 0.25s cubic-bezier(0.16, 1, 0.3, 1);
  z-index: 1000;
  flex-shrink: 0;
}

#sidebar.collapsed {
  margin-left: calc(-1 * var(--sidebar-w));
}

.sidebar-header {
  padding: 18px 20px;
  border-bottom: 1px solid var(--line);
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.sidebar-brand {
  font-weight: 800;
  font-size: 14px;
  letter-spacing: 0.5px;
  display: flex;
  align-items: center;
  gap: 8px;
}

.sidebar-search-box {
  padding: 12px 16px;
  border-bottom: 1px solid var(--line);
}

.sidebar-search-box input {
  width: 100%;
  background: var(--card-head);
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 6px 12px;
  font-size: 13px;
  color: var(--fg);
  outline: none;
}

.sidebar-search-box input:focus {
  border-color: var(--accent);
}

.sidebar-list {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.sidebar-table-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 7px 12px;
  border-radius: 8px;
  color: var(--fg);
  text-decoration: none;
  font-size: 13px;
  font-weight: 500;
  transition: all 0.12s;
  position: relative;
}

.sidebar-table-item:hover {
  background: var(--card-head);
  color: var(--accent);
}

.sidebar-table-item.active {
  background: var(--accent-light);
  color: var(--accent);
  font-weight: 600;
}

.sidebar-item-name {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 190px;
}

.sidebar-item-count {
  font-size: 11px;
  background: var(--line);
  padding: 1px 6px;
  border-radius: 10px;
  color: var(--muted);
}

/* App Main Container */
.app-container {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

header {
  background: var(--header-bg);
  border-bottom: 1px solid var(--line);
  padding: 16px 28px;
  position: sticky;
  top: 0;
  z-index: 99;
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
  gap: 14px;
}

.sidebar-toggle-btn {
  background: var(--card-bg);
  border: 1px solid var(--line);
  color: var(--fg);
  padding: 6px 10px;
  border-radius: 8px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 15px;
  transition: all 0.15s;
}

.sidebar-toggle-btn:hover {
  background: var(--line);
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
  font-size: 20px;
  font-weight: 700;
  margin: 0;
  letter-spacing: -0.5px;
}

.sub {
  color: var(--muted);
  font-size: 12.5px;
  margin: 2px 0 0;
}

nav {
  display: flex;
  gap: 6px;
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
  width: 100%;
  margin: 0 auto;
  padding: 28px 32px;
}

/* Learning Guide Banner */
.learning-guide {
  background: linear-gradient(135deg, rgba(59, 130, 246, 0.08), rgba(6, 182, 212, 0.08));
  border: 1px solid rgba(59, 130, 246, 0.25);
  border-radius: 14px;
  padding: 18px 24px;
  margin-bottom: 28px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.guide-header {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 700;
  font-size: 14.5px;
  color: var(--accent);
}
.guide-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  gap: 16px;
  font-size: 13px;
}
.guide-item {
  background: var(--card-bg);
  border: 1px solid var(--card-border);
  border-radius: 10px;
  padding: 12px 16px;
}
.guide-item strong {
  display: block;
  margin-bottom: 4px;
  color: var(--fg);
}
.guide-item p {
  margin: 0;
  color: var(--muted);
  line-height: 1.4;
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

.diagram-mode-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
}

.tabs-ctrl {
  display: inline-flex;
  background: var(--card-head);
  padding: 3px;
  border-radius: 10px;
  border: 1px solid var(--card-border);
}

.tab-btn {
  background: transparent;
  border: none;
  font-size: 13px;
  font-weight: 600;
  padding: 6px 14px;
  border-radius: 7px;
  cursor: pointer;
  color: var(--muted);
  transition: all 0.15s;
}

.tab-btn.active {
  background: var(--card-bg);
  color: var(--fg);
  box-shadow: 0 1px 3px rgba(0,0,0,0.08);
}

.zoom-bar {
  display: flex;
  align-items: center;
  gap: 6px;
}

.zoom-indicator {
  font-size: 12px;
  font-weight: 600;
  color: var(--muted);
  min-width: 45px;
  text-align: center;
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

.erd-wrap {
  position: relative;
  overflow: hidden;
  max-height: 82vh;
  min-height: 520px;
  border: 1px solid var(--card-border);
  border-radius: 16px;
  background: var(--canvas-bg);
  padding: 16px;
  cursor: grab;
  box-shadow: inset 0 2px 6px rgba(0,0,0,0.02);
}

.erd-hint {
  position: absolute;
  bottom: 16px;
  right: 16px;
  background: rgba(0, 0, 0, 0.7);
  color: #fff;
  font-size: 11px;
  padding: 6px 12px;
  border-radius: 20px;
  pointer-events: none;
  z-index: 10;
}

/* Archify-Style Floating Tooltip */
#rel-tooltip {
  display: none;
  position: fixed;
  z-index: 2000;
  pointer-events: none;
  background: var(--card-bg);
  border: 1px solid var(--card-border);
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.18), 0 2px 6px rgba(0, 0, 0, 0.08);
  border-radius: 12px;
  padding: 14px 18px;
  width: 310px;
  max-width: 90vw;
  backdrop-filter: blur(12px);
  animation: popIn 0.12s cubic-bezier(0.16, 1, 0.3, 1);
}

@keyframes popIn {
  from { opacity: 0; transform: scale(0.96) translateY(4px); }
  to { opacity: 1; transform: scale(1) translateY(0); }
}

.tt-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-bottom: 1px solid var(--line);
  padding-bottom: 8px;
  margin-bottom: 10px;
}

.tt-title {
  font-size: 12px;
  font-weight: 700;
  color: var(--muted);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.tt-badge {
  font-size: 11px;
  font-weight: 700;
  padding: 2px 7px;
  border-radius: 6px;
}

.tt-badge.db-enforced {
  background: rgba(13, 148, 136, 0.14);
  color: var(--solid);
}

.tt-badge.orm-declared {
  background: rgba(217, 119, 6, 0.14);
  color: var(--dash);
}

.tt-flow {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: var(--card-head);
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 8px 12px;
  margin-bottom: 10px;
}

.tt-endpoint {
  display: flex;
  flex-direction: column;
}

.tt-table {
  font-weight: 700;
  font-size: 13px;
}

.tt-col {
  font-family: var(--mono);
  font-size: 11px;
  color: var(--accent);
}

.tt-arrow {
  color: var(--muted);
  font-size: 15px;
}

.tt-meta {
  font-size: 12px;
  color: var(--muted);
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.tt-meta-item strong {
  color: var(--fg);
}

.mermaid-container {
  display: none;
  background: var(--card-bg);
  border: 1px solid var(--card-border);
  border-radius: 16px;
  padding: 24px;
}
.mermaid-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}
.mermaid-code-box {
  background: var(--card-head);
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 16px;
  font-family: var(--mono);
  font-size: 13px;
  overflow: auto;
  max-height: 600px;
  white-space: pre;
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

.table-card {
  background: var(--card-bg);
  border: 1px solid var(--card-border);
  border-radius: 14px;
  margin-bottom: 24px;
  overflow: hidden;
  box-shadow: 0 2px 5px rgba(0,0,0,0.02);
  transition: border-color 0.2s, box-shadow 0.2s, background-color 0.5s;
}

.table-card.highlight-flash {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.35);
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

<!-- Left Collapsible Sidebar -->
<aside id="sidebar">
  <div class="sidebar-header">
    <div class="sidebar-brand">
      <span class="logo-badge" style="padding: 2px 7px; font-size: 11px;">TABLES</span>
      <span>Catalog (${m.tables.length})</span>
    </div>
  </div>
  <div class="sidebar-search-box">
    <input id="sidebar-filter" type="search" placeholder="Find table..." autocomplete="off">
  </div>
  <div class="sidebar-list">
    ${sidebarItems}
  </div>
</aside>

<!-- App Right Content -->
<div class="app-container">
  <header>
    <div class="header-container">
      <div class="brand-title">
        <button id="sidebar-toggle" class="sidebar-toggle-btn" title="Toggle Tables Sidebar">☰</button>
        <span class="logo-badge">SCHEMASAGE</span>
        <div>
          <h1>Database Architecture</h1>
          <div class="sub">Adapter: <strong>${esc(m.source.adapter)}</strong> &bull; Generated: ${new Date(m.generatedAt).toLocaleString()}</div>
        </div>
      </div>
      <nav aria-label="Main Sections">
        <a href="#erd">Diagrams</a>
        <a href="#tables">Tables (${m.tables.length})</a>
        <a href="#relationships">Relationships (${m.relationships.length})</a>
        <a href="#findings">Findings (${m.findings.length})</a>
        <a href="#coverage">Coverage</a>
      </nav>
    </div>
  </header>

  <main>
    <div class="learning-guide">
      <div class="guide-header">
        <span>💡</span> Quick Architectural Guide: Understanding This Database
      </div>
      <div class="guide-grid">
        <div class="guide-item">
          <strong>1. Solid vs. Dashed Lines</strong>
          <p><span class="enforcement-badge db-enforced">Solid Line</span> = Enforced by DB Foreign Keys. <span class="enforcement-badge orm-declared">Dashed Line</span> = Declared at ORM level only.</p>
        </div>
        <div class="guide-item">
          <strong>2. Archify-Style Inspector Tooltip</strong>
          <p>Hover over any relationship line or connection dot to inspect precise table/column linkages, cardinality, and source line numbers.</p>
        </div>
        <div class="guide-item">
          <strong>3. Export to Mermaid &amp; Docs</strong>
          <p>Toggle to the <strong>Mermaid ERD</strong> tab to copy raw diagram code for GitHub PRs, Markdown notes, or documentation.</p>
        </div>
      </div>
    </div>

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
      <h2>Entity-Relationship Diagrams</h2>
      <div class="diagram-mode-bar">
        <div class="tabs-ctrl">
          <button id="tab-visual" class="tab-btn active">Visual Canvas</button>
          <button id="tab-mermaid" class="tab-btn">Mermaid Code &amp; Export</button>
        </div>
        <div class="zoom-bar">
          <button id="zoom-in" class="btn-ctrl" title="Zoom In">+</button>
          <span id="zoom-indicator" class="zoom-indicator">100%</span>
          <button id="zoom-out" class="btn-ctrl" title="Zoom Out">-</button>
          <button id="zoom-reset" class="btn-ctrl" title="Reset View">Reset</button>
        </div>
      </div>
    </div>

    <div id="view-visual" class="erd-wrap">
      ${erdSvg(m)}
      <div class="erd-hint">Click &amp; drag canvas to pan &bull; Hover lines to inspect relationships &bull; Click to view table card</div>
    </div>

    <!-- Archify-style Floating Relationship Inspector Tooltip -->
    <div id="rel-tooltip"></div>

    <div id="view-mermaid" class="mermaid-container">
      <div class="mermaid-header">
        <div>
          <strong>Mermaid.js Entity-Relationship Syntax</strong>
          <div style="font-size: 12px; color: var(--muted);">Embed this directly in Markdown files or render in GitHub issues &amp; PRs.</div>
        </div>
        <button id="btn-copy-mermaid" class="btn-ctrl">Copy Mermaid Code</button>
      </div>
      <div id="mermaid-code" class="mermaid-code-box">${esc(mermaidCode)}</div>
    </div>

    <div class="section-head" id="tables">
      <h2>Tables &amp; Schemas (${m.tables.length})</h2>
      <div class="search-box">
        <input id="filter" type="search" placeholder="Filter tables or columns..." autocomplete="off">
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
            <th>From Column</th>
            <th></th>
            <th>To Column</th>
            <th>Cardinality</th>
            <th>Enforcement Type</th>
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
</div>

<script>${FILTER_SCRIPT}</script>
</body>
</html>
`;
}
