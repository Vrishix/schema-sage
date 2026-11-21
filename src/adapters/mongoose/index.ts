import { promises as fs } from "node:fs";
import path from "node:path";
import type { DatabaseAdapter } from "../types.js";
import type { ScannedFile } from "../../scanner/scan.js";
import type { DatabaseModel, Table, Column, Relationship, Finding } from "../../model/types.js";
import { tableId, columnId, relationshipId } from "../../model/ids.js";
import { TOOL_VERSION } from "../../version.js";

interface ExtractedField {
  name: string;
  type: string;
  required: boolean;
  unique: boolean;
  ref?: string;
  line: number;
}

interface ExtractedSchema {
  modelName: string;
  collectionName: string;
  file: string;
  line: number;
  fields: ExtractedField[];
}

function cleanTypeName(t: string): string {
  return t
    .replace(/^(?:mongoose\.)?(?:Schema\.)?(?:Types\.)?/, "")
    .replace(/^String$/i, "string")
    .replace(/^Number$/i, "number")
    .replace(/^Boolean$/i, "boolean")
    .replace(/^Date$/i, "Date")
    .replace(/^ObjectId$/i, "ObjectId");
}

export const mongooseAdapter: DatabaseAdapter = {
  name: "mongoose",
  supportedFeatures: [
    "Mongoose Schemas",
    "AST Type extraction",
    "required / unique constraints",
    "ref cross-collection relationships",
    "Typegoose @prop support",
  ],
  detect(files: ScannedFile[]): boolean {
    // Only detect if there are files that genuinely look like mongoose models / schemas,
    // not merely having a folder named 'models' or a general package.json
    return files.some(
      (f) =>
        (f.path.endsWith(".ts") || f.path.endsWith(".js") || f.path.endsWith(".mjs")) &&
        (f.path.includes("models/") ||
          f.path.includes("schema/") ||
          f.path.includes("schemas/") ||
          f.path.endsWith(".model.ts") ||
          f.path.endsWith(".model.js") ||
          f.path.endsWith(".schema.ts") ||
          f.path.endsWith(".schema.js")) &&
        !f.path.includes("node_modules")
    );
  },
  async extract(repoRoot: string, files: ScannedFile[]): Promise<DatabaseModel> {
    const { parseMongooseAST } = await import("./ast-parser.js");
    const candidateFiles = files.filter(
      (f) =>
        (f.path.endsWith(".ts") || f.path.endsWith(".js") || f.path.endsWith(".mjs")) &&
        !f.path.endsWith(".d.ts") &&
        !f.path.includes("node_modules") &&
        (f.path.includes("model") ||
          f.path.includes("schema") ||
          f.path.includes("entity") ||
          f.path.includes("entities"))
    );

    const allSchemas: ExtractedSchema[] = [];
    const scannedPaths: string[] = [];

    for (const file of candidateFiles) {
      try {
        const content = await fs.readFile(path.join(repoRoot, file.path), "utf8");
        if (
          content.includes("Schema") ||
          content.includes("model") ||
          content.includes("mongoose") ||
          content.includes("@prop")
        ) {
          const parsed = parseMongooseAST(content, file.path);
          if (parsed.length > 0) {
            allSchemas.push(...parsed);
            scannedPaths.push(file.path);
          }
        }
      } catch {
        // Skip unreadable files
      }
    }

    const tables: Table[] = [];
    const relationships: Relationship[] = [];
    const modelNameToTable = new Map<string, string>();

    const seenCollections = new Set<string>();

    for (const m of allSchemas) {
      if (seenCollections.has(m.collectionName)) continue;
      seenCollections.add(m.collectionName);

      modelNameToTable.set(m.modelName, m.collectionName);
      modelNameToTable.set(m.collectionName, m.collectionName);
      modelNameToTable.set(m.modelName.toLowerCase(), m.collectionName);

      const columns: Column[] = m.fields.map((p) => ({
        id: columnId(m.collectionName, p.name),
        name: p.name,
        type: p.type,
        nullable: !p.required,
        default: null,
        isPrimaryKey: p.name === "_id",
        isUnique: p.unique || p.name === "_id",
        status: "verified",
        evidence: [{ file: m.file, lines: [p.line, p.line] }],
      }));

      tables.push({
        id: tableId(m.collectionName),
        name: m.collectionName,
        dbName: m.collectionName,
        explanation: `MongoDB Collection (from model: ${m.modelName})`,
        status: "verified",
        evidence: [{ file: m.file, lines: [m.line, m.line] }],
        columns,
      });
    }

    // Build relationships from ref
    for (const m of allSchemas) {
      for (const p of m.fields) {
        if (p.ref && modelNameToTable.has(p.ref)) {
          const targetTable = modelNameToTable.get(p.ref)!;
          if (targetTable !== m.collectionName) {
            relationships.push({
              id: relationshipId(columnId(m.collectionName, p.name), columnId(targetTable, "_id")),
              from: columnId(m.collectionName, p.name),
              to: columnId(targetTable, "_id"),
              cardinality: "one-to-many",
              enforcement: "orm-declared",
              status: "inferred",
              evidence: [{ file: m.file, lines: [p.line, p.line] }],
            });
          }
        }
      }
    }

    return {
      schemaVersion: "0.2.0",
      tool: { name: "schemasage", version: TOOL_VERSION },
      generatedAt: new Date().toISOString(),
      source: {
        adapter: "mongoose",
        adapterVersion: TOOL_VERSION,
        files: scannedPaths.length > 0 ? scannedPaths : ["models/"],
      },
      tables,
      relationships,
      findings: [],
      coverage: {
        filesScanned: scannedPaths,
        skipped: [],
        unsupported: [],
      },
    };
  },
};
