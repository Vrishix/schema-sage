import { describe, it, expect } from "vitest";
import path from "node:path";
import os from "node:os";
import { promises as fs } from "node:fs";
import { fileURLToPath } from "node:url";
import { analyzeRepo } from "../../src/pipeline.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const basic = path.resolve(here, "../../fixtures/prisma-basic");

async function copyRepo(src: string): Promise<string> {
  const dst = await fs.mkdtemp(path.join(os.tmpdir(), "ss-repo-"));
  await fs.cp(src, dst, { recursive: true });
  return dst;
}

async function snapshot(dir: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  async function walk(d: string) {
    for (const e of await fs.readdir(d, { withFileTypes: true })) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) {
        if (e.name === "artifacts") continue;
        await walk(full);
      } else out[path.relative(dir, full)] = await fs.readFile(full, "utf8");
    }
  }
  await walk(dir);
  return out;
}

describe("output", () => {
  it("writes only inside artifacts/schemasage and leaves source untouched", async () => {
    const repo = await copyRepo(basic);
    const before = await snapshot(repo);
    await analyzeRepo(repo, { write: true });
    const after = await snapshot(repo);
    expect(after).toEqual(before);
    const outDir = path.join(repo, "artifacts/schemasage");
    await expect(fs.stat(path.join(outDir, "index.html"))).resolves.toBeTruthy();
    await expect(fs.stat(path.join(outDir, "manifest.json"))).resolves.toBeTruthy();
  });

  it("is repeatable: second run gives identical data", async () => {
    const repo = await copyRepo(basic);
    await analyzeRepo(repo, { write: true });
    const first = await fs.readFile(path.join(repo, "artifacts/schemasage/markdown/database.md"), "utf8");
    await analyzeRepo(repo, { write: true });
    const second = await fs.readFile(path.join(repo, "artifacts/schemasage/markdown/database.md"), "utf8");
    expect(second).toBe(first);
  });

  it("redacts secret-shaped values from repository text in every output", async () => {
    const repo = await copyRepo(basic);
    const pw = "FAKE_leak_canary_987654";
    const schemaPath = path.join(repo, "prisma/schema.prisma");
    await fs.writeFile(schemaPath, (await fs.readFile(schemaPath, "utf8")) + `\n// url: postgresql://u:${pw}@h/db\n// DATABASE_PASSWORD=${pw}\n`);
    await analyzeRepo(repo, { write: true });
    const outDir = path.join(repo, "artifacts/schemasage");
    for (const f of ["index.html", "data/database.json", "markdown/database.md"]) {
      const text = await fs.readFile(path.join(outDir, f), "utf8");
      expect(text, f).not.toContain(pw);
    }
  });

  it("does not depend on .env: output is identical with and without one", async () => {
    const withEnv = await copyRepo(basic);
    await fs.writeFile(path.join(withEnv, ".env"), "DATABASE_URL=postgresql://u:FAKE_env_only_555555@h/db\n");
    const without = await copyRepo(basic);
    const a = await analyzeRepo(withEnv, { write: false });
    const b = await analyzeRepo(without, { write: false });
    // .env is expected to appear as skipped in coverage; everything else must match.
    const strip = (m: any) => ({ ...m, generatedAt: "", coverage: { ...m.coverage, skipped: [] } });
    expect(strip(a.model)).toEqual(strip(b.model));
    expect(a.model!.coverage.skipped.map((s) => s.file)).toContain(".env");
  });
});
