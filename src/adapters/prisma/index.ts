import { promises as fs } from "node:fs";
import path from "node:path";
import prismaInternals from "@prisma/internals";
import type { DatabaseAdapter } from "../types.js";
import type { ScannedFile } from "../../scanner/scan.js";
import type { DatabaseModel, Column, Table, Relationship, Evidence } from "../../model/types.js";
import { parseMigrations } from "./parse-migrations.js";
import { locateModels } from "./locate.js";
import { readBlockIndexes } from "./facts.js";
import { tableId, columnId, relationshipId } from "../../model/ids.js";
import { findDatabaseIssues, type ModelFacts } from "../../analysis/findings.js";
import { TOOL_VERSION } from "../../version.js";

const { getDMMF } = prismaInternals as unknown as { getDMMF: (args: { datamodel: string }) => Promise<any> };
const SCHEMA_SUFFIX = "schema.prisma";

/**
 * Prisma 7 rejects `url` in datasource blocks; Prisma 5 and 6 require it. For analysis only,
 * connection URL lines are removed from the text given to the reader. They are never used
 * or opened, and the structure they describe is unchanged.
 */
const URL_LINE = /^\s*(url|directUrl|shadowDatabaseUrl)\s*=.*$/gm;

/** Prisma messages contain terminal colour codes. Strip them so the message reads cleanly. */
function cleanError(err: unknown): Error {
  const msg = err instanceof Error ? err.message : String(err);
  return new Error("Prisma could not read schema.prisma:\n" + msg.replace(/\x1b\[[0-9;]*m/g, "").trim());
}

async function readDmmf(schemaText: string): Promise<{ dmmf: any; urlsIgnored: boolean }> {
  try {
    return { dmmf: await getDMMF({ datamodel: schemaText }), urlsIgnored: false };
  } catch (firstErr) {
    const stripped = schemaText.replace(URL_LINE, "");
    if (stripped === schemaText) throw cleanError(firstErr);
    try {
      return { dmmf: await getDMMF({ datamodel: stripped }), urlsIgnored: true };
    } catch {
      // Report the original validator message, not the retry's.
      throw cleanError(firstErr);
    }
  }
}

export const prismaAdapter: DatabaseAdapter = {
  name: "prisma",
  supportedFeatures: [
    "models", "scalar and enum fields", "@id", "@unique", "@default", "@relation(fields, references)",
    "composite @@id and foreign keys", "@@unique", "@@index", "@@map (physical table name shown)",
    "migration FOREIGN KEY", "migration CREATE INDEX",
  ],
  detect: (files) => files.some((f) => f.path.endsWith(SCHEMA_SUFFIX)),

  async extract(repoRoot: string, files: ScannedFile[]): Promise<DatabaseModel> {
    const schemaFile = files.find((f) => f.path.endsWith(SCHEMA_SUFFIX))!;
    const schemaText = await fs.readFile(path.join(repoRoot, schemaFile.path), "utf8");
    if (/provider\s*=\s*"mongodb"/.test(schemaText)) {
      throw new Error("MongoDB schemas are not supported yet (only relational providers).");
    }
    const { dmmf, urlsIgnored } = await readDmmf(schemaText);
    const relationModePrisma = /relationMode\s*=\s*"prisma"/.test(schemaText);
    const blockIndexes = readBlockIndexes(schemaText);
    const locations = new Map(locateModels(schemaText).map((l) => [l.name, l]));

    const sqlFiles = files.filter((f) => f.path.endsWith(".sql") && f.path.includes("migrations/"));
    const sqlByFile: Record<string, string> = {};
    for (const f of sqlFiles) sqlByFile[f.path] = await fs.readFile(path.join(repoRoot, f.path), "utf8");
    const migrations = parseMigrations(sqlByFile);

    const sf = schemaFile.path;
    const ev = (lines?: [number, number]): Evidence => ({ file: sf, lines });
    const tables: Table[] = [];
    const relationships: Relationship[] = [];
    const facts: ModelFacts[] = [];
    const unsupported: string[] = [];

    // Migrations use physical table names (@@map). Map model name -> physical name for matching.
    const physicalOf = new Map<string, string>((dmmf.datamodel.models as any[]).map((m) => [m.name, m.dbName ?? m.name]));
    const phys = (modelName: string) => physicalOf.get(modelName) ?? modelName;

    for (const model of dmmf.datamodel.models as any[]) {
      const loc = locations.get(model.name);
      const startLine = loc?.startLine ?? 1;
      const endLine = loc?.endLine ?? 1;
      const lineOf = (field: string) => loc?.fieldLines.get(field) ?? startLine;
      const pkFields: string[] = model.primaryKey?.fields ?? [];
      const uniqueGroups: string[][] = (model.uniqueIndexes ?? []).map((u: any) => u.fields);
      const blocks = blockIndexes.get(model.name) ?? [];
      const migUniqueSingle = (col: string) =>
        migrations.indexes.some((i) => i.unique && !i.primary && i.table === phys(model.name) && i.columns.length === 1 && i.columns[0] === col);

      const scalarFields = model.fields.filter((f: any) => f.kind === "scalar" || f.kind === "enum");
      const columns: Column[] = scalarFields.map((f: any) => {
        const isPk = Boolean(f.isId) || (pkFields.length === 1 && pkFields[0] === f.name) || pkFields.includes(f.name);
        const isUnique =
          Boolean(f.isUnique) ||
          uniqueGroups.some((g) => g.length === 1 && g[0] === f.name) ||
          blocks.some((b) => b.unique && b.columns.length === 1 && b.columns[0] === f.name) ||
          migUniqueSingle(f.name);
        const def = f.default;
        const defaultValue = def === undefined || def === null ? null : typeof def === "object" ? `${def.name ?? "function"}()` : String(def);
        return {
          id: columnId(model.name, f.name),
          name: f.name,
          type: f.isList ? `${f.type}[]` : f.type,
          nullable: !f.isRequired,
          default: defaultValue,
          isPrimaryKey: isPk,
          isUnique,
          status: "verified" as const,
          evidence: [ev([lineOf(f.name), lineOf(f.name)])],
        };
      });
      tables.push({ id: tableId(model.name), name: model.name, dbName: model.dbName ?? null, explanation: null, status: "verified", evidence: [ev([startLine, endLine])], columns });

      const relations: ModelFacts["relations"] = [];
      for (const f of model.fields.filter((x: any) => x.kind === "object" && x.relationFromFields?.length)) {
        const fkCols: string[] = f.relationFromFields;
        const refCols: string[] = f.relationToFields;
        const fkName = fkCols[0];
        relations.push({ field: f.name, refModel: f.type, fkColumns: fkCols, refColumns: refCols, line: lineOf(f.name) });
        if (fkCols.length > 1) unsupported.push(`${model.name}.${f.name}: composite foreign key; relationship drawn from ${fkName} only`);

        const fkUnique = columns.find((c) => c.name === fkName)?.isUnique ?? false;
        const mig = migrations.foreignKeys.find((x) => x.table === phys(model.name) && x.column === fkName && x.refTable === phys(f.type));
        const evidence: Evidence[] = [ev([lineOf(f.name), lineOf(f.name)])];
        if (mig) evidence.push({ file: mig.file });
        const from = columnId(model.name, fkName);
        const to = columnId(f.type, refCols[0]);
        relationships.push({
          id: relationshipId(from, to),
          from,
          to,
          cardinality: fkUnique ? "one-to-one" : "one-to-many",
          enforcement: mig ? "db-enforced" : "orm-declared",
          status: "verified",
          evidence,
        });
      }

      const indexes: ModelFacts["indexes"] = blocks.map((b) => ({ columns: b.columns, unique: b.unique, line: startLine }));
      facts.push({ name: model.name, startLine, endLine, primaryKey: pkFields, indexes, relations });
    }

    const model: DatabaseModel = {
      schemaVersion: "0.1.0",
      tool: { name: "schemasage", version: TOOL_VERSION },
      generatedAt: new Date().toISOString(),
      source: { adapter: "prisma", adapterVersion: "getDMMF+prisma-ast", files: [sf, ...sqlFiles.map((f) => f.path)] },
      tables,
      relationships,
      findings: [],
      coverage: { filesScanned: [sf, ...sqlFiles.map((f) => f.path)], skipped: [], unsupported: [...unsupported, ...migrations.unsupported] },
    };
    if (relationModePrisma) {
      for (const r of model.relationships) r.enforcement = "orm-declared";
      model.coverage.unsupported.push('relationMode = "prisma": foreign keys are emulated by Prisma, not created in the database. Relationships are shown as ORM-declared.');
    }
    if (urlsIgnored) model.coverage.unsupported.push("datasource connection URL lines were ignored for analysis (never read or used)");
    model.findings = findDatabaseIssues(model, facts, migrations);
    return model;
  },
};
