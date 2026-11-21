import path from "node:path";
import { createHash } from "node:crypto";
import { scanRepo } from "./scanner/scan.js";
import { adapters } from "./adapters/index.js";
import { redactPatterns } from "./redaction/patterns.js";
import { validateModel } from "./validation/validate.js";
import { writeOutput } from "./generator/output.js";
import { databaseMarkdown } from "./generator/markdown.js";
import { databaseHtml } from "./generator/html.js";
import type { DatabaseModel } from "./model/types.js";
import { TOOL_VERSION } from "./version.js";
import { scanUsage, type SourceFile } from "./usage/scan-usage.js";
import { buildFlows } from "./usage/flows.js";
import { promises as fs } from "node:fs";

const CODE_EXT = /\.(ts|tsx|js|jsx|mjs|cjs)$/;
const MAX_SOURCE_BYTES = 1_000_000;

export interface AnalyzeResult {
  model: DatabaseModel | null;
  adapter: string | null;
  written: string[];
  log: string[];
}

/**
 * Output generator from an existing model (used by direct inspect as well).
 */
export async function writeModelArtifacts(
  outputDir: string,
  model: DatabaseModel
): Promise<{ written: string[]; log: string[] }> {
  const log: string[] = [];
  const files: Record<string, string> = {
    "data/database.json": JSON.stringify(model, null, 2) + "\n",
    "markdown/database.md": databaseMarkdown(model),
    "index.html": databaseHtml(model),
  };
  let redactions = 0;
  for (const k of Object.keys(files)) {
    const r = redactPatterns(files[k]);
    files[k] = r.text;
    redactions += r.hits.length;
  }
  if (redactions) log.push(`Redacted ${redactions} secret-like value(s) from output.`);

  const entries = await writeOutput(outputDir, files);
  const manifest = { tool: { name: "schemasage", version: TOOL_VERSION }, generatedAt: model.generatedAt, files: entries };
  await writeOutput(outputDir, { "manifest.json": JSON.stringify(manifest, null, 2) + "\n" });
  log.push(`Wrote ${entries.length + 1} files to artifacts/schemasage/`);
  return { written: [...entries.map((e) => e.path), "manifest.json"], log };
}

/**
 * Direct Database Inspection Pipeline: connects to live PostgreSQL or MongoDB,
 * introspects the schema/collections, and generates the offline report.
 */
export async function inspectDatabase(connectionUrl: string, outputDir = "."): Promise<AnalyzeResult> {
  const log: string[] = [];
  let model: DatabaseModel;
  let adapterName: string;

  if (connectionUrl.startsWith("postgres://") || connectionUrl.startsWith("postgresql://")) {
    log.push("Connecting to PostgreSQL database...");
    const { introspectPostgres } = await import("./introspect/postgres.js");
    model = await introspectPostgres(connectionUrl);
    adapterName = "postgres-direct";
  } else if (connectionUrl.startsWith("mongodb://") || connectionUrl.startsWith("mongodb+srv://")) {
    log.push("Connecting to MongoDB database...");
    const { introspectMongo } = await import("./introspect/mongo.js");
    model = await introspectMongo(connectionUrl);
    adapterName = "mongodb-direct";
  } else {
    throw new Error(`Unsupported connection protocol. Supported: postgres://, postgresql://, mongodb://, mongodb+srv://`);
  }

  log.push(`Introspected ${model.tables.length} table(s)/collection(s) and ${model.relationships.length} relationship(s).`);
  const { written, log: writeLog } = await writeModelArtifacts(path.resolve(outputDir), model);
  log.push(...writeLog);

  return {
    model,
    adapter: adapterName,
    written,
    log,
  };
}

/**
 * Read-only pipeline: scan -> extract -> validate -> redact -> write output.
 * Environment files are listed as skipped and never opened.
 */
export async function analyzeRepo(target: string, opts: { write?: boolean } = {}): Promise<AnalyzeResult> {
  const repoRoot = path.resolve(target);
  const log: string[] = [];
  const scan = await scanRepo(repoRoot);
  log.push(`Scanned ${scan.files.length} files`);

  const adapter = adapters.find((a) => a.detect(scan.files));
  if (!adapter) {
    log.push("No supported database adapter detected.");
    return { model: null, adapter: null, written: [], log };
  }
  const model = await adapter.extract(repoRoot, scan.files);
  model.coverage.skipped = scan.skipped;

  if (adapter.name === "prisma") {
    const sources: SourceFile[] = [];
    for (const f of scan.files) {
      if (!CODE_EXT.test(f.path) || f.path.endsWith(".d.ts") || f.size > MAX_SOURCE_BYTES) continue;
      sources.push({ path: f.path, text: await fs.readFile(path.join(repoRoot, f.path), "utf8") });
    }
    const usage = scanUsage(sources, model.tables.map((t) => t.name));
    const { endpoints, flows } = buildFlows(sources, usage.usages);
    model.application = { receivers: usage.receivers, usages: usage.usages, rawSql: usage.rawSql, endpoints, flows };
    if (usage.rawSql.length) model.coverage.unsupported.push(`${usage.rawSql.length} raw SQL call(s) found (prisma.$queryRaw / $executeRaw); not analysed for tables`);
    log.push(`Application: ${usage.usages.length} Prisma call(s), ${endpoints.length} endpoint(s), ${flows.length} flow(s)`);
  }

  const issues = validateModel(model);
  if (issues.length) {
    throw new Error("Model failed validation:\n" + issues.map((i) => `- [${i.rule}] ${i.message}`).join("\n"));
  }

  if (!opts.write) {
    return { model, adapter: adapter.name, written: [], log };
  }

  const { written, log: writeLog } = await writeModelArtifacts(repoRoot, model);
  log.push(...writeLog);

  return { model, adapter: adapter.name, written, log };
}

export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
