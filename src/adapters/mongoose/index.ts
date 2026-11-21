import { promises as fs } from "node:fs";
import path from "node:path";
import type { DatabaseAdapter } from "../types.js";
import type { ScannedFile } from "../../scanner/scan.js";
import type { DatabaseModel, Table, Column, Relationship, Finding } from "../../model/types.js";
import { tableId, columnId, relationshipId } from "../../model/ids.js";
import { TOOL_VERSION } from "../../version.js";

interface MongooseProp {
  name: string;
  type: string;
  required?: boolean;
  unique?: boolean;
  ref?: string;
  line: number;
}

interface MongooseModel {
  name: string;
  collection: string;
  file: string;
  line: number;
  properties: MongooseProp[];
}

export function parseMongooseSchemas(fileContent: string, filePath: string): MongooseModel[] {
  const models: MongooseModel[] = [];
  const lines = fileContent.split(/\r?\n/);

  // Look for mongoose.model("User", UserSchema) or model("User", ...)
  // and Schema definitions
  const schemaRegex = /(?:const|let|var)\s+([A-Za-z0-9_]+)\s*=\s*(?:new\s+)?(?:mongoose\.)?Schema\s*\(\s*\{([\s\S]*?)\}\s*(?:,\s*\{([\s\S]*?)\})?\s*\)/g;
  
  let match: RegExpExecArray | null;
  while ((match = schemaRegex.exec(fileContent)) !== null) {
    const schemaVarName = match[1];
    const schemaBody = match[2];
    const schemaOptions = match[3] || "";
    
    // Find model registration e.g. mongoose.model("User", UserSchema)
    const modelRegRegex = new RegExp(`(?:mongoose\\.)?model\\s*\\(\\s*["']([^"']+)["']\\s*,\\s*${schemaVarName}`, "i");
    const modelRegMatch = modelRegRegex.exec(fileContent);
    const modelName = modelRegMatch ? modelRegMatch[1] : schemaVarName.replace(/Schema$/i, "");
    
    // Find custom collection name if specified in options: { collection: 'users' }
    const collMatch = /collection\s*:\s*["']([^"']+)["']/i.exec(schemaOptions);
    const collectionName = collMatch ? collMatch[1] : modelName.toLowerCase() + "s";

    // Calculate approximate line
    const matchIndex = match.index;
    const lineNum = fileContent.substring(0, matchIndex).split("\n").length;

    const props: MongooseProp[] = [
      {
        name: "_id",
        type: "ObjectId",
        required: true,
        unique: true,
        line: lineNum,
      }
    ];

    // Parse simple fields in schemaBody line-by-line
    const bodyLines = schemaBody.split("\n");
    for (let i = 0; i < bodyLines.length; i++) {
      const bLine = bodyLines[i].trim();
      const simpleFieldMatch = /^([A-Za-z0-9_]+)\s*:\s*(?:\{([^}]*)\}|([A-Za-z0-9_.[\]]+))/.exec(bLine);
      if (simpleFieldMatch) {
        const fieldName = simpleFieldMatch[1];
        if (fieldName === "_id") continue;
        const fieldObj = simpleFieldMatch[2];
        const directType = simpleFieldMatch[3];

        let typeStr = directType || "Mixed";
        let isRequired = false;
        let isUnique = false;
        let refTarget: string | undefined;

        if (fieldObj) {
          const typeMatch = /type\s*:\s*([A-Za-z0-9_.[\]]+)/.exec(fieldObj);
          if (typeMatch) typeStr = typeMatch[1];
          isRequired = /required\s*:\s*true/i.test(fieldObj);
          isUnique = /unique\s*:\s*true/i.test(fieldObj);
          const refMatch = /ref\s*:\s*["']([^"']+)["']/.exec(fieldObj);
          if (refMatch) refTarget = refMatch[1];
        }

        // Clean up type string
        typeStr = typeStr.replace(/mongoose\.Schema\.Types\./g, "").replace(/Schema\.Types\./g, "");

        props.push({
          name: fieldName,
          type: typeStr,
          required: isRequired,
          unique: isUnique,
          ref: refTarget,
          line: lineNum + i,
        });
      }
    }

    models.push({
      name: modelName,
      collection: collectionName,
      file: filePath,
      line: lineNum,
      properties: props,
    });
  }

  return models;
}

export const mongooseAdapter: DatabaseAdapter = {
  name: "mongoose",
  supportedFeatures: [
    "Mongoose Schemas", "type definitions", "required", "unique", "ref relationships",
  ],
  detect(files: ScannedFile[]): boolean {
    return files.some((f) => 
      f.path.endsWith("package.json") ||
      f.path.includes("models/") ||
      f.path.includes("schema/") ||
      f.path.endsWith(".model.ts") ||
      f.path.endsWith(".model.js")
    );
  },
  async extract(repoRoot: string, files: ScannedFile[]): Promise<DatabaseModel> {
    const candidateFiles = files.filter(
      (f) =>
        (f.path.endsWith(".ts") || f.path.endsWith(".js")) &&
        !f.path.endsWith(".d.ts") &&
        (f.path.includes("models") || f.path.includes("schema") || f.path.includes("entities"))
    );

    const allModels: MongooseModel[] = [];
    const scannedPaths: string[] = [];

    for (const file of candidateFiles) {
      try {
        const content = await fs.readFile(path.join(repoRoot, file.path), "utf8");
        if (content.includes("Schema") || content.includes("mongoose")) {
          const parsed = parseMongooseSchemas(content, file.path);
          if (parsed.length > 0) {
            allModels.push(...parsed);
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

    for (const m of allModels) {
      modelNameToTable.set(m.name, m.collection);
      modelNameToTable.set(m.collection, m.collection);

      const columns: Column[] = m.properties.map((p) => ({
        id: columnId(m.collection, p.name),
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
        id: tableId(m.collection),
        name: m.collection,
        dbName: m.collection,
        explanation: `Mongoose Model: ${m.name}`,
        status: "verified",
        evidence: [{ file: m.file, lines: [m.line, m.line] }],
        columns,
      });
    }

    // Build relationships from ref
    for (const m of allModels) {
      for (const p of m.properties) {
        if (p.ref && modelNameToTable.has(p.ref)) {
          const targetTable = modelNameToTable.get(p.ref)!;
          relationships.push({
            id: relationshipId(columnId(m.collection, p.name), columnId(targetTable, "_id")),
            from: columnId(m.collection, p.name),
            to: columnId(targetTable, "_id"),
            cardinality: "one-to-many",
            enforcement: "orm-declared",
            status: "inferred",
            evidence: [{ file: m.file, lines: [p.line, p.line] }],
          });
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
