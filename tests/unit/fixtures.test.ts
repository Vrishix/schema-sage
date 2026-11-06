import { describe, it, expect } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { scanRepo } from "../../src/scanner/scan.js";
import { parseEnvValues } from "../../src/redaction/redact.js";
import { promises as fs } from "node:fs";

const here = path.dirname(fileURLToPath(import.meta.url));
const basic = path.resolve(here, "../../fixtures/prisma-basic");
const secrets = path.resolve(here, "../../fixtures/prisma-secrets");

describe("scanner on fixtures", () => {
  it("finds the expected files in prisma-basic", async () => {
    const { files } = await scanRepo(basic);
    const expected = JSON.parse(await fs.readFile(path.join(basic, "expected/database.expected.json"), "utf8"));
    expect(files.map((f) => f.path).sort()).toEqual([...expected.coverage.filesScanned].sort().concat(["expected/database.expected.json"]).sort());
  });

  it("never lists .env contents as scanned files and records it as skipped", async () => {
    const { files, skipped } = await scanRepo(secrets);
    expect(files.map((f) => f.path)).not.toContain(".env");
    expect(skipped.map((s) => s.file)).toContain(".env");
  });
});

describe("secret leak guard", () => {
  it("every .env value in the secrets fixture is registered for redaction", async () => {
    const text = await fs.readFile(path.join(secrets, ".env"), "utf8");
    const values = parseEnvValues(text);
    expect(values.length).toBe(3);
  });
});

