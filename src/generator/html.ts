import type { DatabaseModel } from "../model/types.js";
import { erdSvg, ERD_CSS } from "./erd.js";
import { esc } from "./escape.js";
import { createHash } from "node:crypto";

/** Filter, interactive diagram, pan/zoom, detail modal, collapsible sidebar, and Archify-style relationship inspection tooltip. */
export const FILTER_SCRIPT = `(function(){
  // 1. Search & Filter across table cards, ERD entities, and Sidebar links
  var filterInput = document.getElementById("filter");
  var sidebarFilter = document.getElementById("sidebarSearch");

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
    document.querySelectorAll(".table-item").forEach(function(item) {
      var name = (item.getAttribute("data-table") || "").toLowerCase();
      item.style.display = (q === "" || name.indexOf(q) >= 0) ? "flex" : "none";
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

  // 2. Sidebar Toggle
  var sidebar = document.getElementById("sidebar");
  var menuToggle = document.getElementById("menuToggle");

  function toggleSidebar() {
    if(!sidebar) return;
    sidebar.classList.toggle("collapsed");
  }

  if(menuToggle) menuToggle.onclick = toggleSidebar;

  // 3. Pan and Zoom controls for ERD
  var currentScale = 1;
  var panX = 0, panY = 0;
  var isPanning = false;
  var startX = 0, startY = 0;
  var canvas = document.querySelector(".erd-canvas");
  var wrap = document.getElementById("visualCanvas");

  function applyTransform() {
    if(!canvas) return;
    canvas.style.transform = "translate(" + panX + "px, " + panY + "px) scale(" + currentScale + ")";
    canvas.style.transformOrigin = "top left";
    var scaleIndicator = document.getElementById("zoomLevel");
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

  var btnIn = document.getElementById("zoomIn");
  var btnOut = document.getElementById("zoomOut");
  var btnReset = document.getElementById("zoomReset");
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
    var badgeClass = enf === "db-enforced" ? "solid" : "dashed";
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
          '<div class="tt-meta-item"><strong>Enforcement:</strong> <span>' + enfText + '</span></div>' +
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
    var target = document.getElementById(tableName + "-card") || document.getElementById(tableName);
    if(target) {
      target.scrollIntoView({ behavior: "smooth", block: "center" });
      target.style.transition = "border-color 0.3s, box-shadow 0.3s";
      target.style.borderColor = "var(--accent-blue)";
      target.style.boxShadow = "0 0 0 4px var(--accent-blue-soft)";
      setTimeout(function(){
        target.style.borderColor = "";
        target.style.boxShadow = "";
      }, 1500);

      document.querySelectorAll(".table-item").forEach(function(it) {
        it.classList.toggle("active", (it.getAttribute("data-table") || "").toLowerCase() === tableName.toLowerCase());
      });
    }
  };

  document.querySelectorAll(".table-item").forEach(function(item) {
    item.addEventListener("click", function(e) {
      e.preventDefault();
      var tName = item.getAttribute("data-table");
      jumpToTable(tName);
    });
  });

  // 7. Diagram View Mode Switcher (Visual Canvas vs Mermaid Code)
  var tabVisual = document.getElementById("viewVisualBtn");
  var tabMermaid = document.getElementById("viewMermaidBtn");
  var viewVisual = document.getElementById("visualCanvas");
  var viewMermaid = document.getElementById("mermaidView");

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
  var copyBtn = document.getElementById("copyMermaid");
  if(copyBtn) {
    copyBtn.onclick = function() {
      var code = document.getElementById("mermaidCode");
      if(code) {
        navigator.clipboard.writeText(code.textContent).then(function() {
          copyBtn.textContent = "Copied!";
          setTimeout(function(){ copyBtn.textContent = "Copy"; }, 2000);
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
  <div class="section-header" id="usage">
    <h2>Application usage</h2>
  </div>
  <div class="table-card">
    <table class="mini-table"><thead><tr><th>Table</th><th>Reads</th><th>Writes</th><th>Deletes</th><th>Where</th></tr></thead><tbody>${rows || "<tr><td colspan=5>No calls found.</td></tr>"}</tbody></table>
  </div>
  <div class="section-header" id="flows">
    <h2>Flows</h2>
  </div>
  <div class="table-card">
    <table class="mini-table"><thead><tr><th>Endpoint</th><th>Handler</th><th>Call Chain</th><th>Database Operations</th></tr></thead><tbody>${flows || "<tr><td colspan=4>No flows mapped.</td></tr>"}</tbody></table>
  </div>
  `;
}

export function databaseHtml(m: DatabaseModel): string {
  const mermaidCode = generateMermaidEr(m);

  const tableCards = m.tables.map((t) => {
    return `
    <div class="table-card" id="${esc(t.name)}-card" data-table="${esc(t.name)}">
      <div class="table-card-header">
        <div class="table-card-title">
          <span class="icon-circle">☷</span>
          <h3>${esc(t.name)}</h3>
          ${t.dbName && t.dbName !== t.name ? `<span class="col-badge" style="background:var(--bg-code); margin-left:8px;">mapped: ${esc(t.dbName)}</span>` : ""}
        </div>
        <span class="col-badge">${t.columns.length} columns</span>
      </div>
      <table class="mini-table">
        <thead>
          <tr>
            <th>Column</th>
            <th>Type</th>
            <th>Constraints</th>
            <th>Source Evidence</th>
          </tr>
        </thead>
        <tbody>
        ${t.columns.map((c) => {
          const isPk = c.isPrimaryKey;
          const isUq = c.isUnique && !isPk;
          const isNull = c.nullable;
          return `
          <tr>
            <td style="font-weight:600;">
              ${esc(c.name)}
              ${isPk ? `<span class="tag tag-pk">PK</span>` : ""}
              ${isUq ? `<span class="tag tag-uq">UQ</span>` : ""}
            </td>
            <td><code>${esc(c.type)}</code></td>
            <td>
              <span class="tag" style="background:${isNull ? "var(--bg-code)" : "rgba(13,148,136,0.12)"}; color:${isNull ? "var(--text-muted)" : "var(--accent-teal)"}">${isNull ? "nullable" : "not null"}</span>
              ${c.default ? `<span style="font-size:11px; color:var(--text-muted); margin-left:6px;">default: <code>${esc(c.default)}</code></span>` : ""}
            </td>
            <td style="font-size:11px; color:var(--text-muted);">
              <code>${esc(c.evidence[0]?.file ?? "")}:${c.evidence[0]?.lines?.[0] ?? ""}</code>
            </td>
          </tr>`;
        }).join("")}
        </tbody>
      </table>
    </div>`;
  }).join("");

  const sidebarItems = m.tables.map((t, idx) => `
    <a href="#${esc(t.name)}" class="table-item ${idx === 0 ? "active" : ""}" data-table="${esc(t.name)}">
      <span>☷ ${esc(t.name)}</span>
      <span class="count">${t.columns.length}</span>
    </a>
  `).join("");

  const relRows = m.relationships.map((r, idx) => `
    <tr id="rel-${idx}">
      <td><code style="font-weight:600;">${esc(r.from)}</code></td>
      <td style="text-align:center; color:var(--text-muted);">→</td>
      <td><code style="font-weight:600;">${esc(r.to)}</code></td>
      <td><span class="tag tag-uq">${esc(r.cardinality)}</span></td>
      <td><span class="tag ${r.enforcement === "db-enforced" ? "tag-fk" : "tag-uq"}" style="${r.enforcement === "db-enforced" ? "background:rgba(13,148,136,0.14); color:var(--accent-teal);" : "background:rgba(217,119,6,0.14); color:var(--accent-amber);"}">${esc(r.enforcement)}</span></td>
    </tr>
  `).join("");

  const findings = m.findings.length
    ? m.findings.map((f) => `
      <div class="stat-card" style="margin-bottom:12px; border-left:4px solid var(--accent-blue);">
        <div style="font-weight:700; font-size:14px; margin-bottom:4px;">${esc(f.category)}</div>
        <p style="font-size:13px; color:var(--text-secondary); margin:0 0 6px;">${esc(f.explanation)}</p>
        <div style="font-size:12px; font-weight:500;">💡 ${esc(f.recommendation)}</div>
      </div>`).join("")
    : `<div class="empty-findings">
        <span style="color:var(--accent-teal); font-size:24px; margin-bottom:8px; display:block;">✔</span>
        No issues detected — all schemas, relations, and primary keys are fully consistent.
      </div>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src '${FILTER_HASH}'; img-src 'self' data:">
  <title>SchemaSage · Architecture &amp; ER Explorer</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    :root {
      --font-sans: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      --font-mono: 'SF Mono', 'Fira Code', 'Cascadia Code', 'Consolas', monospace;

      --bg-body: #f7f9fc;
      --bg-surface: #ffffff;
      --bg-sidebar: #ffffff;
      --bg-canvas: #f0f4fa;
      --bg-hover: #eef2f6;
      --bg-code: #f1f5f9;

      --text-primary: #0b1b33;
      --text-secondary: #4b5e77;
      --text-muted: #7a8ba0;

      --border-light: #e2e9f2;
      --border-focus: #3b82f6;

      --accent-blue: #2563eb;
      --accent-blue-soft: #dbeafe;
      --accent-teal: #0d9488;
      --accent-amber: #d97706;
      --accent-rose: #e11d48;

      --shadow-sm: 0 2px 6px rgba(0, 0, 0, 0.02), 0 1px 2px rgba(0, 0, 0, 0.03);
      --shadow-md: 0 8px 20px -6px rgba(0, 20, 40, 0.08);
      --radius-lg: 18px;
      --radius-md: 12px;
      --radius-sm: 8px;

      --sidebar-width: 270px;
    }

    @media (prefers-color-scheme: dark) {
      :root {
        --bg-body: #0b1018;
        --bg-surface: #121a26;
        --bg-sidebar: #0f1621;
        --bg-canvas: #0a111c;
        --bg-hover: #1a2535;
        --bg-code: #1a2332;

        --text-primary: #edf2f9;
        --text-secondary: #a7bbd4;
        --text-muted: #6a7f9b;

        --border-light: #1f2c3d;
        --border-focus: #60a5fa;

        --accent-blue: #60a5fa;
        --accent-blue-soft: #1e3a5f;
        --accent-teal: #2dd4bf;
        --accent-amber: #fbbf24;
        --accent-rose: #fb7185;

        --shadow-sm: 0 2px 8px rgba(0, 0, 0, 0.4);
        --shadow-md: 0 12px 24px -8px rgba(0, 0, 0, 0.6);
      }
    }

    body {
      font-family: var(--font-sans);
      background: var(--bg-body);
      color: var(--text-primary);
      line-height: 1.5;
      display: flex;
      min-height: 100vh;
    }

    /* Sidebar */
    .sidebar {
      width: var(--sidebar-width);
      background: var(--bg-sidebar);
      border-right: 1px solid var(--border-light);
      display: flex;
      flex-direction: column;
      height: 100vh;
      position: sticky;
      top: 0;
      transition: transform 0.2s ease, margin-right 0.2s ease;
      z-index: 20;
      flex-shrink: 0;
    }

    .sidebar.collapsed {
      transform: translateX(calc(-1 * var(--sidebar-width)));
      margin-right: calc(-1 * var(--sidebar-width));
    }

    .sidebar-header {
      padding: 20px 16px 12px;
      border-bottom: 1px solid var(--border-light);
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    .logo-badge {
      font-weight: 800;
      font-size: 13px;
      background: linear-gradient(135deg, var(--accent-blue), #06b6d4);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      letter-spacing: -0.3px;
    }

    .sidebar-search {
      padding: 14px 12px 10px;
    }

    .sidebar-search input {
      width: 100%;
      padding: 8px 12px;
      border: 1px solid var(--border-light);
      border-radius: 40px;
      background: var(--bg-code);
      font-size: 13px;
      color: var(--text-primary);
      outline: none;
      transition: border 0.15s, box-shadow 0.15s;
    }

    .sidebar-search input:focus {
      border-color: var(--border-focus);
      box-shadow: 0 0 0 3px var(--accent-blue-soft);
    }

    .sidebar-list {
      flex: 1;
      overflow-y: auto;
      padding: 8px 8px 20px;
      display: flex;
      flex-direction: column;
      gap: 2px;
    }

    .table-item {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 8px 12px;
      border-radius: var(--radius-sm);
      color: var(--text-secondary);
      font-size: 13px;
      font-weight: 500;
      text-decoration: none;
      transition: all 0.1s;
      white-space: nowrap;
    }

    .table-item:hover {
      background: var(--bg-hover);
      color: var(--text-primary);
    }

    .table-item.active {
      background: var(--accent-blue-soft);
      color: var(--accent-blue);
      font-weight: 600;
    }

    .table-item .count {
      font-size: 11px;
      background: var(--border-light);
      padding: 1px 7px;
      border-radius: 20px;
      color: var(--text-muted);
      font-weight: 500;
      margin-left: 8px;
    }

    /* Main Area */
    .main-wrapper {
      flex: 1;
      display: flex;
      flex-direction: column;
      min-width: 0;
    }

    .top-bar {
      background: var(--bg-surface);
      border-bottom: 1px solid var(--border-light);
      padding: 12px 24px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 12px;
      position: sticky;
      top: 0;
      z-index: 15;
      backdrop-filter: blur(8px);
    }

    .brand-area {
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .menu-toggle {
      background: transparent;
      border: 1px solid var(--border-light);
      border-radius: var(--radius-sm);
      padding: 6px 10px;
      font-size: 16px;
      cursor: pointer;
      color: var(--text-primary);
      transition: background 0.1s;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .menu-toggle:hover {
      background: var(--bg-hover);
    }

    .title-block h1 {
      font-size: 18px;
      font-weight: 700;
      letter-spacing: -0.3px;
      line-height: 1.3;
    }

    .subtitle {
      font-size: 12px;
      color: var(--text-muted);
      display: flex;
      align-items: center;
      gap: 6px;
      margin-top: 2px;
    }

    .subtitle span {
      background: var(--bg-code);
      padding: 1px 6px;
      border-radius: 6px;
      font-family: var(--font-mono);
      font-size: 11px;
    }

    .nav-links {
      display: flex;
      gap: 4px;
      flex-wrap: wrap;
    }

    .nav-links a {
      color: var(--text-secondary);
      text-decoration: none;
      font-size: 13px;
      font-weight: 500;
      padding: 6px 12px;
      border-radius: 40px;
      transition: background 0.1s, color 0.1s;
    }

    .nav-links a:hover {
      background: var(--bg-hover);
      color: var(--text-primary);
    }

    main {
      flex: 1;
      padding: 24px 28px 48px;
      max-width: 1440px;
      margin: 0 auto;
      width: 100%;
    }

    /* Guide banner */
    .guide-banner {
      background: linear-gradient(105deg, var(--accent-blue-soft) 0%, transparent 90%);
      border: 1px solid var(--border-light);
      border-radius: var(--radius-lg);
      padding: 18px 24px;
      margin-bottom: 28px;
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 24px;
    }

    .guide-banner .guide-icon {
      font-size: 26px;
      color: var(--accent-blue);
    }

    .guide-text {
      flex: 1;
      font-size: 13.5px;
      color: var(--text-secondary);
    }

    .guide-text strong {
      color: var(--text-primary);
      font-weight: 600;
    }

    .guide-badge {
      background: var(--bg-surface);
      border: 1px solid var(--border-light);
      border-radius: 40px;
      padding: 6px 14px;
      font-size: 12px;
      font-weight: 500;
      display: flex;
      align-items: center;
      gap: 8px;
      white-space: nowrap;
    }

    .dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      display: inline-block;
    }
    .dot.green { background: var(--accent-teal); }
    .dot.amber { background: var(--accent-amber); }

    /* Stats row */
    .stats-row {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
      gap: 16px;
      margin-bottom: 32px;
    }

    .stat-card {
      background: var(--bg-surface);
      border: 1px solid var(--border-light);
      border-radius: var(--radius-md);
      padding: 16px 18px;
      box-shadow: var(--shadow-sm);
    }

    .stat-label {
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.6px;
      color: var(--text-muted);
      font-weight: 600;
      margin-bottom: 6px;
    }

    .stat-value {
      font-size: 26px;
      font-weight: 800;
      letter-spacing: -0.5px;
      line-height: 1.1;
    }

    .stat-value small {
      font-size: 13px;
      font-weight: 500;
      color: var(--text-muted);
      margin-left: 6px;
    }

    /* Diagram Section */
    .section-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 12px;
      margin: 32px 0 16px;
    }

    .section-header h2 {
      font-size: 17px;
      font-weight: 700;
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .diagram-controls {
      display: flex;
      align-items: center;
      gap: 12px;
      flex-wrap: wrap;
    }

    .view-tabs {
      display: flex;
      background: var(--bg-code);
      border-radius: 40px;
      padding: 3px;
      border: 1px solid var(--border-light);
    }

    .view-tabs button {
      background: transparent;
      border: none;
      font-size: 12px;
      font-weight: 600;
      padding: 5px 14px;
      border-radius: 30px;
      cursor: pointer;
      color: var(--text-secondary);
      transition: all 0.1s;
    }

    .view-tabs button.active {
      background: var(--bg-surface);
      color: var(--text-primary);
      box-shadow: 0 1px 4px rgba(0, 0, 0, 0.04);
    }

    .zoom-controls {
      display: flex;
      align-items: center;
      gap: 4px;
      background: var(--bg-surface);
      border: 1px solid var(--border-light);
      border-radius: 40px;
      padding: 2px;
    }

    .zoom-controls button {
      background: transparent;
      border: none;
      width: 28px;
      height: 28px;
      border-radius: 50%;
      font-size: 14px;
      font-weight: 600;
      color: var(--text-secondary);
      cursor: pointer;
      transition: background 0.1s;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .zoom-controls button:hover {
      background: var(--bg-hover);
    }

    .zoom-level {
      font-size: 11px;
      font-weight: 600;
      color: var(--text-muted);
      min-width: 40px;
      text-align: center;
    }

    .canvas-wrapper {
      background: var(--bg-canvas);
      border: 1px solid var(--border-light);
      border-radius: var(--radius-lg);
      padding: 20px;
      overflow: hidden;
      max-height: 580px;
      min-height: 520px;
      box-shadow: inset 0 1px 4px rgba(0, 0, 0, 0.02);
      cursor: grab;
      position: relative;
    }

    .erd-canvas {
      display: block;
      transition: transform 0.15s ease;
      transform-origin: top left;
    }

    /* Archify-Style Floating Tooltip */
    #rel-tooltip {
      display: none;
      position: fixed;
      z-index: 2000;
      pointer-events: none;
      background: var(--bg-surface);
      border: 1px solid var(--border-light);
      box-shadow: var(--shadow-md);
      border-radius: var(--radius-md);
      padding: 14px 18px;
      width: 320px;
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
      border-bottom: 1px solid var(--border-light);
      padding-bottom: 8px;
      margin-bottom: 10px;
    }

    .tt-title {
      font-size: 11px;
      font-weight: 700;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .tt-badge {
      font-size: 10px;
      font-weight: 700;
      padding: 2px 7px;
      border-radius: 6px;
    }

    .tt-badge.solid {
      background: rgba(13, 148, 136, 0.14);
      color: var(--accent-teal);
    }

    .tt-badge.dashed {
      background: rgba(217, 119, 6, 0.14);
      color: var(--accent-amber);
    }

    .tt-flow {
      display: flex;
      align-items: center;
      justify-content: space-between;
      background: var(--bg-code);
      border: 1px solid var(--border-light);
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
      font-family: var(--font-mono);
      font-size: 11px;
      color: var(--accent-blue);
    }

    .tt-arrow {
      color: var(--text-muted);
      font-size: 15px;
    }

    .tt-meta {
      font-size: 12px;
      color: var(--text-muted);
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .tt-meta-item strong {
      color: var(--text-primary);
    }

    /* Mermaid View */
    .mermaid-view {
      background: var(--bg-surface);
      border: 1px solid var(--border-light);
      border-radius: var(--radius-lg);
      padding: 24px;
      display: none;
      margin-top: 12px;
    }

    .mermaid-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 16px;
    }

    .mermaid-code {
      background: var(--bg-code);
      border: 1px solid var(--border-light);
      border-radius: var(--radius-md);
      padding: 18px;
      font-family: var(--font-mono);
      font-size: 12.5px;
      line-height: 1.6;
      white-space: pre;
      overflow-x: auto;
      color: var(--text-primary);
    }

    /* Table Cards */
    .table-section-title {
      font-size: 17px;
      font-weight: 700;
      margin: 40px 0 16px;
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .table-grid {
      display: flex;
      flex-direction: column;
      gap: 20px;
    }

    .table-card {
      background: var(--bg-surface);
      border: 1px solid var(--border-light);
      border-radius: var(--radius-lg);
      overflow: hidden;
      box-shadow: var(--shadow-sm);
      transition: border 0.15s, box-shadow 0.15s;
    }

    .table-card:hover {
      border-color: var(--accent-blue);
      box-shadow: var(--shadow-md);
    }

    .table-card-header {
      padding: 14px 20px;
      background: var(--bg-hover);
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 1px solid var(--border-light);
    }

    .table-card-title {
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .icon-circle {
      color: var(--accent-blue);
      font-size: 14px;
    }

    .table-card-title h3 {
      font-size: 15px;
      font-weight: 700;
    }

    .col-badge {
      font-size: 10px;
      font-weight: 600;
      background: var(--border-light);
      padding: 2px 8px;
      border-radius: 20px;
      color: var(--text-muted);
    }

    .mini-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 13px;
    }

    .mini-table th {
      text-align: left;
      padding: 9px 20px;
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: var(--text-muted);
      background: var(--bg-surface);
      border-bottom: 1px solid var(--border-light);
      font-weight: 600;
    }

    .mini-table td {
      padding: 9px 20px;
      border-bottom: 1px solid var(--border-light);
      color: var(--text-primary);
      font-family: var(--font-mono);
      font-size: 12.5px;
    }

    .mini-table tr:last-child td {
      border-bottom: none;
    }

    .mini-table tr:hover td {
      background: var(--bg-hover);
    }

    .tag {
      font-size: 9px;
      font-weight: 700;
      padding: 2px 6px;
      border-radius: 4px;
      margin-left: 8px;
      font-family: var(--font-sans);
      text-transform: uppercase;
      letter-spacing: 0.3px;
    }

    .tag-pk {
      background: var(--accent-blue-soft);
      color: var(--accent-blue);
    }

    .tag-fk {
      background: #fef3c7;
      color: #b45309;
    }

    @media (prefers-color-scheme: dark) {
      .tag-fk {
        background: #4a3410;
        color: #fbbf24;
      }
    }

    .tag-uq {
      background: var(--bg-code);
      color: var(--text-secondary);
    }

    code {
      font-family: var(--font-mono);
      font-size: 12px;
      background: var(--bg-code);
      padding: 2px 6px;
      border-radius: 5px;
    }

    .empty-findings {
      background: var(--bg-surface);
      border: 1px dashed var(--border-light);
      border-radius: var(--radius-lg);
      padding: 28px;
      text-align: center;
      color: var(--text-muted);
      font-size: 13px;
    }

    .sidebar-footer {
      padding: 12px 16px;
      border-top: 1px solid var(--border-light);
      font-size: 11px;
      color: var(--text-muted);
      display: flex;
      justify-content: space-between;
    }

    ${ERD_CSS}
  </style>
</head>
<body>
  <!-- Sidebar -->
  <aside class="sidebar" id="sidebar">
    <div class="sidebar-header">
      <span class="logo-badge">SCHEMASAGE</span>
    </div>
    <div class="sidebar-search">
      <input type="search" id="sidebarSearch" placeholder="Filter tables…" autocomplete="off">
    </div>
    <div class="sidebar-list" id="sidebarList">
      ${sidebarItems}
    </div>
    <div class="sidebar-footer">
      <span>${m.tables.length} tables</span>
      <span>${esc(m.source.adapter)}</span>
    </div>
  </aside>

  <!-- Main Area -->
  <div class="main-wrapper">
    <div class="top-bar">
      <div class="brand-area">
        <button class="menu-toggle" id="menuToggle" title="Toggle Sidebar">☰</button>
        <div class="title-block">
          <h1>Architecture &amp; ER Explorer</h1>
          <div class="subtitle">
            <span>${esc(m.source.adapter)}</span> · ${m.tables.length} tables · ${m.relationships.length} relations
          </div>
        </div>
      </div>
      <div class="nav-links">
        <a href="#diagram">Diagram</a>
        <a href="#tables">Tables</a>
        <a href="#relationships">Relationships</a>
        <a href="#findings">Findings</a>
      </div>
    </div>

    <main>
      <!-- Guide Banner -->
      <div class="guide-banner">
        <div class="guide-icon">💡</div>
        <div class="guide-text">
          <strong>Solid lines</strong> = DB-enforced foreign key. <strong>Dashed</strong> = ORM-declared only.
          <span style="margin-left: 12px;">Hover any line for Archify-style linkage details, or click a sidebar item to jump.</span>
        </div>
        <div class="guide-badge">
          <span class="dot green"></span> DB FK
          <span class="dot amber"></span> ORM FK
        </div>
      </div>

      <!-- Stats Row -->
      <div class="stats-row">
        <div class="stat-card">
          <div class="stat-label">Tables</div>
          <div class="stat-value">${m.tables.length}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Columns</div>
          <div class="stat-value">${m.tables.reduce((sum, t) => sum + t.columns.length, 0)}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Relationships</div>
          <div class="stat-value">${m.relationships.length}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Adapter</div>
          <div class="stat-value" style="font-size:18px;">${esc(m.source.adapter)}</div>
        </div>
      </div>

      <!-- Diagram Section -->
      <div class="section-header" id="diagram">
        <h2>Entity-Relationship</h2>
        <div class="diagram-controls">
          <div class="view-tabs">
            <button id="viewVisualBtn" class="active">Visual</button>
            <button id="viewMermaidBtn">Mermaid</button>
          </div>
          <div class="zoom-controls">
            <button id="zoomOut">-</button>
            <span class="zoom-level" id="zoomLevel">100%</span>
            <button id="zoomIn">+</button>
            <button id="zoomReset" style="font-size:11px; width:auto; padding:0 10px;">Reset</button>
          </div>
        </div>
      </div>

      <!-- Visual Canvas -->
      <div class="canvas-wrapper" id="visualCanvas">
        ${erdSvg(m)}
      </div>

      <!-- Archify-style Floating Relationship Inspector Tooltip -->
      <div id="rel-tooltip"></div>

      <!-- Mermaid View -->
      <div class="mermaid-view" id="mermaidView">
        <div class="mermaid-header">
          <h3 style="font-size: 14px;">Mermaid ERD Code</h3>
          <button id="copyMermaid" style="background:var(--bg-code); border:1px solid var(--border-light); padding:6px 12px; border-radius:20px; font-size:12px; font-weight:500; cursor:pointer;">Copy</button>
        </div>
        <pre class="mermaid-code" id="mermaidCode">${esc(mermaidCode)}</pre>
      </div>

      <!-- Tables Section -->
      <div class="section-header" id="tables">
        <h2>Table details (${m.tables.length})</h2>
        <div style="max-width: 280px; width:100%;">
          <input type="search" id="filter" placeholder="Quick filter table cards..." style="width:100%; padding:6px 14px; border:1px solid var(--border-light); border-radius:30px; background:var(--bg-surface); font-size:13px; color:var(--text-primary); outline:none;">
        </div>
      </div>

      <div class="table-grid" id="tableCards">
        ${tableCards}
      </div>

      ${appSection(m)}

      <!-- Relationships Section -->
      <div class="section-header" id="relationships">
        <h2>Relationships (${m.relationships.length})</h2>
      </div>

      <div class="table-card">
        <table class="mini-table">
          <thead>
            <tr>
              <th>From Column</th>
              <th></th>
              <th>To Column</th>
              <th>Cardinality</th>
              <th>Enforcement</th>
            </tr>
          </thead>
          <tbody>
            ${relRows}
          </tbody>
        </table>
      </div>

      <!-- Findings Section -->
      <div class="section-header" id="findings">
        <h2>Findings (${m.findings.length})</h2>
      </div>
      ${findings}
    </main>
  </div>

  <script>${FILTER_SCRIPT}</script>
</body>
</html>
`;
}
