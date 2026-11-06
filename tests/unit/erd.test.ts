import { describe, it, expect } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeRepo } from "../../src/pipeline.js";
import { erdSvg } from "../../src/generator/erd.js";
import { databaseHtml } from "../../src/generator/html.js";
import type { DatabaseModel } from "../../src/model/types.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const basic = path.resolve(here, "../../fixtures/prisma-basic");

const count = (s: string, re: RegExp) => (s.match(re) ?? []).length;

describe("ER diagram", () => {
  it("draws one box per table and one edge per relationship", async () => {
    const { model } = await analyzeRepo(basic, { write: false });
    const svg = erdSvg(model!);
    expect(count(svg, /class="box"/g)).toBe(model!.tables.length);
    expect(count(svg, /class="edge /g)).toBe(model!.relationships.length);
  });

  it("draws orm-declared edges dashed and db-enforced edges solid", () => {
    const m: DatabaseModel = {
      schemaVersion: "0.1.0", tool: { name: "t", version: "t" }, generatedAt: "", source: { adapter: "prisma", adapterVersion: "x", files: ["s"] },
      tables: [
        { id: "table:A", name: "A", dbName: null, explanation: null, status: "verified", evidence: [], columns: [{ id: "column:A.id", name: "id", type: "Int", nullable: false, default: null, isPrimaryKey: true, isUnique: true, status: "verified", evidence: [] }] },
        { id: "table:B", name: "B", dbName: null, explanation: null, status: "verified", evidence: [], columns: [{ id: "column:B.aId", name: "aId", type: "Int", nullable: false, default: null, isPrimaryKey: false, isUnique: false, status: "verified", evidence: [] }, { id: "column:B.id", name: "id", type: "Int", nullable: false, default: null, isPrimaryKey: true, isUnique: true, status: "verified", evidence: [] }] },
      ],
      relationships: [
        { id: "r1", from: "column:B.aId", to: "column:A.id", cardinality: "one-to-many", enforcement: "orm-declared", status: "verified", evidence: [] },
        { id: "r2", from: "column:B.id", to: "column:A.id", cardinality: "one-to-one", enforcement: "db-enforced", status: "verified", evidence: [] },
      ],
      findings: [], coverage: { filesScanned: [], skipped: [], unsupported: [] },
    };
    const svg = erdSvg(m);
    expect(count(svg, /stroke-dasharray/g)).toBe(1);
    expect(svg).toContain('href="#rel-0"');
    expect(svg).toContain('href="#rel-1"');
  });

  it("places referenced tables to the left of the tables that reference them", async () => {
    const { model } = await analyzeRepo(basic, { write: false });
    const svg = erdSvg(model!);
    const xOf = (name: string) => Number(new RegExp(`id="erd-${name}" class="entity"[^>]*>\\s*<rect x="([0-9.]+)"`).exec(svg)![1]);
    expect(xOf("User")).toBeLessThan(xOf("Booking"));
    expect(xOf("TutorProfile")).toBeLessThan(xOf("Booking"));
    expect(xOf("Booking")).toBeLessThan(xOf("Review"));
  });

  it("escapes repository text and never emits scripts", async () => {
    const { model } = await analyzeRepo(basic, { write: false });
    const bad = JSON.parse(JSON.stringify(model)) as DatabaseModel;
    bad.tables[0].name = "<img src=x onerror=alert(1)>";
    const svg = erdSvg(bad);
    expect(svg).not.toContain("<img");
    expect(svg).toContain("&lt;img");
    const html = databaseHtml(bad);
    // Only our own filter script may appear, and nothing from repository text.
    const scripts = html.match(/<script>[\s\S]*?<\/script>/g) ?? [];
    expect(scripts.length).toBe(1);
    expect(scripts[0]).not.toContain("onerror");
    expect(html).not.toContain("<img src=x");
  });

  it("renders an empty model as nothing rather than failing", () => {
    const empty = { tables: [], relationships: [] } as unknown as DatabaseModel;
    expect(erdSvg(empty)).toBe("");
  });
});
