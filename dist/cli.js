#!/usr/bin/env node
var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// src/model/ids.ts
var tableId, columnId, relationshipId;
var init_ids = __esm({
  "src/model/ids.ts"() {
    "use strict";
    tableId = (name) => `table:${name}`;
    columnId = (table, column) => `column:${table}.${column}`;
    relationshipId = (from, to) => `rel:${from}->${to}`;
  }
});

// src/version.ts
var TOOL_VERSION;
var init_version = __esm({
  "src/version.ts"() {
    "use strict";
    TOOL_VERSION = "0.1.0-alpha.10";
  }
});

// src/introspect/postgres.ts
var postgres_exports = {};
__export(postgres_exports, {
  introspectPostgres: () => introspectPostgres
});
async function introspectPostgres(connectionUrl) {
  const pg = await import("pg");
  const { Client } = pg.default || pg;
  const client = new Client({ connectionString: connectionUrl });
  await client.connect();
  try {
    const tablesRes = await client.query(`
      SELECT table_schema, table_name
      FROM information_schema.tables
      WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
        AND table_type = 'BASE TABLE'
      ORDER BY table_name;
    `);
    const columnsRes = await client.query(`
      SELECT 
        table_name,
        column_name,
        data_type,
        udt_name,
        is_nullable,
        column_default
      FROM information_schema.columns
      WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
      ORDER BY table_name, ordinal_position;
    `);
    const pkRes = await client.query(`
      SELECT tc.table_name, kcu.column_name
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name
        AND tc.table_schema = kcu.table_schema
      WHERE tc.constraint_type = 'PRIMARY KEY'
        AND tc.table_schema NOT IN ('pg_catalog', 'information_schema');
    `);
    const pks = new Set(pkRes.rows.map((r) => `${r.table_name}.${r.column_name}`));
    const uqRes = await client.query(`
      SELECT tc.table_name, kcu.column_name
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name
        AND tc.table_schema = kcu.table_schema
      WHERE tc.constraint_type = 'UNIQUE'
        AND tc.table_schema NOT IN ('pg_catalog', 'information_schema');
    `);
    const uqs = new Set(uqRes.rows.map((r) => `${r.table_name}.${r.column_name}`));
    const fkRes = await client.query(`
      SELECT
        tc.table_name AS from_table,
        kcu.column_name AS from_column,
        ccu.table_name AS to_table,
        ccu.column_name AS to_column
      FROM information_schema.table_constraints AS tc
      JOIN information_schema.key_column_usage AS kcu
        ON tc.constraint_name = kcu.constraint_name
        AND tc.table_schema = kcu.table_schema
      JOIN information_schema.constraint_column_usage AS ccu
        ON ccu.constraint_name = tc.constraint_name
        AND ccu.table_schema = tc.table_schema
      WHERE tc.constraint_type = 'FOREIGN KEY'
        AND tc.table_schema NOT IN ('pg_catalog', 'information_schema');
    `);
    const colMapByTable = /* @__PURE__ */ new Map();
    for (const r of columnsRes.rows) {
      const isPk = pks.has(`${r.table_name}.${r.column_name}`);
      const isUq = uqs.has(`${r.table_name}.${r.column_name}`);
      const col = {
        id: columnId(r.table_name, r.column_name),
        name: r.column_name,
        type: r.data_type === "USER-DEFINED" ? r.udt_name : r.data_type,
        nullable: r.is_nullable === "YES",
        default: r.column_default ? String(r.column_default).replace(/'/g, "") : null,
        isPrimaryKey: isPk,
        isUnique: isUq || isPk,
        status: "verified",
        evidence: [{ file: "database:postgres", lines: [1, 1] }]
      };
      if (!colMapByTable.has(r.table_name))
        colMapByTable.set(r.table_name, []);
      colMapByTable.get(r.table_name).push(col);
    }
    const tables = tablesRes.rows.map((r) => ({
      id: tableId(r.table_name),
      name: r.table_name,
      dbName: r.table_name,
      explanation: null,
      status: "verified",
      evidence: [{ file: "database:postgres", lines: [1, 1] }],
      columns: colMapByTable.get(r.table_name) ?? []
    }));
    const relationships = fkRes.rows.map((r) => ({
      id: relationshipId(columnId(r.from_table, r.from_column), columnId(r.to_table, r.to_column)),
      from: columnId(r.from_table, r.from_column),
      to: columnId(r.to_table, r.to_column),
      cardinality: "one-to-many",
      enforcement: "db-enforced",
      status: "verified",
      evidence: [{ file: "database:postgres.sql", lines: [1, 1] }]
    }));
    return {
      schemaVersion: "0.2.0",
      tool: { name: "schemasage", version: TOOL_VERSION },
      generatedAt: (/* @__PURE__ */ new Date()).toISOString(),
      source: {
        adapter: "postgres-direct",
        adapterVersion: TOOL_VERSION,
        files: ["postgres://<connection>"]
      },
      tables,
      relationships,
      findings: [],
      coverage: {
        filesScanned: ["postgres://<connection>"],
        skipped: [],
        unsupported: []
      }
    };
  } finally {
    await client.end();
  }
}
var init_postgres = __esm({
  "src/introspect/postgres.ts"() {
    "use strict";
    init_ids();
    init_version();
  }
});

// src/introspect/mongo.ts
var mongo_exports = {};
__export(mongo_exports, {
  introspectMongo: () => introspectMongo
});
function inferBsonType(val) {
  if (val === null || val === void 0)
    return "mixed";
  if (Array.isArray(val))
    return "array";
  if (val instanceof Date)
    return "date";
  if (typeof val === "object") {
    if (val._bsontype === "ObjectId")
      return "ObjectId";
    return "object";
  }
  return typeof val;
}
async function introspectMongo(connectionUrl) {
  const { MongoClient } = await import("mongodb");
  const client = new MongoClient(connectionUrl);
  await client.connect();
  try {
    const db = client.db();
    const collections = await db.listCollections().toArray();
    const tables = [];
    const relationships = [];
    const knownCollections = new Set(collections.map((c) => c.name));
    for (const collInfo of collections) {
      if (collInfo.name.startsWith("system."))
        continue;
      const collName = collInfo.name;
      const coll = db.collection(collName);
      const sampleDocs = await coll.aggregate([{ $sample: { size: 50 } }]).toArray();
      const fieldTypes = /* @__PURE__ */ new Map();
      for (const doc of sampleDocs) {
        for (const [key, val] of Object.entries(doc)) {
          if (!fieldTypes.has(key))
            fieldTypes.set(key, /* @__PURE__ */ new Set());
          fieldTypes.get(key).add(inferBsonType(val));
        }
      }
      if (!fieldTypes.has("_id")) {
        fieldTypes.set("_id", /* @__PURE__ */ new Set(["ObjectId"]));
      }
      const columns = [];
      for (const [fieldName, types] of fieldTypes.entries()) {
        const typeStr = Array.from(types).join(" | ");
        const isPk = fieldName === "_id";
        columns.push({
          id: columnId(collName, fieldName),
          name: fieldName,
          type: typeStr,
          nullable: !isPk,
          default: null,
          isPrimaryKey: isPk,
          isUnique: isPk,
          status: "inferred",
          evidence: [{ file: `mongodb:${collName}`, lines: [1, 1] }]
        });
        if (!isPk && fieldName.endsWith("Id")) {
          const baseName = fieldName.slice(0, -2);
          const candidates = [baseName, baseName + "s", baseName.toLowerCase(), baseName.toLowerCase() + "s"];
          for (const targetColl of candidates) {
            if (knownCollections.has(targetColl) && targetColl !== collName) {
              relationships.push({
                id: relationshipId(columnId(collName, fieldName), columnId(targetColl, "_id")),
                from: columnId(collName, fieldName),
                to: columnId(targetColl, "_id"),
                cardinality: "one-to-many",
                enforcement: "inferred",
                status: "inferred",
                evidence: [{ file: `mongodb:${collName}`, lines: [1, 1] }]
              });
              break;
            }
          }
        }
      }
      tables.push({
        id: tableId(collName),
        name: collName,
        dbName: collName,
        explanation: `MongoDB Collection (${sampleDocs.length} sampled documents)`,
        status: "inferred",
        evidence: [{ file: `mongodb:${collName}`, lines: [1, 1] }],
        columns
      });
    }
    return {
      schemaVersion: "0.2.0",
      tool: { name: "schemasage", version: TOOL_VERSION },
      generatedAt: (/* @__PURE__ */ new Date()).toISOString(),
      source: {
        adapter: "mongodb-direct",
        adapterVersion: TOOL_VERSION,
        files: ["mongodb://<connection>"]
      },
      tables,
      relationships,
      findings: [],
      coverage: {
        filesScanned: ["mongodb://<connection>"],
        skipped: [],
        unsupported: []
      }
    };
  } finally {
    await client.close();
  }
}
var init_mongo = __esm({
  "src/introspect/mongo.ts"() {
    "use strict";
    init_ids();
    init_version();
  }
});

// src/pipeline.ts
import path7 from "node:path";

// src/scanner/scan.ts
import { promises as fs } from "node:fs";
import path from "node:path";

// src/scanner/ignore.ts
var ALWAYS_IGNORED_DIRS = /* @__PURE__ */ new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  ".next",
  "coverage",
  "artifacts",
  ".venv",
  "__pycache__"
]);
var ALWAYS_IGNORED_FILES = /(^|\/)\.env(\..*)?$/;

// src/scanner/scan.ts
async function scanRepo(repoRoot) {
  const files = [];
  const skipped = [];
  async function walk(dir) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      const rel = path.relative(repoRoot, full).split(path.sep).join("/");
      if (entry.isDirectory()) {
        if (ALWAYS_IGNORED_DIRS.has(entry.name)) {
          skipped.push({ file: rel + "/", reason: "ignored directory" });
          continue;
        }
        await walk(full);
      } else if (entry.isFile()) {
        if (ALWAYS_IGNORED_FILES.test(rel)) {
          skipped.push({ file: rel, reason: "environment file (values never read)" });
          continue;
        }
        const stat = await fs.stat(full);
        files.push({ path: rel, size: stat.size });
      }
    }
  }
  await walk(repoRoot);
  files.sort((a, b) => a.path.localeCompare(b.path));
  return { files, skipped };
}

// src/adapters/prisma/index.ts
import { promises as fs2 } from "node:fs";
import path2 from "node:path";
import prismaInternals from "@prisma/internals";

// src/adapters/prisma/parse-migrations.ts
import { parse } from "pgsql-ast-parser";
var nm = (x) => typeof x === "string" ? x : x?.name;
function prepareSql(sql) {
  let out = "";
  let i = 0;
  while (i < sql.length) {
    const c = sql[i];
    const next = sql[i + 1];
    if (c === "/" && next === "*") {
      const end = sql.indexOf("*/", i + 2);
      i = end < 0 ? sql.length : end + 2;
      out += " ";
    } else if (c === "-" && next === "-") {
      const end = sql.indexOf("\n", i);
      i = end < 0 ? sql.length : end;
    } else if (c === "'" || c === '"') {
      const end = findClose(sql, i, c);
      out += sql.slice(i, end);
      i = end;
    } else if ((c === "E" || c === "e") && next === "'" && !/[A-Za-z0-9_]/.test(sql[i - 1] ?? " ")) {
      const end = findClose(sql, i + 1, "'");
      out += sql.slice(i + 1, end);
      i = end;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}
function findClose(sql, start, quote) {
  let j = start + 1;
  while (j < sql.length) {
    if (sql[j] === quote) {
      if (sql[j + 1] === quote) {
        j += 2;
        continue;
      }
      return j + 1;
    }
    j++;
  }
  return sql.length;
}
var NON_STRUCTURAL = /* @__PURE__ */ new Set(["insert", "update", "delete", "do", "create enum", "alter enum", "drop type", "create function", "create view", "create extension", "comment", "alter index", "create sequence", "alter sequence", "drop function", "drop view", "grant", "revoke"]);
function parseMigrations(sqlByFile) {
  const foreignKeys = [];
  const indexes = [];
  const tables = /* @__PURE__ */ new Set();
  const unsupported = [];
  const addFk = (table, localCols, refTable, refCols, constraintName, file) => {
    localCols.forEach((col, i) => foreignKeys.push({ table, column: col, refTable, refColumn: refCols[i] ?? refCols[0], constraintName, file }));
  };
  const addUnique = (table, cols, name, file, unique = true, primary = false) => {
    indexes.push({ table, columns: cols, unique, primary, name, file });
  };
  const removeColumn = (table, col) => {
    for (let i = foreignKeys.length - 1; i >= 0; i--)
      if (foreignKeys[i].table === table && foreignKeys[i].column === col)
        foreignKeys.splice(i, 1);
    for (let i = indexes.length - 1; i >= 0; i--)
      if (indexes[i].table === table && indexes[i].columns.includes(col))
        indexes.splice(i, 1);
  };
  const renameColumn = (table, from, to) => {
    for (const f of foreignKeys)
      if (f.table === table && f.column === from)
        f.column = to;
    for (const i of indexes)
      if (i.table === table)
        i.columns = i.columns.map((c) => c === from ? to : c);
  };
  for (const file of Object.keys(sqlByFile).sort()) {
    let statements;
    try {
      statements = parse(prepareSql(sqlByFile[file]));
    } catch (err) {
      unsupported.push(`${file}: could not parse SQL (${err.message.split("\n")[0]})`);
      continue;
    }
    for (const s of statements) {
      switch (s.type) {
        case "create table": {
          const table = nm(s.name);
          tables.add(table);
          for (const col of s.columns ?? []) {
            if (col.kind !== "column")
              continue;
            for (const c of col.constraints ?? []) {
              if (c.type === "primary key")
                addUnique(table, [nm(col.name)], null, file, true, true);
              if (c.type === "unique")
                addUnique(table, [nm(col.name)], null, file);
              if (c.type === "reference")
                addFk(table, [nm(col.name)], nm(c.foreignTable), (c.foreignColumns ?? []).map(nm), null, file);
            }
          }
          for (const c of s.constraints ?? []) {
            const cname = c.constraintName ? nm(c.constraintName) : null;
            if (c.type === "foreign key")
              addFk(table, (c.localColumns ?? []).map(nm), nm(c.foreignTable), (c.foreignColumns ?? []).map(nm), cname, file);
            else if (c.type === "unique" || c.type === "primary key")
              addUnique(table, (c.columns ?? []).map(nm), cname, file, true, c.type === "primary key");
          }
          break;
        }
        case "create index": {
          const exprs = s.expressions ?? [];
          const cols = exprs.map((e) => e.expression?.type === "ref" ? e.expression.name : null);
          if (cols.includes(null))
            unsupported.push(`${file}: index ${nm(s.indexName)} uses an expression; not analysed`);
          else
            addUnique(nm(s.table), cols, nm(s.indexName), file, Boolean(s.unique), false);
          break;
        }
        case "alter table": {
          const table = nm(s.table);
          for (const ch of s.changes ?? []) {
            if (ch.type === "add constraint") {
              const c = ch.constraint;
              const cname = c.constraintName ? nm(c.constraintName) : null;
              if (c.type === "foreign key")
                addFk(table, (c.localColumns ?? []).map(nm), nm(c.foreignTable), (c.foreignColumns ?? []).map(nm), cname, file);
              else if (c.type === "unique" || c.type === "primary key")
                addUnique(table, (c.columns ?? []).map(nm), cname, file, true, c.type === "primary key");
              else
                unsupported.push(`${file}: constraint type "${c.type}" not analysed`);
            } else if (ch.type === "drop constraint") {
              const cname = nm(ch.constraint);
              for (let i = foreignKeys.length - 1; i >= 0; i--)
                if (foreignKeys[i].table === table && foreignKeys[i].constraintName === cname)
                  foreignKeys.splice(i, 1);
              for (let i = indexes.length - 1; i >= 0; i--)
                if (indexes[i].table === table && indexes[i].name === cname)
                  indexes.splice(i, 1);
            } else if (ch.type === "add column") {
              const col = nm(ch.column.name);
              for (const c of ch.column.constraints ?? []) {
                if (c.type === "primary key" || c.type === "unique")
                  addUnique(table, [col], null, file, true, c.type === "primary key");
                if (c.type === "reference")
                  addFk(table, [col], nm(c.foreignTable), (c.foreignColumns ?? []).map(nm), null, file);
              }
            } else if (ch.type === "drop column") {
              const col = nm(ch.column);
              removeColumn(table, col);
            } else if (ch.type === "rename column") {
              const from = nm(ch.oldName ?? ch.from ?? ch.column);
              const to = nm(ch.newName ?? ch.to);
              renameColumn(table, from, to);
            } else if (ch.type === "alter column") {
            } else {
              unsupported.push(`${file}: ALTER TABLE ${ch.type} not replayed`);
            }
          }
          break;
        }
        case "drop index": {
          for (const n of (s.names ?? []).map(nm)) {
            for (let i = indexes.length - 1; i >= 0; i--)
              if (indexes[i].name === n)
                indexes.splice(i, 1);
          }
          break;
        }
        case "drop table": {
          for (const t of (s.names ?? []).map(nm)) {
            tables.delete(t);
            for (let i = foreignKeys.length - 1; i >= 0; i--)
              if (foreignKeys[i].table === t || foreignKeys[i].refTable === t)
                foreignKeys.splice(i, 1);
            for (let i = indexes.length - 1; i >= 0; i--)
              if (indexes[i].table === t)
                indexes.splice(i, 1);
          }
          break;
        }
        default:
          if (!NON_STRUCTURAL.has(s.type))
            unsupported.push(`${file}: statement "${s.type}" not replayed`);
      }
    }
  }
  return { foreignKeys, indexes, tables: [...tables], unsupported };
}

// src/adapters/prisma/locate.ts
function locateModels(text) {
  const lines = text.split(/\r?\n/);
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /^\s*model\s+(\w+)\s*\{/.exec(lines[i]);
    if (!m)
      continue;
    const fieldLines = /* @__PURE__ */ new Map();
    let j = i + 1;
    while (j < lines.length && !/^\s*\}/.test(lines[j])) {
      const f = /^\s*(\w+)\s+[\w\[\]?]+/.exec(lines[j]);
      if (f && !lines[j].trim().startsWith("@@") && !lines[j].trim().startsWith("//"))
        fieldLines.set(f[1], j + 1);
      j++;
    }
    out.push({ name: m[1], startLine: i + 1, endLine: j + 1, fieldLines });
    i = j;
  }
  return out;
}

// src/adapters/prisma/facts.ts
import { getSchema } from "@mrleebo/prisma-ast";
function readBlockIndexes(schemaText) {
  const ast = getSchema(schemaText);
  const out = /* @__PURE__ */ new Map();
  for (const node of ast.list ?? []) {
    if (node.type !== "model")
      continue;
    const list = [];
    for (const p of node.properties ?? []) {
      if (p.type !== "attribute" || p.name !== "index" && p.name !== "unique")
        continue;
      const arr = p.args?.[0]?.value?.args ?? [];
      const cols = arr.map((a) => typeof a === "string" ? a : a?.name ?? String(a));
      list.push({ columns: cols, unique: p.name === "unique" });
    }
    out.set(node.name, list);
  }
  return out;
}

// src/adapters/prisma/index.ts
init_ids();

// src/analysis/findings.ts
function findDatabaseIssues(model, facts, migrations) {
  const findings = [];
  const schemaFile = model.source.files[0];
  for (const table of model.tables) {
    const m = facts.find((x) => `table:${x.name}` === table.id);
    if (!table.columns.some((c) => c.isPrimaryKey)) {
      findings.push({
        id: `finding:no-primary-key:${table.name}`,
        category: "table-without-primary-key",
        severity: "suggestion",
        explanation: `${table.name} has no primary key column in the schema.`,
        recommendation: `Consider adding an @id field to ${table.name}.`,
        status: "verified",
        evidence: [{ file: schemaFile, lines: [m.startLine, m.endLine] }]
      });
    }
    const indexedLeading = /* @__PURE__ */ new Set();
    for (const c of table.columns)
      if (c.isPrimaryKey || c.isUnique)
        indexedLeading.add(c.name);
    for (const i of m.indexes)
      if (i.columns.length)
        indexedLeading.add(i.columns[0]);
    if (m.primaryKey.length)
      indexedLeading.add(m.primaryKey[0]);
    for (const i of migrations.indexes)
      if (i.table === (table.dbName ?? table.name))
        indexedLeading.add(i.columns[0]);
    for (const r of m.relations) {
      const fk = r.fkColumns[0];
      const col = table.columns.find((c) => c.name === fk);
      if (!col)
        continue;
      if (!indexedLeading.has(fk)) {
        findings.push({
          id: `finding:fk-no-index:${table.name}.${fk}`,
          category: "foreign-key-without-index",
          severity: "suggestion",
          explanation: `${table.name}.${fk} is a foreign key with no index. Lookups and deletes on ${r.refModel} may scan the whole table.`,
          recommendation: `Consider adding @@index([${fk}]) to ${table.name} in schema.prisma.`,
          status: "verified",
          evidence: [{ file: schemaFile, lines: [r.line, r.line] }]
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
          evidence: [{ file: schemaFile, lines: [r.line, r.line] }]
        });
      }
    }
  }
  return findings;
}

// src/adapters/prisma/index.ts
init_version();
var { getDMMF } = prismaInternals;
var SCHEMA_SUFFIX = "schema.prisma";
var URL_LINE = /^\s*(url|directUrl|shadowDatabaseUrl)\s*=.*$/gm;
function cleanError(err) {
  const msg = err instanceof Error ? err.message : String(err);
  return new Error("Prisma could not read schema.prisma:\n" + msg.replace(/\x1b\[[0-9;]*m/g, "").trim());
}
async function readDmmf(schemaText) {
  try {
    return { dmmf: await getDMMF({ datamodel: schemaText }), urlsIgnored: false };
  } catch (firstErr) {
    const stripped = schemaText.replace(URL_LINE, "");
    if (stripped === schemaText)
      throw cleanError(firstErr);
    try {
      return { dmmf: await getDMMF({ datamodel: stripped }), urlsIgnored: true };
    } catch {
      throw cleanError(firstErr);
    }
  }
}
var prismaAdapter = {
  name: "prisma",
  supportedFeatures: [
    "models",
    "scalar and enum fields",
    "@id",
    "@unique",
    "@default",
    "@relation(fields, references)",
    "composite @@id and foreign keys",
    "@@unique",
    "@@index",
    "@@map (physical table name shown)",
    "migration FOREIGN KEY",
    "migration CREATE INDEX"
  ],
  detect: (files) => files.some((f) => f.path.endsWith(SCHEMA_SUFFIX)),
  async extract(repoRoot, files) {
    const schemaFile = files.find((f) => f.path.endsWith(SCHEMA_SUFFIX));
    const schemaText = await fs2.readFile(path2.join(repoRoot, schemaFile.path), "utf8");
    if (/provider\s*=\s*"mongodb"/.test(schemaText)) {
      throw new Error("MongoDB schemas are not supported yet (only relational providers).");
    }
    const { dmmf, urlsIgnored } = await readDmmf(schemaText);
    const relationModePrisma = /relationMode\s*=\s*"prisma"/.test(schemaText);
    const blockIndexes = readBlockIndexes(schemaText);
    const locations = new Map(locateModels(schemaText).map((l) => [l.name, l]));
    const sqlFiles = files.filter((f) => f.path.endsWith(".sql") && f.path.includes("migrations/"));
    const sqlByFile = {};
    for (const f of sqlFiles)
      sqlByFile[f.path] = await fs2.readFile(path2.join(repoRoot, f.path), "utf8");
    const migrations = parseMigrations(sqlByFile);
    const sf = schemaFile.path;
    const ev = (lines) => ({ file: sf, lines });
    const tables = [];
    const relationships = [];
    const facts = [];
    const unsupported = [];
    const physicalOf = new Map(dmmf.datamodel.models.map((m) => [m.name, m.dbName ?? m.name]));
    const phys = (modelName) => physicalOf.get(modelName) ?? modelName;
    for (const model2 of dmmf.datamodel.models) {
      const loc = locations.get(model2.name);
      const startLine = loc?.startLine ?? 1;
      const endLine = loc?.endLine ?? 1;
      const lineOf = (field) => loc?.fieldLines.get(field) ?? startLine;
      const pkFields = model2.primaryKey?.fields ?? [];
      const uniqueGroups = (model2.uniqueIndexes ?? []).map((u) => u.fields);
      const blocks = blockIndexes.get(model2.name) ?? [];
      const migUniqueSingle = (col) => migrations.indexes.some((i) => i.unique && !i.primary && i.table === phys(model2.name) && i.columns.length === 1 && i.columns[0] === col);
      const scalarFields = model2.fields.filter((f) => f.kind === "scalar" || f.kind === "enum");
      const columns = scalarFields.map((f) => {
        const isPk = Boolean(f.isId) || pkFields.length === 1 && pkFields[0] === f.name || pkFields.includes(f.name);
        const isUnique = Boolean(f.isUnique) || uniqueGroups.some((g) => g.length === 1 && g[0] === f.name) || blocks.some((b) => b.unique && b.columns.length === 1 && b.columns[0] === f.name) || migUniqueSingle(f.name);
        const def = f.default;
        const defaultValue = def === void 0 || def === null ? null : typeof def === "object" ? `${def.name ?? "function"}()` : String(def);
        return {
          id: columnId(model2.name, f.name),
          name: f.name,
          type: f.isList ? `${f.type}[]` : f.type,
          nullable: !f.isRequired,
          default: defaultValue,
          isPrimaryKey: isPk,
          isUnique,
          status: "verified",
          evidence: [ev([lineOf(f.name), lineOf(f.name)])]
        };
      });
      tables.push({ id: tableId(model2.name), name: model2.name, dbName: model2.dbName ?? null, explanation: null, status: "verified", evidence: [ev([startLine, endLine])], columns });
      const relations = [];
      for (const f of model2.fields.filter((x) => x.kind === "object" && x.relationFromFields?.length)) {
        const fkCols = f.relationFromFields;
        const refCols = f.relationToFields;
        const fkName = fkCols[0];
        relations.push({ field: f.name, refModel: f.type, fkColumns: fkCols, refColumns: refCols, line: lineOf(f.name) });
        if (fkCols.length > 1)
          unsupported.push(`${model2.name}.${f.name}: composite foreign key; relationship drawn from ${fkName} only`);
        const fkUnique = columns.find((c) => c.name === fkName)?.isUnique ?? false;
        const mig = migrations.foreignKeys.find((x) => x.table === phys(model2.name) && x.column === fkName && x.refTable === phys(f.type));
        const evidence = [ev([lineOf(f.name), lineOf(f.name)])];
        if (mig)
          evidence.push({ file: mig.file });
        const from = columnId(model2.name, fkName);
        const to = columnId(f.type, refCols[0]);
        relationships.push({
          id: relationshipId(from, to),
          from,
          to,
          cardinality: fkUnique ? "one-to-one" : "one-to-many",
          enforcement: mig ? "db-enforced" : "orm-declared",
          status: "verified",
          evidence
        });
      }
      const indexes = blocks.map((b) => ({ columns: b.columns, unique: b.unique, line: startLine }));
      facts.push({ name: model2.name, startLine, endLine, primaryKey: pkFields, indexes, relations });
    }
    const model = {
      schemaVersion: "0.1.0",
      tool: { name: "schemasage", version: TOOL_VERSION },
      generatedAt: (/* @__PURE__ */ new Date()).toISOString(),
      source: { adapter: "prisma", adapterVersion: "getDMMF+prisma-ast", files: [sf, ...sqlFiles.map((f) => f.path)] },
      tables,
      relationships,
      findings: [],
      coverage: { filesScanned: [sf, ...sqlFiles.map((f) => f.path)], skipped: [], unsupported: [...unsupported, ...migrations.unsupported] }
    };
    if (relationModePrisma) {
      for (const r of model.relationships)
        r.enforcement = "orm-declared";
      model.coverage.unsupported.push('relationMode = "prisma": foreign keys are emulated by Prisma, not created in the database. Relationships are shown as ORM-declared.');
    }
    if (urlsIgnored)
      model.coverage.unsupported.push("datasource connection URL lines were ignored for analysis (never read or used)");
    model.findings = findDatabaseIssues(model, facts, migrations);
    return model;
  }
};

// src/adapters/sqlalchemy/index.ts
init_ids();
init_version();
import { promises as fs3 } from "node:fs";
import path3 from "node:path";
function parsePythonModels(fileContent, filePath) {
  const lines = fileContent.split(/\r?\n/);
  const tables = [];
  let currentClass = null;
  let currentTable = null;
  let classStartLine = 1;
  let cols = [];
  let rels = [];
  const flush = () => {
    if (currentClass && currentTable) {
      tables.push({
        className: currentClass,
        tableName: currentTable,
        file: filePath,
        startLine: classStartLine,
        columns: cols,
        relationships: rels
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
    const classMatch = /^\s*class\s+([A-Za-z0-9_]+)\s*\([^)]*Base[^)]*\):/.exec(line);
    if (classMatch) {
      flush();
      currentClass = classMatch[1];
      classStartLine = lineNum;
      continue;
    }
    if (!currentClass)
      continue;
    const tableMatch = /^\s*__tablename__\s*=\s*["']([^"']+)["']/.exec(line);
    if (tableMatch) {
      currentTable = tableMatch[1];
      continue;
    }
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
      const nullable = /nullable\s*=\s*True/i.test(colDef) || !/nullable\s*=\s*False/i.test(colDef) && !pk;
      const typeMatch = /^[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)?(?:\([^)]*\))?/.exec(colDef.trim());
      let colType = typeMatch ? typeMatch[0] : "String";
      if (colType.startsWith("Enum("))
        colType = "Enum";
      let foreignKey;
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
        line: lineNum
      });
      continue;
    }
    const relMatch = /^\s*([A-Za-z0-9_]+)\s*=\s*relationship\s*\(\s*["']([^"']+)["']/.exec(line);
    if (relMatch) {
      const relName = relMatch[1];
      const target = relMatch[2];
      const backPopMatch = /back_populates\s*=\s*["']([^"']+)["']/.exec(line);
      rels.push({
        name: relName,
        targetModel: target,
        backPopulates: backPopMatch ? backPopMatch[1] : void 0,
        line: lineNum
      });
    }
  }
  flush();
  return tables;
}
var sqlalchemyAdapter = {
  name: "sqlalchemy",
  supportedFeatures: [
    "SQLAlchemy Base models",
    "Column / mapped_column",
    "primary_key",
    "unique constraints",
    "nullable",
    "ForeignKey (table.column)",
    "relationship() associations"
  ],
  detect: (files) => {
    return files.some(
      (f) => f.path.endsWith(".py") && (f.path.includes("models/") || f.path.includes("models.py") || f.path.includes("alembic"))
    );
  },
  async extract(repoRoot, files) {
    const pythonFiles = files.filter(
      (f) => f.path.endsWith(".py") && (f.path.includes("models") || f.path.includes("app/models") || f.path.includes("model"))
    );
    const allParsed = [];
    for (const pf of pythonFiles) {
      try {
        const text = await fs3.readFile(path3.join(repoRoot, pf.path), "utf8");
        if (text.includes("__tablename__") && (text.includes("Column(") || text.includes("mapped_column("))) {
          const parsed = parsePythonModels(text, pf.path);
          allParsed.push(...parsed);
        }
      } catch {
      }
    }
    const tableByClass = /* @__PURE__ */ new Map();
    const tableByName = /* @__PURE__ */ new Map();
    for (const t of allParsed) {
      tableByClass.set(t.className, t);
      tableByName.set(t.tableName, t);
    }
    const tables = [];
    const relationships = [];
    const findings = [];
    for (const raw of allParsed) {
      const tid = tableId(raw.tableName);
      const cols = raw.columns.map((c) => ({
        id: columnId(tid, c.name),
        name: c.name,
        type: c.type,
        nullable: c.nullable,
        default: null,
        isPrimaryKey: c.pk,
        isUnique: c.unique,
        status: "verified",
        evidence: [{ file: raw.file, lines: [c.line, c.line] }]
      }));
      tables.push({
        id: tid,
        name: raw.tableName,
        dbName: raw.tableName,
        explanation: null,
        status: "verified",
        evidence: [{ file: raw.file, lines: [raw.startLine, raw.startLine] }],
        columns: cols
      });
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
            enforcement: "db-enforced",
            status: "verified",
            evidence: [{ file: raw.file, lines: [col.line, col.line] }]
          });
        }
      }
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
              evidence: [{ file: raw.file, lines: [rel.line, rel.line] }]
            });
          }
        }
      }
      if (!raw.columns.some((c) => c.pk)) {
        findings.push({
          id: `finding:no-primary-key:${raw.tableName}`,
          category: "table-without-primary-key",
          severity: "suggestion",
          explanation: `${raw.tableName} has no primary key column defined.`,
          recommendation: `Consider adding primary_key=True to ${raw.tableName}.`,
          status: "verified",
          evidence: [{ file: raw.file, lines: [raw.startLine, raw.startLine] }]
        });
      }
    }
    return {
      schemaVersion: "0",
      tool: { name: "schemasage", version: TOOL_VERSION },
      generatedAt: (/* @__PURE__ */ new Date()).toISOString(),
      source: {
        adapter: "sqlalchemy",
        adapterVersion: TOOL_VERSION,
        files: pythonFiles.map((f) => f.path)
      },
      tables,
      relationships,
      findings,
      coverage: {
        filesScanned: pythonFiles.map((f) => f.path),
        unsupported: [],
        skipped: []
      }
    };
  }
};

// src/adapters/mongoose/index.ts
init_ids();
init_version();
import { promises as fs4 } from "node:fs";
import path4 from "node:path";
import ts from "typescript";
function cleanTypeName(t) {
  return t.replace(/^(?:mongoose\.)?(?:Schema\.)?(?:Types\.)?/, "").replace(/^String$/i, "string").replace(/^Number$/i, "number").replace(/^Boolean$/i, "boolean").replace(/^Date$/i, "Date").replace(/^ObjectId$/i, "ObjectId");
}
function parseMongooseAST(sourceText, filePath) {
  const sourceFile = ts.createSourceFile(
    filePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  );
  const schemas = [];
  const schemaVarToFields = /* @__PURE__ */ new Map();
  const schemaVarToModelName = /* @__PURE__ */ new Map();
  function getLineNumber(pos) {
    return sourceFile.getLineAndCharacterOfPosition(pos).line + 1;
  }
  function extractFieldsFromObjectLiteral(objLiteral) {
    const fields = [
      {
        name: "_id",
        type: "ObjectId",
        required: true,
        unique: true,
        line: getLineNumber(objLiteral.pos)
      }
    ];
    for (const prop of objLiteral.properties) {
      if (!ts.isPropertyAssignment(prop))
        continue;
      const fieldName = prop.name.getText(sourceFile).replace(/['"]/g, "");
      if (fieldName === "_id")
        continue;
      let typeStr = "Mixed";
      let isRequired = false;
      let isUnique = false;
      let refTarget;
      const init = prop.initializer;
      const line = getLineNumber(prop.pos);
      if (ts.isIdentifier(init) || ts.isPropertyAccessExpression(init)) {
        typeStr = cleanTypeName(init.getText(sourceFile));
      } else if (ts.isArrayLiteralExpression(init)) {
        if (init.elements.length > 0) {
          const firstElem = init.elements[0];
          if (ts.isObjectLiteralExpression(firstElem)) {
            for (const subProp of firstElem.properties) {
              if (ts.isPropertyAssignment(subProp)) {
                const subKey = subProp.name.getText(sourceFile).replace(/['"]/g, "");
                if (subKey === "type")
                  typeStr = cleanTypeName(subProp.initializer.getText(sourceFile)) + "[]";
                if (subKey === "ref")
                  refTarget = subProp.initializer.getText(sourceFile).replace(/['"]/g, "");
              }
            }
          } else {
            typeStr = cleanTypeName(firstElem.getText(sourceFile)) + "[]";
          }
        } else {
          typeStr = "Array";
        }
      } else if (ts.isObjectLiteralExpression(init)) {
        for (const subProp of init.properties) {
          if (!ts.isPropertyAssignment(subProp))
            continue;
          const subKey = subProp.name.getText(sourceFile).replace(/['"]/g, "");
          const subVal = subProp.initializer;
          if (subKey === "type") {
            if (ts.isArrayLiteralExpression(subVal) && subVal.elements.length > 0) {
              typeStr = cleanTypeName(subVal.elements[0].getText(sourceFile)) + "[]";
            } else {
              typeStr = cleanTypeName(subVal.getText(sourceFile));
            }
          } else if (subKey === "required") {
            isRequired = subVal.kind === ts.SyntaxKind.TrueKeyword;
          } else if (subKey === "unique") {
            isUnique = subVal.kind === ts.SyntaxKind.TrueKeyword;
          } else if (subKey === "ref") {
            refTarget = subVal.getText(sourceFile).replace(/['"]/g, "");
          }
        }
      }
      fields.push({
        name: fieldName,
        type: typeStr,
        required: isRequired,
        unique: isUnique,
        ref: refTarget,
        line
      });
    }
    return fields;
  }
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.initializer) {
      const varName = node.name.getText(sourceFile);
      let init = node.initializer;
      if (ts.isAsExpression(init))
        init = init.expression;
      if ((ts.isNewExpression(init) || ts.isCallExpression(init)) && /Schema$/i.test(init.expression.getText(sourceFile))) {
        const firstArg = init.arguments?.[0];
        if (firstArg && ts.isObjectLiteralExpression(firstArg)) {
          const fields = extractFieldsFromObjectLiteral(firstArg);
          schemaVarToFields.set(varName, {
            line: getLineNumber(node.pos),
            fields
          });
        }
      }
    }
    if (ts.isCallExpression(node)) {
      const exprText = node.expression.getText(sourceFile);
      if (/^(?:mongoose\.)?model$/i.test(exprText) && node.arguments.length >= 1) {
        const firstArg = node.arguments[0];
        if (ts.isStringLiteral(firstArg) || ts.isNoSubstitutionTemplateLiteral(firstArg)) {
          const modelName = firstArg.text;
          const secondArg = node.arguments[1];
          let fields = [];
          let line = getLineNumber(node.pos);
          if (secondArg && ts.isIdentifier(secondArg)) {
            const schemaVar = secondArg.getText(sourceFile);
            schemaVarToModelName.set(schemaVar, modelName);
            const found = schemaVarToFields.get(schemaVar);
            if (found) {
              fields = found.fields;
              line = found.line;
            }
          } else if (secondArg && ts.isObjectLiteralExpression(secondArg)) {
            fields = extractFieldsFromObjectLiteral(secondArg);
          } else if (secondArg && (ts.isNewExpression(secondArg) || ts.isCallExpression(secondArg)) && secondArg.arguments?.[0] && ts.isObjectLiteralExpression(secondArg.arguments[0])) {
            fields = extractFieldsFromObjectLiteral(secondArg.arguments[0]);
          }
          if (fields.length > 0) {
            schemas.push({
              modelName,
              collectionName: modelName.toLowerCase() + "s",
              file: filePath,
              line,
              fields
            });
          }
        }
      }
    }
    if (ts.isClassDeclaration(node) && node.name) {
      const className = node.name.getText(sourceFile);
      const props = [
        {
          name: "_id",
          type: "ObjectId",
          required: true,
          unique: true,
          line: getLineNumber(node.pos)
        }
      ];
      let hasTypegooseProp = false;
      for (const member of node.members) {
        if (!ts.isPropertyDeclaration(member))
          continue;
        const memberName = member.name.getText(sourceFile);
        const memberLine = getLineNumber(member.pos);
        const memberType = member.type ? member.type.getText(sourceFile) : "Mixed";
        const text = member.getText(sourceFile);
        if (text.includes("@prop") || member.modifiers?.some((m) => m.getText(sourceFile).includes("prop"))) {
          hasTypegooseProp = true;
          const refMatch = /ref\s*:\s*["']?([A-Za-z0-9_]+)["']?/.exec(text);
          const reqMatch = /required\s*:\s*true/.test(text);
          const uqMatch = /unique\s*:\s*true/.test(text);
          props.push({
            name: memberName,
            type: memberType,
            required: reqMatch,
            unique: uqMatch,
            ref: refMatch ? refMatch[1] : void 0,
            line: memberLine
          });
        }
      }
      if (hasTypegooseProp) {
        schemas.push({
          modelName: className,
          collectionName: className.toLowerCase() + "s",
          file: filePath,
          line: getLineNumber(node.pos),
          fields: props
        });
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  for (const [varName, { line, fields }] of schemaVarToFields.entries()) {
    const isAlreadyExtracted = schemas.some((s) => s.file === filePath && s.fields === fields);
    if (!isAlreadyExtracted) {
      const inferredName = varName.replace(/Schema$/i, "");
      schemas.push({
        modelName: inferredName,
        collectionName: inferredName.toLowerCase() + "s",
        file: filePath,
        line,
        fields
      });
    }
  }
  return schemas;
}
var mongooseAdapter = {
  name: "mongoose",
  supportedFeatures: [
    "Mongoose Schemas",
    "AST Type extraction",
    "required / unique constraints",
    "ref cross-collection relationships",
    "Typegoose @prop support"
  ],
  detect(files) {
    return files.some(
      (f) => f.path.includes("models/") || f.path.includes("schema/") || f.path.includes("schemas/") || f.path.endsWith(".model.ts") || f.path.endsWith(".model.js") || f.path.endsWith(".schema.ts") || f.path.endsWith(".schema.js")
    );
  },
  async extract(repoRoot, files) {
    const candidateFiles = files.filter(
      (f) => (f.path.endsWith(".ts") || f.path.endsWith(".js") || f.path.endsWith(".mjs")) && !f.path.endsWith(".d.ts") && !f.path.includes("node_modules") && (f.path.includes("model") || f.path.includes("schema") || f.path.includes("entity") || f.path.includes("entities"))
    );
    const allSchemas = [];
    const scannedPaths = [];
    for (const file of candidateFiles) {
      try {
        const content = await fs4.readFile(path4.join(repoRoot, file.path), "utf8");
        if (content.includes("Schema") || content.includes("model") || content.includes("mongoose") || content.includes("@prop")) {
          const parsed = parseMongooseAST(content, file.path);
          if (parsed.length > 0) {
            allSchemas.push(...parsed);
            scannedPaths.push(file.path);
          }
        }
      } catch {
      }
    }
    const tables = [];
    const relationships = [];
    const modelNameToTable = /* @__PURE__ */ new Map();
    const seenCollections = /* @__PURE__ */ new Set();
    for (const m of allSchemas) {
      if (seenCollections.has(m.collectionName))
        continue;
      seenCollections.add(m.collectionName);
      modelNameToTable.set(m.modelName, m.collectionName);
      modelNameToTable.set(m.collectionName, m.collectionName);
      modelNameToTable.set(m.modelName.toLowerCase(), m.collectionName);
      const columns = m.fields.map((p) => ({
        id: columnId(m.collectionName, p.name),
        name: p.name,
        type: p.type,
        nullable: !p.required,
        default: null,
        isPrimaryKey: p.name === "_id",
        isUnique: p.unique || p.name === "_id",
        status: "verified",
        evidence: [{ file: m.file, lines: [p.line, p.line] }]
      }));
      tables.push({
        id: tableId(m.collectionName),
        name: m.collectionName,
        dbName: m.collectionName,
        explanation: `MongoDB Collection (from model: ${m.modelName})`,
        status: "verified",
        evidence: [{ file: m.file, lines: [m.line, m.line] }],
        columns
      });
    }
    for (const m of allSchemas) {
      for (const p of m.fields) {
        if (p.ref && modelNameToTable.has(p.ref)) {
          const targetTable = modelNameToTable.get(p.ref);
          if (targetTable !== m.collectionName) {
            relationships.push({
              id: relationshipId(columnId(m.collectionName, p.name), columnId(targetTable, "_id")),
              from: columnId(m.collectionName, p.name),
              to: columnId(targetTable, "_id"),
              cardinality: "one-to-many",
              enforcement: "orm-declared",
              status: "inferred",
              evidence: [{ file: m.file, lines: [p.line, p.line] }]
            });
          }
        }
      }
    }
    return {
      schemaVersion: "0.2.0",
      tool: { name: "schemasage", version: TOOL_VERSION },
      generatedAt: (/* @__PURE__ */ new Date()).toISOString(),
      source: {
        adapter: "mongoose",
        adapterVersion: TOOL_VERSION,
        files: scannedPaths.length > 0 ? scannedPaths : ["models/"]
      },
      tables,
      relationships,
      findings: [],
      coverage: {
        filesScanned: scannedPaths,
        skipped: [],
        unsupported: []
      }
    };
  }
};

// src/adapters/sql/index.ts
init_ids();
init_version();
import { promises as fs5 } from "node:fs";
import path5 from "node:path";
import { parse as parse2 } from "pgsql-ast-parser";
var sqlAdapter = {
  name: "sql",
  supportedFeatures: ["CREATE TABLE", "PRIMARY KEY", "FOREIGN KEY", "UNIQUE", "NOT NULL"],
  detect(files) {
    return files.some(
      (f) => f.path.endsWith(".sql") || f.path.includes("migrations/") || f.path.includes("schema.sql") || f.path.includes("init.sql")
    );
  },
  async extract(repoRoot, files) {
    const sqlFiles = files.filter(
      (f) => f.path.endsWith(".sql") && !f.path.includes("test") && !f.path.includes("node_modules")
    );
    const tablesMap = /* @__PURE__ */ new Map();
    const fks = [];
    const scannedPaths = [];
    for (const f of sqlFiles) {
      try {
        const content = await fs5.readFile(path5.join(repoRoot, f.path), "utf8");
        scannedPaths.push(f.path);
        try {
          const ast = parse2(content);
          for (const stmt of ast) {
            if (stmt.type === "create table") {
              const tableName = stmt.name.name;
              const rawCols = [];
              for (const colDef of stmt.columns) {
                if (colDef.kind === "column") {
                  let isPk = false;
                  let isUnique = false;
                  let isNullable = true;
                  let defaultVal = null;
                  for (const c of colDef.constraints || []) {
                    if (c.type === "primary key")
                      isPk = true;
                    if (c.type === "unique")
                      isUnique = true;
                    if (c.type === "not null")
                      isNullable = false;
                    if (c.type === "reference") {
                      fks.push({
                        fromTable: tableName,
                        fromCol: colDef.name.name,
                        toTable: c.foreignTable.name,
                        toCol: c.foreignColumns?.[0]?.name || "id",
                        file: f.path,
                        line: 1
                      });
                    }
                  }
                  rawCols.push({
                    name: colDef.name.name,
                    type: typeof colDef.dataType === "string" ? colDef.dataType : colDef.dataType?.name || "text",
                    nullable: isNullable && !isPk,
                    isPk,
                    isUnique: isUnique || isPk,
                    defaultVal,
                    line: 1
                  });
                }
              }
              tablesMap.set(tableName, {
                name: tableName,
                file: f.path,
                line: 1,
                columns: rawCols
              });
            }
          }
        } catch {
          const createTableRegex = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([A-Za-z0-9_."]+)\s*\(([\s\S]*?)\);/gi;
          let match;
          while ((match = createTableRegex.exec(content)) !== null) {
            let tName = match[1].replace(/["`]/g, "");
            if (tName.includes("."))
              tName = tName.split(".").pop();
            const body = match[2];
            const rawCols = [];
            const colLines = body.split("\n");
            for (let i = 0; i < colLines.length; i++) {
              const line = colLines[i].trim();
              if (!line || line.startsWith("--") || line.startsWith("/*"))
                continue;
              const colMatch = /^([A-Za-z0-9_"`]+)\s+([A-Za-z0-9_()]+)/.exec(line);
              if (colMatch) {
                const cName = colMatch[1].replace(/["`]/g, "");
                if (cName.toUpperCase() === "PRIMARY" || cName.toUpperCase() === "CONSTRAINT" || cName.toUpperCase() === "FOREIGN" || cName.toUpperCase() === "KEY")
                  continue;
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
                  line: i + 1
                });
              }
              const fkMatch = /FOREIGN\s+KEY\s*\(([A-Za-z0-9_"`]+)\)\s*REFERENCES\s*([A-Za-z0-9_."`]+)\s*\(([A-Za-z0-9_"`]+)\)/i.exec(line);
              if (fkMatch) {
                let toTab = fkMatch[2].replace(/["`]/g, "");
                if (toTab.includes("."))
                  toTab = toTab.split(".").pop();
                fks.push({
                  fromTable: tName,
                  fromCol: fkMatch[1].replace(/["`]/g, ""),
                  toTable: toTab,
                  toCol: fkMatch[3].replace(/["`]/g, ""),
                  file: f.path,
                  line: i + 1
                });
              }
            }
            if (!tablesMap.has(tName)) {
              tablesMap.set(tName, {
                name: tName,
                file: f.path,
                line: 1,
                columns: rawCols
              });
            }
          }
        }
      } catch {
      }
    }
    const tables = Array.from(tablesMap.values()).map((t) => ({
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
        evidence: [{ file: t.file, lines: [c.line, c.line] }]
      }))
    }));
    const validColIds = new Set(tables.flatMap((t) => t.columns.map((c) => c.id)));
    const relationships = [];
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
          evidence: [{ file: fk.file, lines: [fk.line, fk.line] }]
        });
      }
    }
    return {
      schemaVersion: "0.2.0",
      tool: { name: "schemasage", version: TOOL_VERSION },
      generatedAt: (/* @__PURE__ */ new Date()).toISOString(),
      source: {
        adapter: "sql",
        adapterVersion: TOOL_VERSION,
        files: scannedPaths
      },
      tables,
      relationships,
      findings: [],
      coverage: {
        filesScanned: scannedPaths,
        skipped: [],
        unsupported: []
      }
    };
  }
};

// src/adapters/index.ts
var adapters = [
  prismaAdapter,
  mongooseAdapter,
  sqlalchemyAdapter,
  sqlAdapter
];

// src/redaction/patterns.ts
var RULES = [
  // postgresql://user:password@host  ->  postgresql://user:[REDACTED]@host
  { name: "url-credentials", re: /([a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:)([^\s@/]+)(@)/gi, replace: "$1[REDACTED]$3" },
  // Stripe-style keys
  { name: "stripe-key", re: /\b(?:sk|pk|rk)_(?:test|live)_[A-Za-z0-9]{8,}\b/g, replace: "[REDACTED]" },
  // AWS access key id
  { name: "aws-key", re: /\bAKIA[0-9A-Z]{16}\b/g, replace: "[REDACTED]" },
  // GitHub tokens
  { name: "github-token", re: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g, replace: "[REDACTED]" },
  // JSON Web Tokens
  { name: "jwt", re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, replace: "[REDACTED]" },
  // NAME_SECRET=value style assignments
  {
    name: "secret-assignment",
    re: /\b([A-Z0-9_]*(?:SECRET|PASSWORD|PASSWD|TOKEN|API_KEY|PRIVATE_KEY)[A-Z0-9_]*)(\s*=\s*)(["']?)([^\s"'#]{6,})/g,
    replace: "$1$2$3[REDACTED]"
  }
];
function redactPatterns(text) {
  const hits = [];
  let out = text;
  for (const rule of RULES) {
    out = out.replace(rule.re, (...args) => {
      hits.push(rule.name);
      const match = args[0];
      if (typeof rule.replace === "string") {
        return match.replace(rule.re, rule.replace);
      }
      return rule.replace(...args);
    });
  }
  return { text: out, hits };
}

// src/validation/validate.ts
function validateModel(model) {
  const issues = [];
  const ids = /* @__PURE__ */ new Map();
  const add = (id) => ids.set(id, (ids.get(id) ?? 0) + 1);
  for (const t of model.tables) {
    add(t.id);
    if (t.evidence.length === 0)
      issues.push({ rule: "evidence", message: `${t.id} has no evidence` });
    for (const c of t.columns) {
      add(c.id);
      if (c.evidence.length === 0)
        issues.push({ rule: "evidence", message: `${c.id} has no evidence` });
    }
  }
  const columnIds = new Set(model.tables.flatMap((t) => t.columns.map((c) => c.id)));
  for (const r of model.relationships) {
    add(r.id);
    if (r.evidence.length === 0)
      issues.push({ rule: "evidence", message: `${r.id} has no evidence` });
    for (const ref of [r.from, r.to]) {
      if (!columnIds.has(ref))
        issues.push({ rule: "dangling-reference", message: `${r.id} points to missing ${ref}` });
    }
    if (r.enforcement === "db-enforced" && !r.evidence.some((e) => e.file.endsWith(".sql"))) {
      issues.push({ rule: "enforcement", message: `${r.id} is db-enforced but has no migration evidence` });
    }
  }
  for (const f of model.findings) {
    add(f.id);
    if (f.evidence.length === 0)
      issues.push({ rule: "evidence", message: `${f.id} has no evidence` });
  }
  for (const [id, count] of ids) {
    if (count > 1)
      issues.push({ rule: "duplicate-id", message: `${id} appears ${count} times` });
  }
  return issues;
}

// src/generator/output.ts
import { promises as fs6 } from "node:fs";
import path6 from "node:path";
import { createHash } from "node:crypto";
var OUTPUT_DIR = "artifacts/schemasage";
async function writeOutput(repoRoot, files) {
  const base = path6.resolve(repoRoot, OUTPUT_DIR);
  const manifest = [];
  for (const [rel, content] of Object.entries(files)) {
    const target = path6.resolve(base, rel);
    if (!target.startsWith(base + path6.sep)) {
      throw new Error(`Refusing to write outside output directory: ${rel}`);
    }
    await fs6.mkdir(path6.dirname(target), { recursive: true });
    await fs6.writeFile(target, content, "utf8");
    manifest.push({ path: rel, sha256: createHash("sha256").update(content).digest("hex") });
  }
  return manifest;
}

// src/generator/markdown.ts
function databaseMarkdown(m) {
  const out = [];
  out.push("# Database overview", "", `Generated by SchemaSage ${m.tool.version} from ${m.source.files.join(", ")}.`, "");
  out.push("> Facts are extracted from code and migrations. Explanations, when present, are agent-written and inferred.", "");
  out.push("## Tables", "");
  for (const t of m.tables) {
    out.push(`### ${t.name}${t.dbName && t.dbName !== t.name ? ` (database table: ${t.dbName})` : ""}`, "", "| Column | Type | Nullable | Key | Unique | Source |", "|---|---|---|---|---|---|");
    for (const c of t.columns) {
      const key = c.isPrimaryKey ? "PK" : "";
      const src = c.evidence[0] ? `${c.evidence[0].file}:${c.evidence[0].lines?.[0] ?? ""}` : "";
      out.push(`| ${c.name} | ${c.type} | ${c.nullable ? "yes" : "no"} | ${key} | ${c.isUnique ? "yes" : ""} | ${src} |`);
    }
    out.push("");
  }
  out.push("## Relationships", "", "| From | To | Cardinality | Enforcement |", "|---|---|---|---|");
  for (const r of m.relationships)
    out.push(`| ${r.from} | ${r.to} | ${r.cardinality} | ${r.enforcement} |`);
  if (m.application) {
    out.push("", "## Application usage (Prisma calls in code)", "", "| Table | Operation | Method | Where |", "|---|---|---|---|");
    for (const u of m.application.usages)
      out.push(`| ${u.table} | ${u.operation} | ${u.method} | ${u.file}:${u.line} |`);
    out.push("", "## Endpoints and flows (inferred, matched by function name)", "");
    for (const f of m.application.flows) {
      out.push(`- **${f.endpoint.method} ${f.endpoint.path}** (${f.endpoint.file}:${f.endpoint.line}): ${f.chain.map((c) => c.fn).join(" \u2192 ")}`);
      for (const o of f.operations)
        out.push(`  - ${o.operation} ${o.table} at ${o.file}:${o.line}`);
    }
  }
  out.push("", "## Findings (suggestions)", "");
  if (m.findings.length === 0)
    out.push("No findings.");
  for (const f of m.findings)
    out.push(`- **${f.category}**: ${f.explanation} ${f.recommendation}`);
  out.push("", "## Coverage", "", `Files read: ${m.coverage.filesScanned.join(", ")}`);
  if (m.coverage.unsupported.length)
    out.push("", "Unsupported syntax (not analysed):", ...m.coverage.unsupported.map((u) => `- ${u}`));
  out.push("");
  return out.join("\n");
}

// src/generator/escape.ts
var esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

// src/generator/erd.ts
var BOX_W = 232;
var HEAD = 30;
var ROW = 18;
var PAD = 10;
var GAP_X = 96;
var GAP_Y = 36;
var MARGIN = 24;
var COLS = 6;
var MAX_PER_COL = 8;
var BAND_GAP = 56;
function assignLayers(model) {
  const layer = new Map(model.tables.map((t) => [t.name, 0]));
  const refs = /* @__PURE__ */ new Map();
  for (const r of model.relationships) {
    const a = r.from.replace(/^column:/, "").split(".")[0];
    const b = r.to.replace(/^column:/, "").split(".")[0];
    if (a === b)
      continue;
    refs.set(a, [...refs.get(a) ?? [], b]);
  }
  for (let pass = 0; pass < model.tables.length; pass++) {
    let changed = false;
    for (const [a, targets] of refs) {
      for (const b of targets) {
        const want = (layer.get(b) ?? 0) + 1;
        if (want > (layer.get(a) ?? 0)) {
          layer.set(a, want);
          changed = true;
        }
      }
    }
    if (!changed)
      break;
  }
  return layer;
}
function erdSvg(model) {
  const n = model.tables.length;
  if (n === 0)
    return "";
  const layerOf = assignLayers(model);
  const nodes = /* @__PURE__ */ new Map();
  for (const t of model.tables) {
    nodes.set(t.name, { table: t, h: HEAD + t.columns.length * ROW + PAD * 2, layer: layerOf.get(t.name) ?? 0, order: 0, x: 0, y: 0 });
  }
  const neighbours = /* @__PURE__ */ new Map();
  for (const r of model.relationships) {
    const a = r.from.replace(/^column:/, "").split(".")[0];
    const b = r.to.replace(/^column:/, "").split(".")[0];
    if (a === b)
      continue;
    neighbours.set(a, [...neighbours.get(a) ?? [], b]);
    neighbours.set(b, [...neighbours.get(b) ?? [], a]);
  }
  const maxLayer = Math.max(...[...nodes.values()].map((x) => x.layer));
  const columns = Array.from({ length: maxLayer + 1 }, () => []);
  for (const t of model.tables)
    columns[nodes.get(t.name).layer].push(nodes.get(t.name));
  for (const col of columns)
    col.sort((p, q) => p.table.name.localeCompare(q.table.name));
  const indexIn = () => {
    for (const col of columns)
      col.forEach((node, i) => node.order = i);
  };
  indexIn();
  for (let sweep = 0; sweep < 4; sweep++) {
    for (let L = 0; L <= maxLayer; L++) {
      const col = columns[L];
      const bary = (node) => {
        const ns = (neighbours.get(node.table.name) ?? []).map((nm2) => nodes.get(nm2)).filter((x) => x.layer !== L);
        return ns.length ? ns.reduce((s, x) => s + x.order, 0) / ns.length : node.order;
      };
      col.sort((p, q) => bary(p) - bary(q) || p.table.name.localeCompare(q.table.name));
      col.forEach((node, i) => node.order = i);
    }
  }
  const chunks = [];
  columns.forEach((col) => {
    for (let i = 0; i < col.length; i += MAX_PER_COL)
      chunks.push(col.slice(i, i + MAX_PER_COL));
  });
  const colH = (col) => col.reduce((sum, x) => sum + x.h, 0) + Math.max(0, col.length - 1) * GAP_Y;
  const bands = Math.ceil(chunks.length / COLS) || 1;
  const bandHeight = Array(bands).fill(0);
  chunks.forEach((col, k) => {
    bandHeight[Math.floor(k / COLS)] = Math.max(bandHeight[Math.floor(k / COLS)], colH(col));
  });
  const bandTop = [];
  let yCursor = MARGIN;
  for (let b = 0; b < bands; b++) {
    bandTop.push(yCursor);
    yCursor += bandHeight[b] + BAND_GAP;
  }
  chunks.forEach((col, k) => {
    const b = Math.floor(k / COLS);
    let y = bandTop[b];
    for (const node of col) {
      node.x = MARGIN + k % COLS * (BOX_W + GAP_X);
      node.y = y;
      y += node.h + GAP_Y;
    }
  });
  const usedCols = Math.min(COLS, chunks.length);
  const width = MARGIN * 2 + usedCols * BOX_W + (usedCols - 1) * GAP_X;
  const height = yCursor - BAND_GAP + MARGIN;
  const parts = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="Entity relationship diagram with ${n} tables and ${model.relationships.length} relationships">`);
  parts.push(`<defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="currentColor"/></marker></defs>`);
  model.relationships.forEach((rel, idx) => {
    const [fromTable, fromCol] = rel.from.replace(/^column:/, "").split(".");
    const toTable = rel.to.replace(/^column:/, "").split(".")[0];
    const a = nodes.get(fromTable);
    const b = nodes.get(toTable);
    if (!a || !b)
      return;
    const aRow = Math.max(0, a.table.columns.findIndex((c) => c.name === fromCol));
    const ay = a.y + HEAD + aRow * ROW + ROW / 2;
    const by = b.y + HEAD + ROW / 2;
    const dashed = rel.enforcement === "orm-declared" ? ` stroke-dasharray="6 5"` : "";
    const label = rel.cardinality === "one-to-one" ? "1 : 1" : "1 : n";
    const common = `fill="none" stroke="currentColor" stroke-width="1.5"${dashed} marker-end="url(#arrow)" class="edge ${esc(rel.enforcement)}"`;
    let d;
    let mx;
    let my;
    if (a === b) {
      const x = a.x + BOX_W;
      d = `M${x},${ay} C${x + 60},${ay - 30} ${x + 60},${by + 30} ${x},${by}`;
      mx = x + 40;
      my = (ay + by) / 2;
    } else if (a.x > b.x) {
      const ax = a.x;
      const bx = b.x + BOX_W;
      const dx = Math.max(30, (ax - bx) / 2);
      d = `M${ax},${ay} C${ax - dx},${ay} ${bx + dx},${by} ${bx},${by}`;
      mx = (ax + bx) / 2;
      my = (ay + by) / 2;
    } else if (a.x < b.x) {
      const ax = a.x + BOX_W;
      const bx = b.x;
      const dx = Math.max(30, (bx - ax) / 2);
      d = `M${ax},${ay} C${ax + dx},${ay} ${bx - dx},${by} ${bx},${by}`;
      mx = (ax + bx) / 2;
      my = (ay + by) / 2;
    } else {
      const ax = a.x + BOX_W;
      d = `M${ax},${ay} C${ax + 50},${ay} ${ax + 50},${by} ${ax},${by}`;
      mx = ax + 25;
      my = (ay + by) / 2;
    }
    parts.push(
      `<a href="#rel-${idx}" aria-label="${esc(rel.from)} to ${esc(rel.to)}, ${esc(rel.enforcement)}"><path d="${d}" ${common}/><text x="${mx}" y="${my - 4}" text-anchor="middle" class="edge-label">${label}</text></a>`
    );
  });
  for (const node of nodes.values()) {
    const t = node.table;
    parts.push(`<g id="erd-${esc(t.name)}" class="entity" data-name="${esc(t.name.toLowerCase())}">`);
    parts.push(`<rect x="${node.x}" y="${node.y}" width="${BOX_W}" height="${node.h}" rx="8" class="box"/>`);
    parts.push(`<rect x="${node.x}" y="${node.y}" width="${BOX_W}" height="${HEAD}" rx="8" class="box-head"/>`);
    parts.push(`<text x="${node.x + 10}" y="${node.y + 20}" class="table-name">${esc(t.name)}</text>`);
    t.columns.forEach((c, i) => {
      const yy = node.y + HEAD + PAD + i * ROW + 13;
      const key = c.isPrimaryKey ? "PK " : c.isUnique ? "U " : "";
      parts.push(`<text x="${node.x + 10}" y="${yy}" class="col${c.isPrimaryKey ? " pk" : ""}">${esc(key + c.name)}</text>`);
      parts.push(`<text x="${node.x + BOX_W - 10}" y="${yy}" text-anchor="end" class="col-type">${esc(c.type + (c.nullable ? "?" : ""))}</text>`);
    });
    parts.push(`</g>`);
  }
  parts.push(`</svg>`);
  return parts.join("\n");
}
var ERD_CSS = `
.erd-wrap { overflow-x: auto; border: 1px solid var(--line); border-radius: 8px; padding: 8px; }
.erd-wrap svg { color: var(--fg); display: block; }
.erd-wrap .box { fill: var(--bg); stroke: var(--line); stroke-width: 1.2; }
.erd-wrap .box-head { fill: var(--head); stroke: var(--line); stroke-width: 1.2; }
.erd-wrap .table-name { font: 600 13px system-ui, sans-serif; fill: var(--fg); }
.erd-wrap .col { font: 12px ui-monospace, monospace; fill: var(--fg); }
.erd-wrap .col.pk { font-weight: 700; }
.erd-wrap .col-type { font: 11px ui-monospace, monospace; fill: var(--muted); }
.erd-wrap .edge-label { font: 11px system-ui, sans-serif; fill: var(--muted); paint-order: stroke; stroke: var(--bg); stroke-width: 3px; }
.erd-wrap .edge.db-enforced { color: var(--solid); }
.erd-wrap .edge.orm-declared { color: var(--dash); }
.erd-wrap a:focus-visible { outline: none; }
.erd-wrap a:focus-visible .edge { stroke-width: 3; }
`;

// src/generator/html.ts
import { createHash as createHash2 } from "node:crypto";
var FILTER_SCRIPT = `(function(){var i=document.getElementById("filter");if(!i)return;i.addEventListener("input",function(){var q=i.value.trim().toLowerCase();document.querySelectorAll("section.table").forEach(function(s){s.hidden=q!==""&&s.id.toLowerCase().indexOf(q)<0;});document.querySelectorAll("g.entity").forEach(function(g){g.style.display=q!==""&&(g.getAttribute("data-name")||"").indexOf(q)<0?"none":"";});});})();`;
var FILTER_HASH = "sha256-" + createHash2("sha256").update(FILTER_SCRIPT).digest("base64");
function databaseHtml(m) {
  const tables = m.tables.map((t) => `
    <section class="table" id="${esc(t.name)}">
      <h3>${esc(t.name)}${t.dbName && t.dbName !== t.name ? ` <small>(database table: ${esc(t.dbName)})</small>` : ""}</h3>
      <table><thead><tr><th>Column</th><th>Type</th><th>Nullable</th><th>Key</th><th>Unique</th><th>Source</th></tr></thead><tbody>
      ${t.columns.map((c) => `<tr><td>${esc(c.name)}</td><td>${esc(c.type)}</td><td>${c.nullable ? "yes" : "no"}</td><td>${c.isPrimaryKey ? "PK" : ""}</td><td>${c.isUnique ? "yes" : ""}</td><td><code>${esc(c.evidence[0]?.file ?? "")}:${c.evidence[0]?.lines?.[0] ?? ""}</code></td></tr>`).join("")}
      </tbody></table>
    </section>`).join("");
  const rels = m.relationships.map((r) => `<tr id="rel-${m.relationships.indexOf(r)}"><td><code>${esc(r.from)}</code></td><td><code>${esc(r.to)}</code></td><td>${esc(r.cardinality)}</td><td class="${esc(r.enforcement)}">${esc(r.enforcement)}</td></tr>`).join("");
  const findings = m.findings.length ? m.findings.map((f) => `<li><strong>${esc(f.category)}</strong>: ${esc(f.explanation)} <em>${esc(f.recommendation)}</em></li>`).join("") : "<li>No findings.</li>";
  const unsupported = m.coverage.unsupported.map((u) => `<li>${esc(u)}</li>`).join("");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src '${FILTER_HASH}'; img-src 'self' data:">
<title>SchemaSage: database</title>
<style>
:root { color-scheme: light dark; --fg:#1d1d1f; --bg:#fff; --muted:#6e6e73; --line:#d2d2d7; --dash:#b45309; --solid:#0f766e; }
@media (prefers-color-scheme: dark) { :root { --fg:#f5f5f7; --bg:#1c1c1e; --muted:#a1a1a6; --line:#3a3a3c; --dash:#fbbf24; --solid:#5eead4; } }
body { font-family: system-ui, sans-serif; margin:0; padding:16px; color:var(--fg); background:var(--bg); line-height:1.5; }
main { max-width: 960px; margin: 0 auto; }
h1 { margin-bottom:0; } .sub { color:var(--muted); margin-top:4px; }
nav { display: flex; flex-wrap: wrap; gap: 6px 14px; }
nav a { margin-right: 0; }
table { border-collapse: collapse; width: 100%; margin: 8px 0 20px; font-size: 14px; display: block; overflow-x: auto; }
th, td { border-bottom: 1px solid var(--line); padding: 6px 8px; text-align: left; vertical-align: top; }
code { font-size: 13px; overflow-wrap: anywhere; }
.db-enforced { color: var(--solid); font-weight: 600; }
.orm-declared { color: var(--dash); font-weight: 600; }
.legend { font-size: 14px; color: var(--muted); }
:focus-visible { outline: 3px solid var(--solid); outline-offset: 2px; }
:root { --head: #f2f2f7; }
@media (prefers-color-scheme: dark) { :root { --head: #2c2c2e; } }
${ERD_CSS}
</style>
</head>
<body>
<main>
<h1>Database</h1>
<p class="sub">Generated by SchemaSage ${esc(m.tool.version)} from ${m.source.files.map(esc).join(", ")}. Read-only. Facts come from code and migrations, not from a live database.</p>
<p><label for="filter">Filter tables: </label><input id="filter" type="search" placeholder="type a table name" style="font:inherit;padding:4px 8px;max-width:280px;width:100%"></p>
<nav aria-label="Sections"><a href="#erd">Diagram</a><a href="#tables">Tables</a><a href="#usage">Usage</a><a href="#flows">Flows</a><a href="#relationships">Relationships</a><a href="#findings">Findings</a><a href="#coverage">Coverage</a></nav>
<h2 id="erd">Diagram</h2>
<p class="legend">Solid lines: <span class="db-enforced">enforced by the database</span>. Dashed lines: <span class="orm-declared">declared only in the ORM</span>. Click a line to see its row below.</p>
<div class="erd-wrap">${erdSvg(m)}</div>
<h2 id="tables">Tables (${m.tables.length})</h2>
${tables}
${appSection(m)}
<h2 id="relationships">Relationships (${m.relationships.length})</h2>
<p class="legend"><span class="db-enforced">db-enforced</span>: a migration creates the foreign key. <span class="orm-declared">orm-declared</span>: only the ORM declares it.</p>
<table><thead><tr><th>From</th><th>To</th><th>Cardinality</th><th>Enforcement</th></tr></thead><tbody>${rels}</tbody></table>
<h2 id="findings">Findings (suggestions)</h2>
<ul>${findings}</ul>
<h2 id="coverage">Coverage</h2>
<p>Files read: ${m.coverage.filesScanned.map((f) => `<code>${esc(f)}</code>`).join(", ")}</p>
${unsupported ? `<p>Not analysed:</p><ul>${unsupported}</ul>` : ""}
</main>
<script>${FILTER_SCRIPT}</script>
</body>
</html>
`;
}
function appSection(m) {
  const app = m.application;
  if (!app)
    return "";
  const byTable = /* @__PURE__ */ new Map();
  for (const u of app.usages) {
    const e = byTable.get(u.table) ?? { read: 0, write: 0, delete: 0, places: [] };
    e[u.operation]++;
    if (e.places.length < 6)
      e.places.push(`${u.file}:${u.line}${u.fn ? " (" + u.fn + ")" : ""}`);
    byTable.set(u.table, e);
  }
  const rows = [...byTable.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([t, e]) => `<tr><td>${esc(t)}</td><td>${e.read}</td><td>${e.write}</td><td>${e.delete}</td><td>${e.places.map((p) => `<code>${esc(p)}</code>`).join("<br>")}</td></tr>`).join("");
  const flows = app.flows.map((f) => `<tr><td><code>${esc(f.endpoint.method)} ${esc(f.endpoint.path)}</code></td><td>${esc(f.endpoint.handler)}<br><code>${esc(f.endpoint.file)}:${f.endpoint.line}</code></td><td>${f.chain.map((c) => esc(c.fn)).join(" \u2192 ")}</td><td>${f.operations.map((o) => `${esc(o.operation)} <strong>${esc(o.table)}</strong> <code>${esc(o.file)}:${o.line}</code>`).join("<br>")}${f.ambiguousCalls.length ? `<br><em>Not followed (name defined more than once): ${f.ambiguousCalls.map(esc).join(", ")}</em>` : ""}</td></tr>`).join("");
  return `
<h2 id="usage">Application usage</h2>
<p class="legend">Found by reading application code for Prisma client calls. Name-based links are <em>inferred</em>. Receivers recognised: ${app.receivers.map(esc).join(", ")}.</p>
<table><thead><tr><th>Table</th><th>Reads</th><th>Writes</th><th>Deletes</th><th>Where (first 6)</th></tr></thead><tbody>${rows || "<tr><td colspan=5>No Prisma calls found.</td></tr>"}</tbody></table>
<h2 id="flows">Endpoints and flows (inferred)</h2>
<p class="legend">Endpoint \u2192 handler \u2192 functions it calls \u2192 database operations. Matched by function name, so treat as a lead to check, not proof.</p>
<table><thead><tr><th>Endpoint</th><th>Handler</th><th>Calls</th><th>Database operations</th></tr></thead><tbody>${flows || "<tr><td colspan=4>No endpoint reaches a Prisma call by name.</td></tr>"}</tbody></table>
<p class="legend">Endpoints found: ${app.endpoints.length}.</p>`;
}

// src/pipeline.ts
init_version();

// src/usage/scan-usage.ts
import ts2 from "typescript";
var READ = /* @__PURE__ */ new Set(["findMany", "findUnique", "findUniqueOrThrow", "findFirst", "findFirstOrThrow", "count", "aggregate", "groupBy"]);
var WRITE = /* @__PURE__ */ new Set(["create", "createMany", "createManyAndReturn", "update", "updateMany", "upsert"]);
var DELETE = /* @__PURE__ */ new Set(["delete", "deleteMany"]);
var RAW = /* @__PURE__ */ new Set(["$queryRaw", "$queryRawUnsafe", "$executeRaw", "$executeRawUnsafe"]);
var DEFAULT_RECEIVERS = ["prisma", "db"];
var kindFor = (path8) => path8.endsWith(".tsx") ? ts2.ScriptKind.TSX : path8.endsWith(".jsx") ? ts2.ScriptKind.JSX : path8.endsWith(".js") || path8.endsWith(".mjs") || path8.endsWith(".cjs") ? ts2.ScriptKind.JS : ts2.ScriptKind.TS;
var lowerFirst = (s) => s.charAt(0).toLowerCase() + s.slice(1);
function enclosingFunction(node) {
  let cur = node.parent;
  while (cur) {
    if ((ts2.isFunctionDeclaration(cur) || ts2.isMethodDeclaration(cur)) && cur.name && ts2.isIdentifier(cur.name))
      return cur.name.text;
    if ((ts2.isArrowFunction(cur) || ts2.isFunctionExpression(cur)) && cur.parent && ts2.isVariableDeclaration(cur.parent) && ts2.isIdentifier(cur.parent.name))
      return cur.parent.name.text;
    cur = cur.parent;
  }
  return null;
}
function clientNames(sf) {
  const out = [];
  const visit = (n) => {
    if (ts2.isVariableDeclaration(n) && ts2.isIdentifier(n.name) && n.initializer && ts2.isNewExpression(n.initializer)) {
      const callee = n.initializer.expression;
      if (ts2.isIdentifier(callee) && callee.text === "PrismaClient")
        out.push(n.name.text);
    }
    ts2.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}
function receiverName(expr) {
  if (ts2.isIdentifier(expr))
    return expr.text;
  if (ts2.isPropertyAccessExpression(expr))
    return expr.name.text;
  return null;
}
function scanUsage(files, modelNames) {
  const byCamel = new Map(modelNames.map((m) => [lowerFirst(m), m]));
  const parsed = files.map((f) => ({ path: f.path, sf: ts2.createSourceFile(f.path, f.text, ts2.ScriptTarget.Latest, true, kindFor(f.path)) }));
  const receivers = new Set(DEFAULT_RECEIVERS);
  for (const { sf } of parsed)
    for (const n of clientNames(sf))
      receivers.add(n);
  const usages = [];
  const rawSql = [];
  for (const { path: path8, sf } of parsed) {
    const visit = (node) => {
      if (ts2.isCallExpression(node) && ts2.isPropertyAccessExpression(node.expression)) {
        const method = node.expression.name.text;
        const target = node.expression.expression;
        const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
        if (ts2.isPropertyAccessExpression(target)) {
          const modelKey = target.name.text;
          const recv = receiverName(target.expression);
          const op = READ.has(method) ? "read" : WRITE.has(method) ? "write" : DELETE.has(method) ? "delete" : null;
          const model = byCamel.get(modelKey);
          if (recv && receivers.has(recv) && model && op) {
            usages.push({ table: model, operation: op, method, file: path8, line, fn: enclosingFunction(node) });
          }
        }
        const recvRaw = receiverName(node.expression.expression);
        if (recvRaw && receivers.has(recvRaw) && RAW.has(method)) {
          rawSql.push({ file: path8, line, method });
        }
      }
      ts2.forEachChild(node, visit);
    };
    visit(sf);
  }
  for (const { path: path8, sf } of parsed) {
    const visit = (node) => {
      if (ts2.isTaggedTemplateExpression(node) && ts2.isPropertyAccessExpression(node.tag)) {
        const recv = receiverName(node.tag.expression);
        if (recv && receivers.has(recv) && RAW.has(node.tag.name.text)) {
          rawSql.push({ file: path8, line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1, method: node.tag.name.text });
        }
      }
      ts2.forEachChild(node, visit);
    };
    visit(sf);
  }
  return { usages, rawSql, receivers: [...receivers] };
}

// src/usage/flows.ts
import ts3 from "typescript";
var HTTP = /* @__PURE__ */ new Set(["get", "post", "put", "patch", "delete"]);
var NEXT_METHODS = /* @__PURE__ */ new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);
var MAX_DEPTH = 5;
var kindFor2 = (path8) => path8.endsWith(".tsx") ? ts3.ScriptKind.TSX : path8.endsWith(".jsx") ? ts3.ScriptKind.JSX : path8.endsWith(".js") || path8.endsWith(".mjs") || path8.endsWith(".cjs") ? ts3.ScriptKind.JS : ts3.ScriptKind.TS;
function nextPagesApiFromFile(file) {
  const m = /(?:^|\/)pages\/(api\/.*)\.(ts|tsx|js|jsx|mjs)$/.exec(file);
  if (!m)
    return null;
  return "/" + m[1].replace(/\/index$/, "");
}
function nextRouteFromFile(file) {
  const m = /(?:^|\/)app\/(.*)\/route\.(ts|tsx|js|jsx|mjs)$/.exec(file) ?? /(?:^|\/)app\/route\.(ts|tsx|js|jsx|mjs)$/.exec(file);
  if (!m)
    return null;
  const dir = m[1] ?? "";
  return "/" + dir.split("/").filter((seg) => !/^\(.*\)$/.test(seg)).join("/");
}
function buildFlows(files, usages) {
  const fns = [];
  const fnByNode = /* @__PURE__ */ new Map();
  const endpoints = [];
  const handlerRefs = [];
  for (const f of files) {
    const sf = ts3.createSourceFile(f.path, f.text, ts3.ScriptTarget.Latest, true, kindFor2(f.path));
    const nextPath = nextRouteFromFile(f.path);
    const collect = (node) => {
      let name = null;
      if ((ts3.isFunctionDeclaration(node) || ts3.isMethodDeclaration(node)) && node.name && ts3.isIdentifier(node.name))
        name = node.name.text;
      if ((ts3.isArrowFunction(node) || ts3.isFunctionExpression(node)) && node.parent && ts3.isVariableDeclaration(node.parent) && ts3.isIdentifier(node.parent.name))
        name = node.parent.name.text;
      if ((ts3.isArrowFunction(node) || ts3.isFunctionExpression(node)) && !name)
        name = `(inline ${f.path}:${sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1})`;
      if (name) {
        const calls = [];
        const scan = (n) => {
          if (ts3.isCallExpression(n)) {
            if (ts3.isIdentifier(n.expression))
              calls.push(n.expression.text);
            else if (ts3.isPropertyAccessExpression(n.expression))
              calls.push(n.expression.name.text);
          }
          ts3.forEachChild(n, scan);
        };
        ts3.forEachChild(node, scan);
        const info = {
          name,
          file: f.path,
          calls,
          startLine: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
          endLine: sf.getLineAndCharacterOfPosition(node.getEnd()).line + 1
        };
        fns.push(info);
        fnByNode.set(node, info);
      }
      ts3.forEachChild(node, collect);
    };
    collect(sf);
    if (nextPath) {
      for (const stmt of sf.statements) {
        if (ts3.isFunctionDeclaration(stmt) && stmt.name && NEXT_METHODS.has(stmt.name.text) && stmt.modifiers?.some((m) => m.kind === ts3.SyntaxKind.ExportKeyword)) {
          const line = sf.getLineAndCharacterOfPosition(stmt.getStart(sf)).line + 1;
          const ep = { method: stmt.name.text, path: nextPath || "/", file: f.path, line, handler: stmt.name.text };
          endpoints.push(ep);
          handlerRefs.push({ endpoint: ep, handlerName: stmt.name.text, inline: null, file: f.path });
        }
      }
    }
    const pagesPath = nextPagesApiFromFile(f.path);
    if (pagesPath) {
      for (const stmt of sf.statements) {
        const isDefault = (ts3.isFunctionDeclaration(stmt) || ts3.isVariableStatement(stmt)) && stmt.modifiers?.some((m) => m.kind === ts3.SyntaxKind.DefaultKeyword);
        if (ts3.isFunctionDeclaration(stmt) && isDefault) {
          const line = sf.getLineAndCharacterOfPosition(stmt.getStart(sf)).line + 1;
          const label = stmt.name?.text ?? "default";
          const ep = { method: "ANY", path: pagesPath, file: f.path, line, handler: label };
          endpoints.push(ep);
          handlerRefs.push({ endpoint: ep, handlerName: stmt.name?.text ?? null, inline: stmt.name ? null : fnByNode.get(stmt) ?? null, file: f.path });
        } else if (ts3.isExportAssignment(stmt) && !stmt.isExportEquals) {
          const line = sf.getLineAndCharacterOfPosition(stmt.getStart(sf)).line + 1;
          const e = stmt.expression;
          const handlerName = ts3.isIdentifier(e) ? e.text : null;
          const inline = ts3.isArrowFunction(e) || ts3.isFunctionExpression(e) ? fnByNode.get(e) ?? null : null;
          const ep = { method: "ANY", path: pagesPath, file: f.path, line, handler: handlerName ?? inline?.name ?? "default" };
          endpoints.push(ep);
          handlerRefs.push({ endpoint: ep, handlerName, inline, file: f.path });
        }
      }
    }
    const visit = (node) => {
      if (ts3.isCallExpression(node) && ts3.isPropertyAccessExpression(node.expression) && HTTP.has(node.expression.name.text)) {
        const [first, ...rest] = node.arguments;
        if (first && ts3.isStringLiteralLike(first) && rest.length) {
          const last = rest[rest.length - 1];
          const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
          const handlerName = ts3.isIdentifier(last) ? last.text : ts3.isPropertyAccessExpression(last) ? last.name.text : null;
          const inlineFn = ts3.isArrowFunction(last) || ts3.isFunctionExpression(last) ? fnByNode.get(last) ?? null : null;
          const label = handlerName ?? (inlineFn ? inlineFn.name : null);
          if (label) {
            const ep = { method: node.expression.name.text.toUpperCase(), path: first.text, file: f.path, line, handler: label };
            endpoints.push(ep);
            handlerRefs.push({ endpoint: ep, handlerName, inline: inlineFn, file: f.path });
          }
        }
      }
      ts3.forEachChild(node, visit);
    };
    visit(sf);
  }
  const byName = /* @__PURE__ */ new Map();
  for (const fn of fns)
    byName.set(fn.name, [...byName.get(fn.name) ?? [], fn]);
  const opsOf = (fn) => {
    const out = [];
    for (const u of usages) {
      if (u.file === fn.file && u.line >= fn.startLine && u.line <= fn.endLine) {
        out.push({ table: u.table, operation: u.operation, method: u.method, file: u.file, line: u.line });
      }
    }
    return out;
  };
  const flows = [];
  for (const { endpoint, handlerName, inline, file } of handlerRefs) {
    const start = inline ?? (byName.get(handlerName ?? "") ?? []).sort((a, b) => (a.file === file ? -1 : 0) - (b.file === file ? -1 : 0))[0];
    if (!start)
      continue;
    const seen = /* @__PURE__ */ new Set();
    const chain = [];
    const ops = /* @__PURE__ */ new Map();
    const queue = [{ fn: start, depth: 0 }];
    const ambiguous = /* @__PURE__ */ new Set();
    while (queue.length) {
      const { fn, depth } = queue.shift();
      const key = `${fn.file}#${fn.name}#${fn.startLine}`;
      if (seen.has(key))
        continue;
      seen.add(key);
      chain.push({ fn: fn.name, file: fn.file });
      for (const o of opsOf(fn))
        ops.set(`${o.file}:${o.line}:${o.method}`, o);
      if (depth >= MAX_DEPTH)
        continue;
      for (const callee of new Set(fn.calls)) {
        const candidates = byName.get(callee) ?? [];
        if (candidates.length === 1)
          queue.push({ fn: candidates[0], depth: depth + 1 });
        else if (candidates.length > 1)
          ambiguous.add(callee);
      }
    }
    if (ops.size)
      flows.push({ endpoint, chain, operations: [...ops.values()], confidence: "inferred", ambiguousCalls: [...ambiguous].sort() });
  }
  return { endpoints, flows };
}

// src/pipeline.ts
import { promises as fs7 } from "node:fs";
var CODE_EXT = /\.(ts|tsx|js|jsx|mjs|cjs)$/;
var MAX_SOURCE_BYTES = 1e6;
async function writeModelArtifacts(outputDir, model) {
  const log = [];
  const files = {
    "data/database.json": JSON.stringify(model, null, 2) + "\n",
    "markdown/database.md": databaseMarkdown(model),
    "index.html": databaseHtml(model)
  };
  let redactions = 0;
  for (const k of Object.keys(files)) {
    const r = redactPatterns(files[k]);
    files[k] = r.text;
    redactions += r.hits.length;
  }
  if (redactions)
    log.push(`Redacted ${redactions} secret-like value(s) from output.`);
  const entries = await writeOutput(outputDir, files);
  const manifest = { tool: { name: "schemasage", version: TOOL_VERSION }, generatedAt: model.generatedAt, files: entries };
  await writeOutput(outputDir, { "manifest.json": JSON.stringify(manifest, null, 2) + "\n" });
  log.push(`Wrote ${entries.length + 1} files to artifacts/schemasage/`);
  return { written: [...entries.map((e) => e.path), "manifest.json"], log };
}
async function inspectDatabase(connectionUrl, outputDir = ".") {
  const log = [];
  let model;
  let adapterName;
  if (connectionUrl.startsWith("postgres://") || connectionUrl.startsWith("postgresql://")) {
    log.push("Connecting to PostgreSQL database...");
    const { introspectPostgres: introspectPostgres2 } = await Promise.resolve().then(() => (init_postgres(), postgres_exports));
    model = await introspectPostgres2(connectionUrl);
    adapterName = "postgres-direct";
  } else if (connectionUrl.startsWith("mongodb://") || connectionUrl.startsWith("mongodb+srv://")) {
    log.push("Connecting to MongoDB database...");
    const { introspectMongo: introspectMongo2 } = await Promise.resolve().then(() => (init_mongo(), mongo_exports));
    model = await introspectMongo2(connectionUrl);
    adapterName = "mongodb-direct";
  } else {
    throw new Error(`Unsupported connection protocol. Supported: postgres://, postgresql://, mongodb://, mongodb+srv://`);
  }
  log.push(`Introspected ${model.tables.length} table(s)/collection(s) and ${model.relationships.length} relationship(s).`);
  const { written, log: writeLog } = await writeModelArtifacts(path7.resolve(outputDir), model);
  log.push(...writeLog);
  return {
    model,
    adapter: adapterName,
    written,
    log
  };
}
async function analyzeRepo(target, opts = {}) {
  const repoRoot = path7.resolve(target);
  const log = [];
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
    const sources = [];
    for (const f of scan.files) {
      if (!CODE_EXT.test(f.path) || f.path.endsWith(".d.ts") || f.size > MAX_SOURCE_BYTES)
        continue;
      sources.push({ path: f.path, text: await fs7.readFile(path7.join(repoRoot, f.path), "utf8") });
    }
    const usage = scanUsage(sources, model.tables.map((t) => t.name));
    const { endpoints, flows } = buildFlows(sources, usage.usages);
    model.application = { receivers: usage.receivers, usages: usage.usages, rawSql: usage.rawSql, endpoints, flows };
    if (usage.rawSql.length)
      model.coverage.unsupported.push(`${usage.rawSql.length} raw SQL call(s) found (prisma.$queryRaw / $executeRaw); not analysed for tables`);
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

// src/cli.ts
init_version();
var USAGE = `SchemaSage ${TOOL_VERSION}
Usage:
  schemasage analyze <repo-path>      Read repo and write artifacts/schemasage/
  schemasage inspect <connection-url> Connect to PostgreSQL or MongoDB directly
  schemasage --help
`;
async function main() {
  const [command, target = "."] = process.argv.slice(2);
  if (!command || command === "--help" || command === "-h") {
    console.log(USAGE);
    return 0;
  }
  if (command === "inspect") {
    if (!target || target === ".") {
      console.error("Error: Please provide a database connection string, e.g.:\n  schemasage inspect postgres://user:pass@localhost:5432/db\n  schemasage inspect mongodb://localhost:27017/db");
      return 1;
    }
    const result = await inspectDatabase(target);
    for (const line of result.log)
      console.log(line);
    if (!result.model)
      return 0;
    const m = result.model;
    console.log(`Tables/Collections: ${m.tables.length}, relationships: ${m.relationships.length}`);
    console.log(`Open artifacts/schemasage/index.html in a browser.`);
    return 0;
  }
  if (command === "analyze") {
    const result = await analyzeRepo(target, { write: true });
    for (const line of result.log)
      console.log(line);
    if (!result.model)
      return 0;
    const m = result.model;
    console.log(`Tables: ${m.tables.length}, relationships: ${m.relationships.length}, findings: ${m.findings.length}`);
    console.log(`Open artifacts/schemasage/index.html in a browser.`);
    return 0;
  }
  console.error(USAGE);
  return 1;
}
main().then((code) => process.exit(code)).catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
