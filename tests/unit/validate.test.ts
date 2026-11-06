import { describe, it, expect } from "vitest";
import { validateModel } from "../../src/validation/validate.js";
import type { DatabaseModel } from "../../src/model/types.js";

const base = (): DatabaseModel => ({
  schemaVersion: "0.1.0",
  tool: { name: "schemasage", version: "test" },
  generatedAt: "2026-01-01T00:00:00Z",
  source: { adapter: "prisma", adapterVersion: "test", files: [] },
  tables: [
    {
      id: "table:A", name: "A", dbName: null, explanation: null, status: "verified",
      evidence: [{ file: "prisma/schema.prisma" }],
      columns: [{ id: "column:A.id", name: "id", type: "Int", nullable: false, default: null,
        isPrimaryKey: true, isUnique: true, status: "verified", evidence: [{ file: "prisma/schema.prisma" }] }],
    },
    {
      id: "table:B", name: "B", dbName: null, explanation: null, status: "verified",
      evidence: [{ file: "prisma/schema.prisma" }],
      columns: [{ id: "column:B.aId", name: "aId", type: "Int", nullable: false, default: null,
        isPrimaryKey: false, isUnique: false, status: "verified", evidence: [{ file: "prisma/schema.prisma" }] }],
    },
  ],
  relationships: [],
  findings: [],
  coverage: { filesScanned: [], skipped: [], unsupported: [] },
});

describe("validateModel", () => {
  it("accepts a valid model", () => {
    expect(validateModel(base())).toEqual([]);
  });

  it("flags missing evidence", () => {
    const m = base();
    m.tables[0].evidence = [];
    expect(validateModel(m).map((i) => i.rule)).toContain("evidence");
  });

  it("flags dangling relationship references", () => {
    const m = base();
    m.relationships.push({
      id: "rel:x", from: "column:B.aId", to: "column:Missing.id", cardinality: "one-to-many",
      enforcement: "orm-declared", status: "verified", evidence: [{ file: "prisma/schema.prisma" }],
    });
    expect(validateModel(m).map((i) => i.rule)).toContain("dangling-reference");
  });

  it("refuses db-enforced without migration evidence", () => {
    const m = base();
    m.relationships.push({
      id: "rel:y", from: "column:B.aId", to: "column:A.id", cardinality: "one-to-many",
      enforcement: "db-enforced", status: "verified", evidence: [{ file: "prisma/schema.prisma" }],
    });
    expect(validateModel(m).map((i) => i.rule)).toContain("enforcement");
  });

  it("accepts db-enforced with migration evidence", () => {
    const m = base();
    m.relationships.push({
      id: "rel:z", from: "column:B.aId", to: "column:A.id", cardinality: "one-to-many",
      enforcement: "db-enforced", status: "verified",
      evidence: [{ file: "prisma/schema.prisma" }, { file: "prisma/migrations/0001_init/migration.sql" }],
    });
    expect(validateModel(m)).toEqual([]);
  });

  it("flags duplicate IDs", () => {
    const m = base();
    m.tables[1].id = "table:A";
    expect(validateModel(m).map((i) => i.rule)).toContain("duplicate-id");
  });
});
