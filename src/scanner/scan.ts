import { promises as fs } from "node:fs";
import path from "node:path";
import { ALWAYS_IGNORED_DIRS, ALWAYS_IGNORED_FILES } from "./ignore.js";

export interface ScannedFile {
  path: string;   // repo-relative, forward slashes
  size: number;
}

export interface ScanResult {
  files: ScannedFile[];
  skipped: { file: string; reason: string }[];
}

/** Lists files without reading their contents. .env files are listed as skipped, never read. */
export async function scanRepo(repoRoot: string): Promise<ScanResult> {
  const files: ScannedFile[] = [];
  const skipped: { file: string; reason: string }[] = [];

  async function walk(dir: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      const rel = path.relative(repoRoot, full).split(path.sep).join("/");
      if (entry.isDirectory()) {
        if (ALWAYS_IGNORED_DIRS.has(entry.name)) {
          skipped.push({ file: rel + "/", reason: "ignored directory" });
          continue;
        }
        await walk(full);
      } else if (entry.isFile()) {
        if (ALWAYS_IGNORED_FILES.test(rel)) {
          skipped.push({ file: rel, reason: "environment file (values never read)" });
          continue;
        }
        const stat = await fs.stat(full);
        files.push({ path: rel, size: stat.size });
      }
    }
  }

  await walk(repoRoot);
  files.sort((a, b) => a.path.localeCompare(b.path));
  return { files, skipped };
}
