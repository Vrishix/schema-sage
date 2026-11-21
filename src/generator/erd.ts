import type { DatabaseModel, Table } from "../model/types.js";
import { esc } from "./escape.js";

const BOX_W = 250;
const HEAD = 38;
const ROW = 22;
const PAD = 10;
const GAP_X = 110;
const GAP_Y = 40;
const MARGIN = 30;
const COLS = 6;
const MAX_PER_COL = 8;
const BAND_GAP = 60;

interface Node { table: Table; h: number; layer: number; order: number; x: number; y: number }

function assignLayers(model: DatabaseModel): Map<string, number> {
  const layer = new Map<string, number>(model.tables.map((t) => [t.name, 0]));
  const refs = new Map<string, string[]>();
  for (const r of model.relationships) {
    const a = r.from.replace(/^column:/, "").split(".")[0];
    const b = r.to.replace(/^column:/, "").split(".")[0];
    if (a === b) continue;
    refs.set(a, [...(refs.get(a) ?? []), b]);
  }
  for (let pass = 0; pass < model.tables.length; pass++) {
    let changed = false;
    for (const [a, targets] of refs) {
      for (const b of targets) {
        const want = (layer.get(b) ?? 0) + 1;
        if (want > (layer.get(a) ?? 0)) {
          layer.set(a, want);
          changed = true;
        }
      }
    }
    if (!changed) break;
  }
  return layer;
}

export function erdSvg(model: DatabaseModel): string {
  const n = model.tables.length;
  if (n === 0) return "";

  const layerOf = assignLayers(model);
  const nodes = new Map<string, Node>();
  for (const t of model.tables) {
    nodes.set(t.name, {
      table: t,
      h: HEAD + t.columns.length * ROW + PAD * 2,
      layer: layerOf.get(t.name) ?? 0,
      order: 0,
      x: 0,
      y: 0,
    });
  }

  const neighbours = new Map<string, string[]>();
  for (const r of model.relationships) {
    const a = r.from.replace(/^column:/, "").split(".")[0];
    const b = r.to.replace(/^column:/, "").split(".")[0];
    if (a === b) continue;
    neighbours.set(a, [...(neighbours.get(a) ?? []), b]);
    neighbours.set(b, [...(neighbours.get(b) ?? []), a]);
  }

  const maxLayer = Math.max(...[...nodes.values()].map((x) => x.layer));
  const columns: Node[][] = Array.from({ length: maxLayer + 1 }, () => []);
  for (const t of model.tables) columns[nodes.get(t.name)!.layer].push(nodes.get(t.name)!);
  for (const col of columns) col.sort((p, q) => p.table.name.localeCompare(q.table.name));

  const indexIn = () => {
    for (const col of columns) col.forEach((node, i) => (node.order = i));
  };
  indexIn();
  for (let sweep = 0; sweep < 4; sweep++) {
    for (let L = 0; L <= maxLayer; L++) {
      const col = columns[L];
      const bary = (node: Node) => {
        const ns = (neighbours.get(node.table.name) ?? []).map((nm) => nodes.get(nm)!).filter((x) => x.layer !== L);
        return ns.length ? ns.reduce((s, x) => s + x.order, 0) / ns.length : node.order;
      };
      col.sort((p, q) => bary(p) - bary(q) || p.table.name.localeCompare(q.table.name));
      col.forEach((node, i) => (node.order = i));
    }
  }

  interface VisualCol { band: number; colInBand: number; nodes: Node[] }
  const vCols: VisualCol[] = [];
  for (let L = 0; L <= maxLayer; L++) {
    const list = columns[L];
    for (let i = 0; i < list.length; i += MAX_PER_COL) {
      const chunk = list.slice(i, i + MAX_PER_COL);
      const vColIdx = vCols.length;
      vCols.push({ band: Math.floor(vColIdx / COLS), colInBand: vColIdx % COLS, nodes: chunk });
    }
  }

  const bandCount = Math.max(1, ...vCols.map((c) => c.band + 1));
  const bandHeights = new Array(bandCount).fill(0);
  for (const c of vCols) {
    const colH = c.nodes.reduce((sum, node) => sum + node.h, 0) + Math.max(0, c.nodes.length - 1) * GAP_Y;
    bandHeights[c.band] = Math.max(bandHeights[c.band], colH);
  }
  const bandTop = new Array(bandCount).fill(MARGIN);
  for (let b = 1; b < bandCount; b++) {
    bandTop[b] = bandTop[b - 1] + bandHeights[b - 1] + BAND_GAP;
  }

  for (const c of vCols) {
    const x = MARGIN + c.colInBand * (BOX_W + GAP_X);
    let y = bandTop[c.band];
    for (const node of c.nodes) {
      node.x = x;
      node.y = y;
      y += node.h + GAP_Y;
    }
  }

  const colY = (node: Node, colName: string): number => {
    const idx = node.table.columns.findIndex((c) => c.name === colName);
    if (idx < 0) return node.y + HEAD / 2;
    return node.y + HEAD + PAD + idx * ROW + ROW / 2;
  };

  const maxX = Math.max(...[...nodes.values()].map((n) => n.x + BOX_W)) + MARGIN;
  const maxY = Math.max(...[...nodes.values()].map((n) => n.y + n.h)) + MARGIN;

  const parts: string[] = [
    `<svg class="erd-canvas" viewBox="0 0 ${maxX} ${maxY}" width="${maxX}" height="${maxY}" xmlns="http://www.w3.org/2000/svg">`,
    `<defs>
      <filter id="shadow" x="-5%" y="-5%" width="110%" height="115%">
        <feDropShadow dx="0" dy="4" stdDeviation="6" flood-opacity="0.08"/>
      </filter>
    </defs>`,
  ];

  model.relationships.forEach((rel, idx) => {
    const [fromT, fromC] = rel.from.replace(/^column:/, "").split(".");
    const [toT, toC] = rel.to.replace(/^column:/, "").split(".");
    const a = nodes.get(fromT);
    const b = nodes.get(toT);
    if (!a || !b) return;

    const ay = colY(a, fromC);
    const by = colY(b, toC);
    const label = rel.cardinality === "one-to-one" ? "1:1" : rel.cardinality === "many-to-many" ? "N:N" : "1:N";
    const dash = rel.enforcement === "orm-declared" ? 'stroke-dasharray="5 4"' : "";
    const evidenceFile = rel.evidence[0]?.file ?? "";
    const evidenceLine = rel.evidence[0]?.lines?.[0] ?? "";
    const evidenceStr = evidenceFile ? `${evidenceFile}:${evidenceLine}` : "";

    const common = `class="edge ${rel.enforcement}" ${dash} data-from="${esc(fromT)}" data-to="${esc(toT)}" data-rel-id="${idx}" data-from-col="${esc(fromC)}" data-to-col="${esc(toC)}" data-card="${esc(rel.cardinality)}" data-enf="${esc(rel.enforcement)}" data-src="${esc(evidenceStr)}"`;

    let d: string;
    let mx: number;
    let my: number;
    if (a === b) {
      const x = a.x + BOX_W;
      d = `M${x},${ay} C${x + 65},${ay - 30} ${x + 65},${by + 30} ${x},${by}`;
      mx = x + 45;
      my = (ay + by) / 2;
    } else if (a.x > b.x) {
      const ax = a.x;
      const bx = b.x + BOX_W;
      const dx = Math.max(35, (ax - bx) / 2);
      d = `M${ax},${ay} C${ax - dx},${ay} ${bx + dx},${by} ${bx},${by}`;
      mx = (ax + bx) / 2;
      my = (ay + by) / 2;
    } else if (a.x < b.x) {
      const ax = a.x + BOX_W;
      const bx = b.x;
      const dx = Math.max(35, (bx - ax) / 2);
      d = `M${ax},${ay} C${ax + dx},${ay} ${bx - dx},${by} ${bx},${by}`;
      mx = (ax + bx) / 2;
      my = (ay + by) / 2;
    } else {
      const ax = a.x + BOX_W;
      d = `M${ax},${ay} C${ax + 55},${ay} ${ax + 55},${by} ${ax},${by}`;
      mx = ax + 28;
      my = (ay + by) / 2;
    }
    parts.push(
      `<g class="edge-group" data-rel="${idx}" data-from="${esc(fromT)}" data-to="${esc(toT)}" data-from-col="${esc(fromC)}" data-to-col="${esc(toC)}" data-card="${esc(rel.cardinality)}" data-enf="${esc(rel.enforcement)}" data-src="${esc(evidenceStr)}">` +
        `<a href="#rel-${idx}" aria-label="${esc(rel.from)} to ${esc(rel.to)}, ${esc(rel.enforcement)}">` +
        `<path d="${d}" ${common} fill="none"/>` +
        `<circle cx="${mx}" cy="${my}" r="11" class="edge-bubble"/>` +
        `<text x="${mx}" y="${my + 4}" text-anchor="middle" class="edge-label">${label}</text>` +
        `</a>` +
      `</g>`
    );
  });

  for (const node of nodes.values()) {
    const t = node.table;
    parts.push(`<g id="erd-${esc(t.name)}" class="entity" data-name="${esc(t.name.toLowerCase())}" filter="url(#shadow)">`);
    parts.push(`<rect x="${node.x}" y="${node.y}" width="${BOX_W}" height="${node.h}" rx="10" class="box"/>`);
    parts.push(`<rect x="${node.x}" y="${node.y}" width="${BOX_W}" height="${HEAD}" rx="10" class="box-head"/>`);
    parts.push(`<text x="${node.x + 14}" y="${node.y + 24}" class="table-name">${esc(t.name)}</text>`);
    parts.push(`<text x="${node.x + BOX_W - 14}" y="${node.y + 24}" text-anchor="end" class="table-count">${t.columns.length} cols</text>`);

    t.columns.forEach((c, i) => {
      const yy = node.y + HEAD + PAD + i * ROW + 15;
      const isPk = c.isPrimaryKey;
      const isUq = c.isUnique && !isPk;
      const badge = isPk ? "PK" : isUq ? "UQ" : "";
      const colClass = isPk ? "col pk" : isUq ? "col uq" : "col";

      if (badge) {
        parts.push(`<rect x="${node.x + 10}" y="${yy - 11}" width="${badge === "PK" ? 22 : 24}" height="14" rx="3" class="badge-bg ${isPk ? "badge-pk" : "badge-uq"}"/>`);
        parts.push(`<text x="${node.x + (badge === "PK" ? 21 : 22)}" y="${yy}" text-anchor="middle" class="badge-text">${badge}</text>`);
        parts.push(`<text x="${node.x + 38}" y="${yy}" class="${colClass}">${esc(c.name)}</text>`);
      } else {
        parts.push(`<text x="${node.x + 14}" y="${yy}" class="${colClass}">${esc(c.name)}</text>`);
      }

      parts.push(`<text x="${node.x + BOX_W - 14}" y="${yy}" text-anchor="end" class="col-type">${esc(c.type + (c.nullable ? "?" : ""))}</text>`);
    });
    parts.push(`</g>`);
  }

  parts.push(`</svg>`);
  return parts.join("\n");
}

export const ERD_CSS = `
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
.erd-canvas {
  display: block;
  font-family: inherit;
  transition: transform 0.15s ease-out;
}
.erd-wrap .box {
  fill: var(--card-bg);
  stroke: var(--card-border);
  stroke-width: 1.5;
  transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
}
.erd-wrap .box-head {
  fill: var(--card-head);
  stroke: var(--card-border);
  stroke-width: 1.5;
}
.erd-wrap .table-name {
  font-weight: 700;
  font-size: 13px;
  fill: var(--fg);
}
.erd-wrap .table-count {
  font-size: 11px;
  font-weight: 500;
  fill: var(--muted);
}
.erd-wrap .col {
  font-size: 12px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  fill: var(--fg);
}
.erd-wrap .col.pk {
  font-weight: 600;
  fill: var(--accent);
}
.erd-wrap .col.uq {
  font-weight: 600;
}
.erd-wrap .col-type {
  font-size: 11px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  fill: var(--muted);
}
.erd-wrap .badge-bg {
  opacity: 0.9;
}
.erd-wrap .badge-pk {
  fill: var(--accent-light);
}
.erd-wrap .badge-uq {
  fill: var(--amber-light);
}
.erd-wrap .badge-text {
  font-size: 9px;
  font-weight: 700;
  font-family: system-ui, sans-serif;
  fill: var(--accent-dark);
}
.erd-wrap .edge-bubble {
  fill: var(--card-bg);
  stroke: var(--line);
  stroke-width: 1.2;
}
.erd-wrap .edge-label {
  font-size: 9.5px;
  font-weight: 600;
  font-family: system-ui, sans-serif;
  fill: var(--muted);
}
.erd-wrap .edge {
  stroke-width: 1.8;
  cursor: pointer;
  transition: stroke 0.2s, stroke-width 0.2s, opacity 0.2s;
}
.erd-wrap .edge.db-enforced {
  stroke: var(--solid);
}
.erd-wrap .edge.orm-declared {
  stroke: var(--dash);
}
.erd-wrap .entity {
  cursor: pointer;
  transition: transform 0.2s, opacity 0.2s;
}
.erd-wrap .entity:hover {
  transform: translateY(-2px);
}
.erd-wrap .entity:hover .box {
  stroke: var(--accent);
  stroke-width: 2.2;
  box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.1);
}
.erd-wrap .edge-group {
  cursor: pointer;
}
.erd-wrap .edge-group:hover .edge {
  stroke: var(--accent-hover);
  stroke-width: 4;
}
`;
