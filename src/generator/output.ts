import { promises as fs } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

export const OUTPUT_DIR = "artifacts/schemasage";

export interface ManifestEntry {
  path: string;
  sha256: string;
}

/**
 * Writes files only inside the output directory. Refuses any path that escapes it.
 * Refresh logic (replace only manifest-listed files) is planned for M5.
 */
export async function writeOutput(repoRoot: string, files: Record<string, string>): Promise<ManifestEntry[]> {
  const base = path.resolve(repoRoot, OUTPUT_DIR);
  const manifest: ManifestEntry[] = [];
  for (const [rel, content] of Object.entries(files)) {
    const target = path.resolve(base, rel);
    if (!target.startsWith(base + path.sep)) {
      throw new Error(`Refusing to write outside output directory: ${rel}`);
    }
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, content, "utf8");
    manifest.push({ path: rel, sha256: createHash("sha256").update(content).digest("hex") });
  }
  return manifest;
}
