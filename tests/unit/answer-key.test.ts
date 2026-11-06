import { describe, it, expect } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promises as fs } from "node:fs";
import { analyzeRepo } from "../../src/pipeline.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const basic = path.resolve(here, "../../fixtures/prisma-basic");

describe("prisma-basic answer key", () => {
  it("matches the hand-written expected model", async () => {
    const { model } = await analyzeRepo(basic, { write: false });
    const expected = JSON.parse(await fs.readFile(path.join(basic, "expected/database.expected.json"), "utf8"));
    expect(model).not.toBeNull();
    const m = model!;

    // Tables and columns
    expect(m.tables.map((t) => t.name).sort()).toEqual(Object.keys(expected.tables).sort());
    for (const [tname, exp] of Object.entries<any>(expected.tables)) {
      const t = m.tables.find((x) => x.name === tname)!;
      for (const [cname, ec] of Object.entries<any>(exp.columns)) {
        const c = t.columns.find((x) => x.name === cname);
        expect(c, `${tname}.${cname} exists`).toBeDefined();
        expect(c!.type, `${tname}.${cname} type`).toBe(ec.type);
        expect(c!.nullable, `${tname}.${cname} nullable`).toBe(ec.nullable);
        expect(c!.isPrimaryKey, `${tname}.${cname} pk`).toBe(ec.isPrimaryKey);
        expect(c!.isUnique, `${tname}.${cname} unique`).toBe(Boolean(ec.unique));
      }
      expect(t.columns.length).toBe(Object.keys(exp.columns).length);
    }

    // Relationships: exact set, no fabricated foreign keys
    const got = m.relationships.map((r) => ({ from: r.from.replace("column:", ""), to: r.to.replace("column:", ""), cardinality: r.cardinality, enforcement: r.enforcement }));
    const key = (r: any) => `${r.from}|${r.to}|${r.cardinality}|${r.enforcement}`;
    expect(got.map(key).sort()).toEqual(expected.relationships.map(key).sort());

    // Findings: exact set
    const gotF = m.findings.map((f) => `${f.category}|${f.id.split(":").slice(2).join(":")}`).sort();
    const expF = expected.findings.map((f: any) => `${f.category}|${f.column}`).sort();
    expect(gotF).toEqual(expF);

    // Coverage
    expect([...m.coverage.filesScanned].sort()).toEqual([...expected.coverage.filesScanned].sort());
    expect(m.coverage.skipped).toEqual([]);
  });
});
