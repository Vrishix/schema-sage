import { promises as fs } from "node:fs";
import path from "node:path";
import type { DatabaseAdapter } from "../types.js";
import type { ScannedFile } from "../../scanner/scan.js";
import type { DatabaseModel, Table, Column, Relationship, Finding } from "../../model/types.js";
import { tableId, columnId, relationshipId } from "../../model/ids.js";
import { TOOL_VERSION } from "../../version.js";

interface RawCol {
  name: string;
  type: string;
  nullable: boolean;
  pk: boolean;
  unique: boolean;
  foreignKey?: { refTable: string; refColumn: string };
  line: number;
}

interface RawRel {
  name: string;
  targetModel: string;
  backPopulates?: string;
  line: number;
}

interface RawTable {
  className: string;
  tableName: string;
  file: string;
  startLine: number;
  columns: RawCol[];
  relationships: RawRel[];
}

export function parsePythonModels(fileContent: string, filePath: string): RawTable[] {
  const lines = fileContent.split(/\r?\n/);
  const tables: RawTable[] = [];

  let currentClass: string | null = null;
  let currentTable: string | null = null;
  let classStartLine = 1;
  let cols: RawCol[] = [];
  let rels: RawRel[] = [];

  const flush = () => {
    if (currentClass && currentTable) {
      tables.push({
        className: currentClass,
        tableName: currentTable,
        file: filePath,
        startLine: classStartLine,
        columns: cols,
        relationships: rels,
      });
    }
    currentClass = null;
    currentTable = null;
    cols = [];
    rels = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const lineNum = i + 1;
    const line = lines[i];

    // Detect class ClassName(Base):
    const classMatch = /^\s*class\s+([A-Za-z0-9_]+)\s*\([^)]*Base[^)]*\):/.exec(line);
    if (classMatch) {
      flush();
      currentClass = classMatch[1];
      classStartLine = lineNum;
      continue;
    }

    if (!currentClass) continue;

    // Detect __tablename__ = "..."
    const tableMatch = /^\s*__tablename__\s*=\s*["']([^"']+)["']/.exec(line);
    if (tableMatch) {
      currentTable = tableMatch[1];
      continue;
    }

    // Detect Column(...) or mapped_column(...)
    const colMatch = /^\s*([A-Za-z0-9_]+)\s*=\s*(?:mapped_column|Column)\s*\((.*)/.exec(line);
    if (colMatch) {
      const colName = colMatch[1];
      let colDef = colMatch[2];
      let parenCount = 1 + (colDef.match(/\(/g) || []).length - (colDef.match(/\)/g) || []).length;
      let k = i;
      while (parenCount > 0 && k + 1 < lines.length) {
        k++;
        colDef += " " + lines[k].trim();
        parenCount += (lines[k].match(/\(/g) || []).length - (lines[k].match(/\)/g) || []).length;
      }

      const pk = /primary_key\s*=\s*True/i.test(colDef);
      const unique = /unique\s*=\s*True/i.test(colDef);
      const nullable = /nullable\s*=\s*True/i.test(colDef) || (!/nullable\s*=\s*False/i.test(colDef) && !pk);

      // Extract SQL type: Column(Integer, ...), Column(String(50), ...)
      const typeMatch = /^[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)?(?:\([^)]*\))?/.exec(colDef.trim());
      let colType = typeMatch ? typeMatch[0] : "String";
      if (colType.startsWith("Enum(")) colType = "Enum";

      // ForeignKey("table.column" or "users.id")
      let foreignKey: { refTable: string; refColumn: string } | undefined;
      const fkMatch = /ForeignKey\s*\(\s*["']([^"']+)["']/.exec(colDef);
      if (fkMatch) {
        const parts = fkMatch[1].split(".");
        if (parts.length >= 2) {
          foreignKey = { refTable: parts[0], refColumn: parts[1] };
        }
      }

      cols.push({
        name: colName,
        type: colType,
        nullable,
        pk,
        unique,
        foreignKey,
        line: lineNum,
      });
      continue;
    }

    // Detect relationship("ModelName", ...)
    const relMatch = /^\s*([A-Za-z0-9_]+)\s*=\s*relationship\s*\(\s*["']([^"']+)["']/.exec(line);
    if (relMatch) {
      const relName = relMatch[1];
      const target = relMatch[2];
      const backPopMatch = /back_populates\s*=\s*["']([^"']+)["']/.exec(line);
      rels.push({
        name: relName,
        targetModel: target,
        backPopulates: backPopMatch ? backPopMatch[1] : undefined,
        line: lineNum,
      });
    }
  }

  flush();
  return tables;
}

export const sqlalchemyAdapter: DatabaseAdapter = {
  name: "sqlalchemy",
  supportedFeatures: [
    "SQLAlchemy Base models",
    "Column / mapped_column",
    "primary_key",
    "unique constraints",
    "nullable",
    "ForeignKey (table.column)",
    "relationship() associations",
  ],

  detect: (files) => {
    return files.some(
      (f) =>
        f.path.endsWith(".py") &&
        (f.path.includes("models/") || f.path.includes("models.py") || f.path.includes("alembic"))
    );
  },

  async extract(repoRoot: string, files: ScannedFile[]): Promise<DatabaseModel> {
    const pythonFiles = files.filter(
      (f) =>
        f.path.endsWith(".py") &&
        (f.path.includes("models") || f.path.includes("app/models") || f.path.includes("model"))
    );

    const allParsed: RawTable[] = [];
    for (const pf of pythonFiles) {
      try {
        const text = await fs.readFile(path.join(repoRoot, pf.path), "utf8");
        if (text.includes("__tablename__") && (text.includes("Column(") || text.includes("mapped_column("))) {
          const parsed = parsePythonModels(text, pf.path);
          allParsed.push(...parsed);
        }
      } catch {
        // Skip unreadable files
      }
    }

    const tableByClass = new Map<string, RawTable>();
    const tableByName = new Map<string, RawTable>();
    for (const t of allParsed) {
      tableByClass.set(t.className, t);
      tableByName.set(t.tableName, t);
    }

    const tables: Table[] = [];
    const relationships: Relationship[] = [];
    const findings: Finding[] = [];

    for (const raw of allParsed) {
      const tid = tableId(raw.tableName);
      const cols: Column[] = raw.columns.map((c) => ({
        id: columnId(tid, c.name),
        name: c.name,
        type: c.type,
        nullable: c.nullable,
        default: null,
        isPrimaryKey: c.pk,
        isUnique: c.unique,
        status: "verified",
        evidence: [{ file: raw.file, lines: [c.line, c.line] }],
      }));

      tables.push({
        id: tid,
        name: raw.tableName,
        dbName: raw.tableName,
        explanation: null,
        status: "verified",
        evidence: [{ file: raw.file, lines: [raw.startLine, raw.startLine] }],
        columns: cols,
      });

      // Track FK relationships
      for (const col of raw.columns) {
        if (col.foreignKey) {
          const fromColId = columnId(tid, col.name);
          const toTid = tableId(col.foreignKey.refTable);
          const toColId = columnId(toTid, col.foreignKey.refColumn);
          const relId = relationshipId(fromColId, toColId);

          relationships.push({
            id: relId,
            from: fromColId,
            to: toColId,
            cardinality: col.unique ? "one-to-one" : "one-to-many",
            enforcement: "orm-declared",
            status: "verified",
            evidence: [{ file: raw.file, lines: [col.line, col.line] }],
          });
        }
      }

      // Track ORM relationship associations
      for (const rel of raw.relationships) {
        const target = tableByClass.get(rel.targetModel);
        if (target) {
          const fromColId = columnId(tid, "id");
          const toColId = columnId(tableId(target.tableName), "id");
          const relId = relationshipId(fromColId, toColId);

          if (!relationships.some((r) => r.id === relId)) {
            relationships.push({
              id: relId,
              from: fromColId,
              to: toColId,
              cardinality: "one-to-many",
              enforcement: "orm-declared",
              status: "verified",
              evidence: [{ file: raw.file, lines: [rel.line, rel.line] }],
            });
          }
        }
      }

      // Check for tables without primary keys
      if (!raw.columns.some((c) => c.pk)) {
        findings.push({
          id: `finding:no-primary-key:${raw.tableName}`,
          category: "table-without-primary-key",
          severity: "suggestion",
          explanation: `${raw.tableName} has no primary key column defined.`,
          recommendation: `Consider adding primary_key=True to ${raw.tableName}.`,
          status: "verified",
          evidence: [{ file: raw.file, lines: [raw.startLine, raw.startLine] }],
        });
      }
    }

    return {
      schemaVersion: "0",
      tool: { name: "schemasage", version: TOOL_VERSION },
      generatedAt: new Date().toISOString(),
      source: {
        adapter: "sqlalchemy",
        adapterVersion: TOOL_VERSION,
        files: pythonFiles.map((f) => f.path),
      },
      tables,
      relationships,
      findings,
      coverage: {
        filesScanned: pythonFiles.map((f) => f.path),
        unsupported: [],
        skipped: [],
      },
    };
  },
};
