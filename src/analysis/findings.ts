import type { DatabaseModel, Finding } from "../model/types.js";
import type { ParsedMigrations } from "../adapters/prisma/parse-migrations.js";

/** Structural facts per model, gathered by the adapter from Prisma's reader plus line locations. */
export interface ModelFacts {
  name: string;
  startLine: number;
  endLine: number;
  primaryKey: string[];
  indexes: { columns: string[]; unique: boolean; line: number }[];
  relations: { field: string; refModel: string; fkColumns: string[]; refColumns: string[]; line: number }[];
}

/** Database findings. Wording is always a suggestion ("consider"), never a defect. */
export function findDatabaseIssues(model: DatabaseModel, facts: ModelFacts[], migrations: ParsedMigrations): Finding[] {
  const findings: Finding[] = [];
  const schemaFile = model.source.files[0];

  for (const table of model.tables) {
    const m = facts.find((x) => `table:${x.name}` === table.id)!;
    if (!table.columns.some((c) => c.isPrimaryKey)) {
      findings.push({
        id: `finding:no-primary-key:${table.name}`,
        category: "table-without-primary-key",
        severity: "suggestion",
        explanation: `${table.name} has no primary key column in the schema.`,
        recommendation: `Consider adding an @id field to ${table.name}.`,
        status: "verified",
        evidence: [{ file: schemaFile, lines: [m.startLine, m.endLine] }],
      });
    }

    // Columns that lead an index: primary key, unique, @@index, @@unique, migration indexes.
    const indexedLeading = new Set<string>();
    for (const c of table.columns) if (c.isPrimaryKey || c.isUnique) indexedLeading.add(c.name);
    for (const i of m.indexes) if (i.columns.length) indexedLeading.add(i.columns[0]);
    if (m.primaryKey.length) indexedLeading.add(m.primaryKey[0]);
    for (const i of migrations.indexes) if (i.table === (table.dbName ?? table.name)) indexedLeading.add(i.columns[0]);

    for (const r of m.relations) {
      const fk = r.fkColumns[0];
      const col = table.columns.find((c) => c.name === fk);
      if (!col) continue;
      if (!indexedLeading.has(fk)) {
        findings.push({
          id: `finding:fk-no-index:${table.name}.${fk}`,
          category: "foreign-key-without-index",
          severity: "suggestion",
          explanation: `${table.name}.${fk} is a foreign key with no index. Lookups and deletes on ${r.refModel} may scan the whole table.`,
          recommendation: `Consider adding @@index([${fk}]) to ${table.name} in schema.prisma.`,
          status: "verified",
          evidence: [{ file: schemaFile, lines: [r.line, r.line] }],
        });
      }
      if (col.nullable) {
        findings.push({
          id: `finding:fk-nullable:${table.name}.${fk}`,
          category: "nullable-foreign-key",
          severity: "suggestion",
          explanation: `${table.name}.${fk} is a nullable foreign key. Rows may exist without a linked ${r.refModel}.`,
          recommendation: `Check whether ${table.name}.${fk} should be required.`,
          status: "verified",
          evidence: [{ file: schemaFile, lines: [r.line, r.line] }],
        });
      }
    }
  }
  return findings;
}
