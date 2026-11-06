import type { DatabaseModel, Table } from "../model/types.js";
import { esc } from "./escape.js";

/**
 * Static SVG entity-relationship diagram. No scripts, no external libraries, works offline.
 *
 * Layout (deterministic, same model -> same picture):
 *  - Layers: a table sits one column to the right of every table it references.
 *    Tables that reference nothing are in the left-most column.
 *  - Order inside a column: barycentre sweeps against the neighbouring column, to reduce crossings.
 *  - Edges run from the foreign-key column (right) to the referenced table (left).
 *
 * Solid edges = db-enforced (a migration creates the foreign key).
 * Dashed edges = orm-declared (only the ORM declares it).
 */
const BOX_W = 232;
const HEAD = 30;
const ROW = 18;
const PAD = 10;
const GAP_X = 96;
const GAP_Y = 36;
const MARGIN = 24;
/** Layers per band. Longer chains wrap into a new band below, so the diagram stays readable at natural size. */
const COLS = 6;
/** Tables per visual column. Keeps every column short enough to read. */
const MAX_PER_COL = 8;
const BAND_GAP = 56;

interface Node { table: Table; h: number; layer: number; order: number; x: number; y: number }

function assignLayers(model: DatabaseModel): Map<string, number> {
  const layer = new Map<string, number>(model.tables.map((t) => [t.name, 0]));
  // refs[a] = tables that a references (a is the foreign-key side).
  const refs = new Map<string, string[]>();
  for (const r of model.relationships) {
    const a = r.from.replace(/^column:/, "").split(".")[0];
    const b = r.to.replace(/^column:/, "").split(".")[0];
    if (a === b) continue; // self-reference does not move the table
    refs.set(a, [...(refs.get(a) ?? []), b]);
  }
  // Longest path to a table with no references. Bounded, so cycles cannot loop forever.
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
    nodes.set(t.name, { table: t, h: HEAD + t.columns.length * ROW + PAD * 2, layer: layerOf.get(t.name) ?? 0, order: 0, x: 0, y: 0 });
  }

  // Neighbours in the adjacent column, used for barycentre ordering.
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

  // Barycentre sweeps: place each table near the average position of its neighbours.
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

  // Coordinates. Each layer is split into chunks of at most MAX_PER_COL tables (a visual column).
  // Visual columns are numbered in order; column k goes in band floor(k / COLS), position k % COLS.
  const chunks: Node[][] = [];
  columns.forEach((col) => {
    for (let i = 0; i < col.length; i += MAX_PER_COL) chunks.push(col.slice(i, i + MAX_PER_COL));
  });
  const colH = (col: Node[]) => col.reduce((sum, x) => sum + x.h, 0) + Math.max(0, col.length - 1) * GAP_Y;
  const bands = Math.ceil(chunks.length / COLS) || 1;
  const bandHeight: number[] = Array(bands).fill(0);
  chunks.forEach((col, k) => {
    bandHeight[Math.floor(k / COLS)] = Math.max(bandHeight[Math.floor(k / COLS)], colH(col));
  });
  const bandTop: number[] = [];
  let yCursor = MARGIN;
  for (let b = 0; b < bands; b++) {
    bandTop.push(yCursor);
    yCursor += bandHeight[b] + BAND_GAP;
  }
  chunks.forEach((col, k) => {
    const b = Math.floor(k / COLS);
    let y = bandTop[b];
    for (const node of col) {
      node.x = MARGIN + (k % COLS) * (BOX_W + GAP_X);
      node.y = y;
      y += node.h + GAP_Y;
    }
  });
  const usedCols = Math.min(COLS, chunks.length);
  const width = MARGIN * 2 + usedCols * BOX_W + (usedCols - 1) * GAP_X;
  const height = yCursor - BAND_GAP + MARGIN;

  const parts: string[] = [];
  // Natural size, not scaled down: the wrapper scrolls, so names stay readable on large schemas.
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="Entity relationship diagram with ${n} tables and ${model.relationships.length} relationships">`);
  parts.push(`<defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="currentColor"/></marker></defs>`);

  // Edges first, so boxes sit on top.
  model.relationships.forEach((rel, idx) => {
    const [fromTable, fromCol] = rel.from.replace(/^column:/, "").split(".");
    const toTable = rel.to.replace(/^column:/, "").split(".")[0];
    const a = nodes.get(fromTable);
    const b = nodes.get(toTable);
    if (!a || !b) return;
    const aRow = Math.max(0, a.table.columns.findIndex((c) => c.name === fromCol));
    const ay = a.y + HEAD + aRow * ROW + ROW / 2;
    const by = b.y + HEAD + ROW / 2;
    const dashed = rel.enforcement === "orm-declared" ? ` stroke-dasharray="6 5"` : "";
    const label = rel.cardinality === "one-to-one" ? "1 : 1" : "1 : n";
    const common = `fill="none" stroke="currentColor" stroke-width="1.5"${dashed} marker-end="url(#arrow)" class="edge ${esc(rel.enforcement)}"`;
    let d: string;
    let mx: number;
    let my: number;
    if (a === b) {
      // Self-reference: loop out to the right of the table.
      const x = a.x + BOX_W;
      d = `M${x},${ay} C${x + 60},${ay - 30} ${x + 60},${by + 30} ${x},${by}`;
      mx = x + 40;
      my = (ay + by) / 2;
    } else if (a.x > b.x) {
      // Referenced table is to the left: leave the left side of the foreign-key table.
      const ax = a.x;
      const bx = b.x + BOX_W;
      const dx = Math.max(30, (ax - bx) / 2);
      d = `M${ax},${ay} C${ax - dx},${ay} ${bx + dx},${by} ${bx},${by}`;
      mx = (ax + bx) / 2;
      my = (ay + by) / 2;
    } else if (a.x < b.x) {
      // Referenced table is to the right (wrapped band): leave the right side.
      const ax = a.x + BOX_W;
      const bx = b.x;
      const dx = Math.max(30, (bx - ax) / 2);
      d = `M${ax},${ay} C${ax + dx},${ay} ${bx - dx},${by} ${bx},${by}`;
      mx = (ax + bx) / 2;
      my = (ay + by) / 2;
    } else {
      // Same column in different bands: curve out on the right.
      const ax = a.x + BOX_W;
      d = `M${ax},${ay} C${ax + 50},${ay} ${ax + 50},${by} ${ax},${by}`;
      mx = ax + 25;
      my = (ay + by) / 2;
    }
    parts.push(
      `<a href="#rel-${idx}" aria-label="${esc(rel.from)} to ${esc(rel.to)}, ${esc(rel.enforcement)}"><path d="${d}" ${common}/>` +
        `<text x="${mx}" y="${my - 4}" text-anchor="middle" class="edge-label">${label}</text></a>`
    );
  });

  for (const node of nodes.values()) {
    const t = node.table;
    parts.push(`<g id="erd-${esc(t.name)}" class="entity" data-name="${esc(t.name.toLowerCase())}">`);
    parts.push(`<rect x="${node.x}" y="${node.y}" width="${BOX_W}" height="${node.h}" rx="8" class="box"/>`);
    parts.push(`<rect x="${node.x}" y="${node.y}" width="${BOX_W}" height="${HEAD}" rx="8" class="box-head"/>`);
    parts.push(`<text x="${node.x + 10}" y="${node.y + 20}" class="table-name">${esc(t.name)}</text>`);
    t.columns.forEach((c, i) => {
      const yy = node.y + HEAD + PAD + i * ROW + 13;
      const key = c.isPrimaryKey ? "PK " : c.isUnique ? "U " : "";
      parts.push(`<text x="${node.x + 10}" y="${yy}" class="col${c.isPrimaryKey ? " pk" : ""}">${esc(key + c.name)}</text>`);
      parts.push(`<text x="${node.x + BOX_W - 10}" y="${yy}" text-anchor="end" class="col-type">${esc(c.type + (c.nullable ? "?" : ""))}</text>`);
    });
    parts.push(`</g>`);
  }

  parts.push(`</svg>`);
  return parts.join("\n");
}

export const ERD_CSS = `
.erd-wrap { overflow-x: auto; border: 1px solid var(--line); border-radius: 8px; padding: 8px; }
.erd-wrap svg { color: var(--fg); display: block; }
.erd-wrap .box { fill: var(--bg); stroke: var(--line); stroke-width: 1.2; }
.erd-wrap .box-head { fill: var(--head); stroke: var(--line); stroke-width: 1.2; }
.erd-wrap .table-name { font: 600 13px system-ui, sans-serif; fill: var(--fg); }
.erd-wrap .col { font: 12px ui-monospace, monospace; fill: var(--fg); }
.erd-wrap .col.pk { font-weight: 700; }
.erd-wrap .col-type { font: 11px ui-monospace, monospace; fill: var(--muted); }
.erd-wrap .edge-label { font: 11px system-ui, sans-serif; fill: var(--muted); paint-order: stroke; stroke: var(--bg); stroke-width: 3px; }
.erd-wrap .edge.db-enforced { color: var(--solid); }
.erd-wrap .edge.orm-declared { color: var(--dash); }
.erd-wrap a:focus-visible { outline: none; }
.erd-wrap a:focus-visible .edge { stroke-width: 3; }
`;
