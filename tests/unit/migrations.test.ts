import { describe, it, expect } from "vitest";
import { parseMigrations } from "../../src/adapters/prisma/parse-migrations.js";

describe("migration replay", () => {
  it("reads inline and table-level foreign keys and indexes", () => {
    const r = parseMigrations({
      "m/0001.sql": `CREATE TABLE "A" ("id" SERIAL PRIMARY KEY, "bId" INT REFERENCES "B"("id"));
        CREATE TABLE "B" ("id" SERIAL PRIMARY KEY);
        CREATE INDEX "A_bId_idx" ON "A"("bId");`,
    });
    expect(r.foreignKeys.map((f) => `${f.table}.${f.column}->${f.refTable}.${f.refColumn}`)).toEqual(["A.bId->B.id"]);
    expect(r.indexes.some((i) => i.table === "A" && i.columns[0] === "bId" && !i.unique)).toBe(true);
    expect(r.indexes.some((i) => i.table === "A" && i.primary)).toBe(true);
  });

  it("removes a foreign key when a later migration drops its constraint", () => {
    const r = parseMigrations({
      "m/0001.sql": `CREATE TABLE "A" ("id" INT PRIMARY KEY, "bId" INT);
        CREATE TABLE "B" ("id" INT PRIMARY KEY);
        ALTER TABLE "A" ADD CONSTRAINT "A_bId_fkey" FOREIGN KEY ("bId") REFERENCES "B"("id");`,
      "m/0002.sql": `ALTER TABLE "A" DROP CONSTRAINT "A_bId_fkey";`,
    });
    expect(r.foreignKeys).toEqual([]);
  });

  it("removes indexes and foreign keys when a table is dropped", () => {
    const r = parseMigrations({
      "m/0001.sql": `CREATE TABLE "A" ("id" INT PRIMARY KEY, "bId" INT REFERENCES "B"("id"));
        CREATE TABLE "B" ("id" INT PRIMARY KEY);`,
      "m/0002.sql": `DROP TABLE "A";`,
    });
    expect(r.foreignKeys).toEqual([]);
    expect(r.indexes.filter((i) => i.table === "A")).toEqual([]);
    expect(r.tables).toEqual(["B"]);
  });

  it("pairs composite foreign key columns and reports unparsed statements", () => {
    const r = parseMigrations({
      "m/0001.sql": `CREATE TABLE "X" ("a" INT, "b" INT, CONSTRAINT "x_fk" FOREIGN KEY ("a","b") REFERENCES "Y"("p","q"));
        CREATE TABLE "Y" ("p" INT, "q" INT);
        CREATE SCHEMA extra;`,
    });
    expect(r.foreignKeys.map((f) => `${f.column}->${f.refColumn}`)).toEqual(["a->p", "b->q"]);
    expect(r.unsupported.some((u) => u.includes("not replayed"))).toBe(true);
  });

  it("reports SQL it cannot parse instead of guessing", () => {
    const r = parseMigrations({ "m/0001.sql": "THIS IS NOT SQL ((((" });
    expect(r.foreignKeys).toEqual([]);
    expect(r.unsupported[0]).toMatch(/could not parse/);
  });
});

describe("migration preparation", () => {
  it("removes Prisma warning comments and reads E'' strings", () => {
    const r = parseMigrations({
      "m/0001.sql": `/*
  Warnings:
  - A unique constraint covering the columns \`[uid]\` on the table \`Booking\` will be added.
*/
CREATE TABLE "A" ("id" INT PRIMARY KEY, "t" TEXT NOT NULL DEFAULT E'it''s');
-- a line comment
CREATE UNIQUE INDEX "A_t_key" ON "A"("t");`,
    });
    expect(r.unsupported).toEqual([]);
    expect(r.indexes.some((i) => i.table === "A" && i.columns[0] === "t" && i.unique)).toBe(true);
  });

  it("applies add, rename and drop column to foreign keys", () => {
    const r = parseMigrations({
      "m/0001.sql": `CREATE TABLE "A" ("id" INT PRIMARY KEY, "bId" INT REFERENCES "B"("id"));
        CREATE TABLE "B" ("id" INT PRIMARY KEY);`,
      "m/0002.sql": `ALTER TABLE "A" RENAME COLUMN "bId" TO "parentId";`,
    });
    expect(r.foreignKeys.map((f) => f.column)).toEqual(["parentId"]);
    const r2 = parseMigrations({
      "m/0001.sql": `CREATE TABLE "A" ("id" INT PRIMARY KEY, "bId" INT REFERENCES "B"("id"));
        CREATE TABLE "B" ("id" INT PRIMARY KEY);`,
      "m/0002.sql": `ALTER TABLE "A" DROP COLUMN "bId";`,
    });
    expect(r2.foreignKeys).toEqual([]);
    const r3 = parseMigrations({
      "m/0001.sql": `CREATE TABLE "B" ("id" INT PRIMARY KEY);
        CREATE TABLE "A" ("id" INT PRIMARY KEY);`,
      "m/0002.sql": `ALTER TABLE "A" ADD COLUMN "bId" INT REFERENCES "B"("id");`,
    });
    expect(r3.foreignKeys.map((f) => `${f.column}->${f.refTable}`)).toEqual(["bId->B"]);
  });
});
