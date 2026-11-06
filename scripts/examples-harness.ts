import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { execSync } from "node:child_process";
import { analyzeRepo } from "../src/pipeline.js";

const root = process.argv[2];
const found = execSync(`find ${root} -name schema.prisma -not -path "*/node_modules/*"`).toString().trim().split("\n").filter(Boolean);
const rows: string[] = [];
let ok = 0, fail = 0;
for (const schema of found) {
  const prismaDir = path.dirname(schema);
  const repo = await fs.mkdtemp(path.join(os.tmpdir(), "rw-"));
  await fs.cp(prismaDir, path.join(repo, "prisma"), { recursive: true });
  const label = path.relative(root, prismaDir);
  try {
    const r = await analyzeRepo(repo, { write: false });
    const m = r.model!;
    ok++;
    rows.push(`OK   ${label}\ttables=${m.tables.length} rels=${m.relationships.length} findings=${m.findings.length} unsupported=${m.coverage.unsupported.length}`);
  } catch (e) {
    fail++;
    rows.push(`FAIL ${label}\t${(e as Error).message.split("\n").slice(0, 2).join(" | ").slice(0, 200)}`);
  }
}
console.log(rows.join("\n"));
console.log(`\nSUMMARY ok=${ok} fail=${fail} total=${found.length}`);
