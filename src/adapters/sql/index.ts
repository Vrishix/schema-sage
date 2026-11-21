import { promises as fs } from "node:fs";
import path from "node:path";
import { parse } from "pgsql-ast-parser";
import type { DatabaseAdapter } from "../types.js";
import type { ScannedFile } from "../../scanner/scan.js";
import type { DatabaseModel, Table, Column, Relationship, Finding } from "../../model/types.js";
import { tableId, columnId, relationshipId } from "../../model/ids.js";
import { TOOL_VERSION } from "../../version.js";

interface RawSqlCol {
  name: string;
  type: string;
  nullable: boolean;
  isPk: boolean;
  isUnique: boolean;
  defaultVal: string | null;
  line: number;
}

interface RawSqlTable {
  name: string;
  file: string;
  line: number;
  columns: RawSqlCol[];
}

interface RawSqlFk {
  fromTable: string;
  fromCol: string;
  toTable: string;
  toCol: string;
  file: string;
  line: number;
}

export const sqlAdapter: DatabaseAdapter = {
  name: "sql",
  supportedFeatures: ["CREATE TABLE", "PRIMARY KEY", "FOREIGN KEY", "UNIQUE", "NOT NULL"],
  detect(files: ScannedFile[]): boolean {
    return files.some(
      (f) =>
        f.path.endsWith(".sql") ||
        f.path.includes("migrations/") ||
        f.path.includes("schema.sql") ||
        f.path.includes("init.sql")
    );
  },
  async extract(repoRoot: string, files: ScannedFile[]): Promise<DatabaseModel> {
    const sqlFiles = files.filter(
      (f) =>
        f.path.endsWith(".sql") &&
        !f.path.includes("test") &&
        !f.path.includes("node_modules")
    );

    const tablesMap = new Map<string, RawSqlTable>();
    const fks: RawSqlFk[] = [];
    const scannedPaths: string[] = [];

    for (const f of sqlFiles) {
      try {
        const content = await fs.readFile(path.join(repoRoot, f.path), "utf8");
        scannedPaths.push(f.path);

        // Attempt AST parsing via pgsql-ast-parser
        try {
          const ast = parse(content);
          for (const stmt of ast) {
            if (stmt.type === "create table") {
              const tableName = stmt.name.name;
              const rawCols: RawSqlCol[] = [];

              for (const colDef of stmt.columns) {
                if (colDef.kind === "column") {
                  let isPk = false;
                  let isUnique = false;
                  let isNullable = true;
                  let defaultVal: string | null = null;

                  for (const c of colDef.constraints || []) {
                    if (c.type === "primary key") isPk = true;
                    if (c.type === "unique") isUnique = true;
                    if (c.type === "not null") isNullable = false;
                    if (c.type === "reference") {
                      fks.push({
                        fromTable: tableName,
                        fromCol: colDef.name.name,
                        toTable: c.foreignTable.name,
                        toCol: c.foreignColumns?.[0]?.name || "id",
                        file: f.path,
                        line: 1,
                      });
                    }
                  }

                  rawCols.push({
                    name: colDef.name.name,
                    type: typeof colDef.dataType === "string" ? colDef.dataType : (colDef.dataType as any)?.name || "text",
                    nullable: isNullable && !isPk,
                    isPk,
                    isUnique: isUnique || isPk,
                    defaultVal,
                    line: 1,
                  });
                }
              }

              tablesMap.set(tableName, {
                name: tableName,
                file: f.path,
                line: 1,
                columns: rawCols,
              });
            }
          }
        } catch {
          // Fallback: regex matching for standard CREATE TABLE if parser trips on dialect variations
          const createTableRegex = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([A-Za-z0-9_."]+)\s*\(([\s\S]*?)\);/gi;
          let match: RegExpExecArray | null;
          while ((match = createTableRegex.exec(content)) !== null) {
            let tName = match[1].replace(/["`]/g, "");
            if (tName.includes(".")) tName = tName.split(".").pop()!;
            const body = match[2];

            const rawCols: RawSqlCol[] = [];
            const colLines = body.split("\n");
            for (let i = 0; i < colLines.length; i++) {
              const line = colLines[i].trim();
              if (!line || line.startsWith("--") || line.startsWith("/*")) continue;

              const colMatch = /^([A-Za-z0-9_"`]+)\s+([A-Za-z0-9_()]+)/.exec(line);
              if (colMatch) {
                const cName = colMatch[1].replace(/["`]/g, "");
                if (cName.toUpperCase() === "PRIMARY" || cName.toUpperCase() === "CONSTRAINT" || cName.toUpperCase() === "FOREIGN" || cName.toUpperCase() === "KEY") continue;
                const cType = colMatch[2];
                const isPk = /PRIMARY\s+KEY/i.test(line);
                const isUnique = /UNIQUE/i.test(line);
                const isNullable = !/NOT\s+NULL/i.test(line) && !isPk;

                rawCols.push({
                  name: cName,
                  type: cType,
                  nullable: isNullable,
                  isPk,
                  isUnique: isUnique || isPk,
                  defaultVal: null,
                  line: i + 1,
                });
              }

              // Foreign key inline or constraint
              const fkMatch = /FOREIGN\s+KEY\s*\(([A-Za-z0-9_"`]+)\)\s*REFERENCES\s*([A-Za-z0-9_."`]+)\s*\(([A-Za-z0-9_"`]+)\)/i.exec(line);
              if (fkMatch) {
                let toTab = fkMatch[2].replace(/["`]/g, "");
                if (toTab.includes(".")) toTab = toTab.split(".").pop()!;
                fks.push({
                  fromTable: tName,
                  fromCol: fkMatch[1].replace(/["`]/g, ""),
                  toTable: toTab,
                  toCol: fkMatch[3].replace(/["`]/g, ""),
                  file: f.path,
                  line: i + 1,
                });
              }
            }

            if (!tablesMap.has(tName)) {
              tablesMap.set(tName, {
                name: tName,
                file: f.path,
                line: 1,
                columns: rawCols,
              });
            }
          }
        }
      } catch {
        // Skip unreadable files
      }
    }

    const tables: Table[] = Array.from(tablesMap.values()).map((t) => ({
      id: tableId(t.name),
      name: t.name,
      dbName: t.name,
      explanation: null,
      status: "verified",
      evidence: [{ file: t.file, lines: [t.line, t.line] }],
      columns: t.columns.map((c) => ({
        id: columnId(t.name, c.name),
        name: c.name,
        type: c.type,
        nullable: c.nullable,
        default: c.defaultVal,
        isPrimaryKey: c.isPk,
        isUnique: c.isUnique,
        status: "verified",
        evidence: [{ file: t.file, lines: [c.line, c.line] }],
      })),
    }));

    const validColIds = new Set(tables.flatMap((t) => t.columns.map((c) => c.id)));
    const relationships: Relationship[] = [];

    for (const fk of fks) {
      const fromId = columnId(fk.fromTable, fk.fromCol);
      const toId = columnId(fk.toTable, fk.toCol);
      if (validColIds.has(fromId) && validColIds.has(toId)) {
        relationships.push({
          id: relationshipId(fromId, toId),
          from: fromId,
          to: toId,
          cardinality: "one-to-many",
          enforcement: "db-enforced",
          status: "verified",
          evidence: [{ file: fk.file, lines: [fk.line, fk.line] }],
        });
      }
    }

    return {
      schemaVersion: "0.2.0",
      tool: { name: "schemasage", version: TOOL_VERSION },
      generatedAt: new Date().toISOString(),
      source: {
        adapter: "sql",
        adapterVersion: TOOL_VERSION,
        files: scannedPaths,
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
