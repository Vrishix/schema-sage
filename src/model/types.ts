// Normalized model, v0. Framework-independent. See docs/architecture.md.

export type Status = "verified" | "inferred" | "unknown" | "needs-review";
export type Enforcement = "db-enforced" | "orm-declared" | "inferred";
export type Cardinality = "one-to-one" | "one-to-many" | "many-to-many";

export interface Evidence {
  file: string;            // repo-relative path
  lines?: [number, number];
}

export interface Column {
  id: string;              // "column:<Table>.<name>"
  name: string;
  type: string;
  nullable: boolean;
  default: string | null;  // never a secret value
  isPrimaryKey: boolean;
  isUnique: boolean;
  status: Status;
  evidence: Evidence[];
}

export interface Table {
  id: string;              // "table:<Name>"
  name: string;
  dbName: string | null;   // physical table name when mapped with @@map
  explanation: string | null;
  status: Status;
  evidence: Evidence[];
  columns: Column[];
}

export interface Relationship {
  id: string;              // "rel:<from>-><to>"
  from: string;            // column id
  to: string;              // column id
  cardinality: Cardinality;
  enforcement: Enforcement;
  status: Status;
  evidence: Evidence[];
}

export interface Finding {
  id: string;
  category: string;
  severity: "suggestion";  // findings are never "errors"
  explanation: string;
  recommendation: string;
  status: Status;
  evidence: Evidence[];
}

export interface ApplicationUsage {
  receivers: string[];
  usages: { table: string; operation: "read" | "write" | "delete"; method: string; file: string; line: number; fn: string | null }[];
  rawSql: { file: string; line: number; method: string }[];
  endpoints: { method: string; path: string; file: string; line: number; handler: string }[];
  flows: {
    endpoint: { method: string; path: string; file: string; line: number; handler: string };
    chain: { fn: string; file: string }[];
    operations: { table: string; operation: string; method: string; file: string; line: number }[];
    confidence: "inferred";
    ambiguousCalls: string[];
  }[];
}

export interface DatabaseModel {
  schemaVersion: string;
  tool: { name: string; version: string };
  generatedAt: string;
  source: { adapter: string; adapterVersion: string; files: string[] };
  tables: Table[];
  relationships: Relationship[];
  findings: Finding[];
  coverage: { filesScanned: string[]; skipped: { file: string; reason: string }[]; unsupported: string[] };
  application?: ApplicationUsage;
}
