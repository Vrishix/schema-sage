import { describe, it, expect } from "vitest";
import { writeOutput } from "../../src/generator/output.js";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

describe("output safety", () => {
  it("writes only inside artifacts/schemasage and refuses path escapes", async () => {
    const repo = await fs.mkdtemp(path.join(os.tmpdir(), "ss-"));
    const manifest = await writeOutput(repo, { "data/database.json": "{}" });
    expect(manifest[0].path).toBe("data/database.json");
    await expect(fs.stat(path.join(repo, "artifacts/schemasage/data/database.json"))).resolves.toBeTruthy();
    await expect(writeOutput(repo, { "../../evil.txt": "x" })).rejects.toThrow(/Refusing/);
  });
});
