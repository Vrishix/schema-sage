import { analyzeRepo } from "../src/pipeline.js";
const target = process.argv[2];
const t0 = Date.now();
const r = await analyzeRepo(target, { write: false });
const m = r.model!;
console.log(`ms=${Date.now() - t0} tables=${m.tables.length} rels=${m.relationships.length} findings=${m.findings.length}`);
console.log(`db-enforced=${m.relationships.filter((x) => x.enforcement === "db-enforced").length} orm-declared=${m.relationships.filter((x) => x.enforcement === "orm-declared").length}`);
console.log(`files read=${m.coverage.filesScanned.length}`);
const counts: Record<string, number> = {};
for (const u of m.coverage.unsupported) {
  const k = u.replace(/^[^:]*: /, "").replace(/"[^"]*"/g, '"…"').slice(0, 100);
  counts[k] = (counts[k] ?? 0) + 1;
}
for (const [k, v] of Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 12)) console.log(`${v}\t${k}`);
const byCat: Record<string, number> = {};
for (const f of m.findings) byCat[f.category] = (byCat[f.category] ?? 0) + 1;
console.log("findings by category:", JSON.stringify(byCat));
