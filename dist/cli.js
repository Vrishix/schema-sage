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

// src/adapters/mongoose/ast-parser.ts
var ast_parser_exports = {};
__export(ast_parser_exports, {
  parseMongooseAST: () => parseMongooseAST
});
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
var init_ast_parser = __esm({
  "src/adapters/mongoose/ast-parser.ts"() {
    "use strict";
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
            enforcement: "orm-declared",
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
      (f) => (f.path.endsWith(".ts") || f.path.endsWith(".js") || f.path.endsWith(".mjs")) && (f.path.includes("models/") || f.path.includes("schema/") || f.path.includes("schemas/") || f.path.endsWith(".model.ts") || f.path.endsWith(".model.js") || f.path.endsWith(".schema.ts") || f.path.endsWith(".schema.js")) && !f.path.includes("node_modules")
    );
  },
  async extract(repoRoot, files) {
    const { parseMongooseAST: parseMongooseAST2 } = await Promise.resolve().then(() => (init_ast_parser(), ast_parser_exports));
    const candidateFiles = files.filter(
      (f) => (f.path.endsWith(".ts") || f.path.endsWith(".js") || f.path.endsWith(".mjs")) && !f.path.endsWith(".d.ts") && !f.path.includes("node_modules") && (f.path.includes("model") || f.path.includes("schema") || f.path.includes("entity") || f.path.includes("entities"))
    );
    const allSchemas = [];
    const scannedPaths = [];
    for (const file of candidateFiles) {
      try {
        const content = await fs4.readFile(path4.join(repoRoot, file.path), "utf8");
        if (content.includes("Schema") || content.includes("model") || content.includes("mongoose") || content.includes("@prop")) {
          const parsed = parseMongooseAST2(content, file.path);
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
  sqlalchemyAdapter,
  mongooseAdapter,
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
var BOX_W = 250;
var HEAD = 38;
var ROW = 22;
var PAD = 10;
var GAP_X = 110;
var GAP_Y = 40;
var MARGIN = 30;
var COLS = 6;
var MAX_PER_COL = 8;
var BAND_GAP = 60;
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
    nodes.set(t.name, {
      table: t,
      h: HEAD + t.columns.length * ROW + PAD * 2,
      layer: layerOf.get(t.name) ?? 0,
      order: 0,
      x: 0,
      y: 0
    });
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
  const vCols = [];
  for (let L = 0; L <= maxLayer; L++) {
    const list = columns[L];
    for (let i = 0; i < list.length; i += MAX_PER_COL) {
      const chunk = list.slice(i, i + MAX_PER_COL);
      const vColIdx = vCols.length;
      vCols.push({ band: Math.floor(vColIdx / COLS), colInBand: vColIdx % COLS, nodes: chunk });
    }
  }
  const bandCount = Math.max(1, ...vCols.map((c) => c.band + 1));
  const bandHeights = new Array(bandCount).fill(0);
  for (const c of vCols) {
    const colH = c.nodes.reduce((sum, node) => sum + node.h, 0) + Math.max(0, c.nodes.length - 1) * GAP_Y;
    bandHeights[c.band] = Math.max(bandHeights[c.band], colH);
  }
  const bandTop = new Array(bandCount).fill(MARGIN);
  for (let b = 1; b < bandCount; b++) {
    bandTop[b] = bandTop[b - 1] + bandHeights[b - 1] + BAND_GAP;
  }
  for (const c of vCols) {
    const x = MARGIN + c.colInBand * (BOX_W + GAP_X);
    let y = bandTop[c.band];
    for (const node of c.nodes) {
      node.x = x;
      node.y = y;
      y += node.h + GAP_Y;
    }
  }
  const colY = (node, colName) => {
    const idx = node.table.columns.findIndex((c) => c.name === colName);
    if (idx < 0)
      return node.y + HEAD / 2;
    return node.y + HEAD + PAD + idx * ROW + ROW / 2;
  };
  const maxX = Math.max(...[...nodes.values()].map((n2) => n2.x + BOX_W)) + MARGIN;
  const maxY = Math.max(...[...nodes.values()].map((n2) => n2.y + n2.h)) + MARGIN;
  const parts = [
    `<svg class="erd-canvas" viewBox="0 0 ${maxX} ${maxY}" width="${maxX}" height="${maxY}" xmlns="http://www.w3.org/2000/svg">`,
    `<defs>
      <filter id="shadow" x="-5%" y="-5%" width="110%" height="115%">
        <feDropShadow dx="0" dy="4" stdDeviation="6" flood-opacity="0.08"/>
      </filter>
    </defs>`
  ];
  model.relationships.forEach((rel, idx) => {
    const [fromT, fromC] = rel.from.replace(/^column:/, "").split(".");
    const [toT, toC] = rel.to.replace(/^column:/, "").split(".");
    const a = nodes.get(fromT);
    const b = nodes.get(toT);
    if (!a || !b)
      return;
    const ay = colY(a, fromC);
    const by = colY(b, toC);
    const label = rel.cardinality === "one-to-one" ? "1:1" : rel.cardinality === "many-to-many" ? "N:N" : "1:N";
    const dash = rel.enforcement === "orm-declared" ? 'stroke-dasharray="5 4"' : "";
    const evidenceFile = rel.evidence[0]?.file ?? "";
    const evidenceLine = rel.evidence[0]?.lines?.[0] ?? "";
    const evidenceStr = evidenceFile ? `${evidenceFile}:${evidenceLine}` : "";
    const common = `class="edge ${rel.enforcement}" ${dash} data-from="${esc(fromT)}" data-to="${esc(toT)}" data-rel-id="${idx}" data-from-col="${esc(fromC)}" data-to-col="${esc(toC)}" data-card="${esc(rel.cardinality)}" data-enf="${esc(rel.enforcement)}" data-src="${esc(evidenceStr)}"`;
    let d;
    let mx;
    let my;
    if (a === b) {
      const x = a.x + BOX_W;
      d = `M${x},${ay} C${x + 65},${ay - 30} ${x + 65},${by + 30} ${x},${by}`;
      mx = x + 45;
      my = (ay + by) / 2;
    } else if (a.x > b.x) {
      const ax = a.x;
      const bx = b.x + BOX_W;
      const dx = Math.max(35, (ax - bx) / 2);
      d = `M${ax},${ay} C${ax - dx},${ay} ${bx + dx},${by} ${bx},${by}`;
      mx = (ax + bx) / 2;
      my = (ay + by) / 2;
    } else if (a.x < b.x) {
      const ax = a.x + BOX_W;
      const bx = b.x;
      const dx = Math.max(35, (bx - ax) / 2);
      d = `M${ax},${ay} C${ax + dx},${ay} ${bx - dx},${by} ${bx},${by}`;
      mx = (ax + bx) / 2;
      my = (ay + by) / 2;
    } else {
      const ax = a.x + BOX_W;
      d = `M${ax},${ay} C${ax + 55},${ay} ${ax + 55},${by} ${ax},${by}`;
      mx = ax + 28;
      my = (ay + by) / 2;
    }
    parts.push(
      `<g class="edge-group" data-rel="${idx}" data-from="${esc(fromT)}" data-to="${esc(toT)}" data-from-col="${esc(fromC)}" data-to-col="${esc(toC)}" data-card="${esc(rel.cardinality)}" data-enf="${esc(rel.enforcement)}" data-src="${esc(evidenceStr)}"><a href="#rel-${idx}" aria-label="${esc(rel.from)} to ${esc(rel.to)}, ${esc(rel.enforcement)}"><path d="${d}" ${common} fill="none"/><circle cx="${mx}" cy="${my}" r="11" class="edge-bubble"/><text x="${mx}" y="${my + 4}" text-anchor="middle" class="edge-label">${label}</text></a></g>`
    );
  });
  for (const node of nodes.values()) {
    const t = node.table;
    parts.push(`<g id="erd-${esc(t.name)}" class="entity" data-name="${esc(t.name.toLowerCase())}" filter="url(#shadow)">`);
    parts.push(`<rect x="${node.x}" y="${node.y}" width="${BOX_W}" height="${node.h}" rx="10" class="box"/>`);
    parts.push(`<rect x="${node.x}" y="${node.y}" width="${BOX_W}" height="${HEAD}" rx="10" class="box-head"/>`);
    parts.push(`<text x="${node.x + 14}" y="${node.y + 24}" class="table-name">${esc(t.name)}</text>`);
    parts.push(`<text x="${node.x + BOX_W - 14}" y="${node.y + 24}" text-anchor="end" class="table-count">${t.columns.length} cols</text>`);
    t.columns.forEach((c, i) => {
      const yy = node.y + HEAD + PAD + i * ROW + 15;
      const isPk = c.isPrimaryKey;
      const isUq = c.isUnique && !isPk;
      const badge = isPk ? "PK" : isUq ? "UQ" : "";
      const colClass = isPk ? "col pk" : isUq ? "col uq" : "col";
      if (badge) {
        parts.push(`<rect x="${node.x + 10}" y="${yy - 11}" width="${badge === "PK" ? 22 : 24}" height="14" rx="3" class="badge-bg ${isPk ? "badge-pk" : "badge-uq"}"/>`);
        parts.push(`<text x="${node.x + (badge === "PK" ? 21 : 22)}" y="${yy}" text-anchor="middle" class="badge-text">${badge}</text>`);
        parts.push(`<text x="${node.x + 38}" y="${yy}" class="${colClass}">${esc(c.name)}</text>`);
      } else {
        parts.push(`<text x="${node.x + 14}" y="${yy}" class="${colClass}">${esc(c.name)}</text>`);
      }
      parts.push(`<text x="${node.x + BOX_W - 14}" y="${yy}" text-anchor="end" class="col-type">${esc(c.type + (c.nullable ? "?" : ""))}</text>`);
    });
    parts.push(`</g>`);
  }
  parts.push(`</svg>`);
  return parts.join("\n");
}
var ERD_CSS = `
.erd-wrap {
  position: relative;
  overflow: hidden;
  max-height: 82vh;
  min-height: 520px;
  border: 1px solid var(--card-border);
  border-radius: 16px;
  background: var(--canvas-bg);
  padding: 16px;
  cursor: grab;
  box-shadow: inset 0 2px 6px rgba(0,0,0,0.02);
}
.erd-canvas {
  display: block;
  font-family: inherit;
  transition: transform 0.15s ease-out;
}
.erd-wrap .box {
  fill: var(--card-bg);
  stroke: var(--card-border);
  stroke-width: 1.5;
  transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
}
.erd-wrap .box-head {
  fill: var(--card-head);
  stroke: var(--card-border);
  stroke-width: 1.5;
}
.erd-wrap .table-name {
  font-weight: 700;
  font-size: 13px;
  fill: var(--fg);
}
.erd-wrap .table-count {
  font-size: 11px;
  font-weight: 500;
  fill: var(--muted);
}
.erd-wrap .col {
  font-size: 12px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  fill: var(--fg);
}
.erd-wrap .col.pk {
  font-weight: 600;
  fill: var(--accent);
}
.erd-wrap .col.uq {
  font-weight: 600;
}
.erd-wrap .col-type {
  font-size: 11px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  fill: var(--muted);
}
.erd-wrap .badge-bg {
  opacity: 0.9;
}
.erd-wrap .badge-pk {
  fill: var(--accent-light);
}
.erd-wrap .badge-uq {
  fill: var(--amber-light);
}
.erd-wrap .badge-text {
  font-size: 9px;
  font-weight: 700;
  font-family: system-ui, sans-serif;
  fill: var(--accent-dark);
}
.erd-wrap .edge-bubble {
  fill: var(--card-bg);
  stroke: var(--line);
  stroke-width: 1.2;
}
.erd-wrap .edge-label {
  font-size: 9.5px;
  font-weight: 600;
  font-family: system-ui, sans-serif;
  fill: var(--muted);
}
.erd-wrap .edge {
  stroke-width: 1.8;
  cursor: pointer;
  transition: stroke 0.2s, stroke-width 0.2s, opacity 0.2s;
}
.erd-wrap .edge.db-enforced {
  stroke: var(--solid);
}
.erd-wrap .edge.orm-declared {
  stroke: var(--dash);
}
.erd-wrap .entity {
  cursor: pointer;
  transition: transform 0.2s, opacity 0.2s;
}
.erd-wrap .entity:hover {
  transform: translateY(-2px);
}
.erd-wrap .entity:hover .box {
  stroke: var(--accent);
  stroke-width: 2.2;
  box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.1);
}
.erd-wrap .edge-group {
  cursor: pointer;
}
.erd-wrap .edge-group:hover .edge {
  stroke: var(--accent-hover);
  stroke-width: 4;
}
`;

// src/generator/html.ts
import { createHash as createHash2 } from "node:crypto";
var FILTER_SCRIPT = `(function(){
  // 1. Search & Filter across table cards, ERD entities, and Sidebar links
  var filterInput = document.getElementById("filter");
  var sidebarFilter = document.getElementById("sidebarSearch");

  function handleFilter(q) {
    q = q.trim().toLowerCase();
    document.querySelectorAll(".table-card").forEach(function(card) {
      var name = (card.getAttribute("data-table") || "").toLowerCase();
      card.style.display = (q === "" || name.indexOf(q) >= 0) ? "" : "none";
    });
    document.querySelectorAll("g.entity").forEach(function(g) {
      var name = (g.getAttribute("data-name") || "").toLowerCase();
      g.style.display = (q === "" || name.indexOf(q) >= 0) ? "" : "none";
    });
    document.querySelectorAll(".table-item").forEach(function(item) {
      var name = (item.getAttribute("data-table") || "").toLowerCase();
      item.style.display = (q === "" || name.indexOf(q) >= 0) ? "flex" : "none";
    });
  }

  if(filterInput) {
    filterInput.addEventListener("input", function() {
      if(sidebarFilter) sidebarFilter.value = filterInput.value;
      handleFilter(filterInput.value);
    });
  }
  if(sidebarFilter) {
    sidebarFilter.addEventListener("input", function() {
      if(filterInput) filterInput.value = sidebarFilter.value;
      handleFilter(sidebarFilter.value);
    });
  }

  // 2. Sidebar Toggle
  var sidebar = document.getElementById("sidebar");
  var menuToggle = document.getElementById("menuToggle");

  function toggleSidebar() {
    if(!sidebar) return;
    sidebar.classList.toggle("collapsed");
  }

  if(menuToggle) menuToggle.onclick = toggleSidebar;

  // 3. Pan and Zoom controls for ERD
  var currentScale = 1;
  var panX = 0, panY = 0;
  var isPanning = false;
  var startX = 0, startY = 0;
  var canvas = document.querySelector(".erd-canvas");
  var wrap = document.getElementById("visualCanvas");

  function applyTransform() {
    if(!canvas) return;
    canvas.style.transform = "translate(" + panX + "px, " + panY + "px) scale(" + currentScale + ")";
    canvas.style.transformOrigin = "top left";
    var scaleIndicator = document.getElementById("zoomLevel");
    if(scaleIndicator) scaleIndicator.textContent = Math.round(currentScale * 100) + "%";
  }

  window.zoomErd = function(delta) {
    currentScale = Math.min(3, Math.max(0.2, currentScale + delta));
    applyTransform();
  };
  window.resetZoom = function() {
    currentScale = 1;
    panX = 0;
    panY = 0;
    applyTransform();
  };

  var btnIn = document.getElementById("zoomIn");
  var btnOut = document.getElementById("zoomOut");
  var btnReset = document.getElementById("zoomReset");
  if(btnIn) btnIn.onclick = function(){ zoomErd(0.15); };
  if(btnOut) btnOut.onclick = function(){ zoomErd(-0.15); };
  if(btnReset) btnReset.onclick = function(){ resetZoom(); };

  if(wrap && canvas) {
    wrap.addEventListener("mousedown", function(e) {
      if(e.target.closest(".edge-group") || e.target.closest(".entity")) return;
      isPanning = true;
      startX = e.clientX - panX;
      startY = e.clientY - panY;
      wrap.style.cursor = "grabbing";
    });
    window.addEventListener("mousemove", function(e) {
      if(!isPanning) return;
      panX = e.clientX - startX;
      panY = e.clientY - startY;
      applyTransform();
    });
    window.addEventListener("mouseup", function() {
      isPanning = false;
      if(wrap) wrap.style.cursor = "grab";
    });
    wrap.addEventListener("wheel", function(e) {
      if(e.ctrlKey || e.metaKey) {
        e.preventDefault();
        var delta = e.deltaY < 0 ? 0.1 : -0.1;
        zoomErd(delta);
      }
    });
  }

  // 4. Archify-Style Relationship Inspector Tooltip
  var tooltip = document.getElementById("rel-tooltip");

  function showRelTooltip(e, fromT, toT, fromC, toC, card, enf, src) {
    if(!tooltip) return;
    var badgeClass = enf === "db-enforced" ? "solid" : "dashed";
    var enfText = enf === "db-enforced" ? "Database Enforced (Foreign Key)" : "ORM Declared (Application Virtual)";
    
    tooltip.innerHTML = 
      '<div class="tt-header">' +
        '<span class="tt-title">Relationship Link</span>' +
        '<span class="tt-badge ' + badgeClass + '">' + card + '</span>' +
      '</div>' +
      '<div class="tt-body">' +
        '<div class="tt-flow">' +
          '<div class="tt-endpoint">' +
            '<span class="tt-table">' + fromT + '</span>' +
            '<span class="tt-col">.' + fromC + '</span>' +
          '</div>' +
          '<div class="tt-arrow">\u2192</div>' +
          '<div class="tt-endpoint">' +
            '<span class="tt-table">' + toT + '</span>' +
            '<span class="tt-col">.' + toC + '</span>' +
          '</div>' +
        '</div>' +
        '<div class="tt-meta">' +
          '<div class="tt-meta-item"><strong>Enforcement:</strong> <span>' + enfText + '</span></div>' +
          (src ? '<div class="tt-meta-item"><strong>Source:</strong> <code>' + src + '</code></div>' : '') +
        '</div>' +
      '</div>';

    tooltip.style.display = "block";
    updateTooltipPos(e);
  }

  function updateTooltipPos(e) {
    if(!tooltip || tooltip.style.display !== "block") return;
    var x = e.clientX + 16;
    var y = e.clientY + 16;
    var w = tooltip.offsetWidth || 300;
    var h = tooltip.offsetHeight || 160;
    if(x + w > window.innerWidth - 20) x = e.clientX - w - 16;
    if(y + h > window.innerHeight - 20) y = e.clientY - h - 16;
    tooltip.style.left = x + "px";
    tooltip.style.top = y + "px";
  }

  function hideRelTooltip() {
    if(tooltip) tooltip.style.display = "none";
  }

  document.querySelectorAll(".edge-group").forEach(function(group) {
    group.addEventListener("mouseenter", function(e) {
      var fromT = group.getAttribute("data-from") || "";
      var toT = group.getAttribute("data-to") || "";
      var fromC = group.getAttribute("data-from-col") || "";
      var toC = group.getAttribute("data-to-col") || "";
      var card = group.getAttribute("data-card") || "";
      var enf = group.getAttribute("data-enf") || "";
      var src = group.getAttribute("data-src") || "";

      document.querySelectorAll(".edge").forEach(function(edge) {
        edge.style.opacity = "0.1";
      });
      var edgeEl = group.querySelector(".edge");
      if(edgeEl) {
        edgeEl.style.opacity = "1";
        edgeEl.style.strokeWidth = "4";
      }
      showRelTooltip(e, fromT, toT, fromC, toC, card, enf, src);
    });

    group.addEventListener("mousemove", function(e) {
      updateTooltipPos(e);
    });

    group.addEventListener("mouseleave", function() {
      document.querySelectorAll(".edge").forEach(function(edge) {
        edge.style.strokeWidth = "";
        edge.style.opacity = "1";
      });
      hideRelTooltip();
    });

    group.addEventListener("click", function() {
      var relIdx = group.getAttribute("data-rel");
      var target = document.getElementById("rel-" + relIdx);
      if(target) {
        target.scrollIntoView({ behavior: "smooth", block: "center" });
        target.classList.add("highlight-flash");
        setTimeout(function(){ target.classList.remove("highlight-flash"); }, 2000);
      }
    });
  });

  // 5. Highlight connections on entity hover & click to jump
  document.querySelectorAll("g.entity").forEach(function(el) {
    var tableName = el.getAttribute("data-name");
    el.addEventListener("mouseenter", function() {
      document.querySelectorAll(".edge").forEach(function(edge) {
        var from = (edge.getAttribute("data-from") || "").toLowerCase();
        var to = (edge.getAttribute("data-to") || "").toLowerCase();
        if(from === tableName || to === tableName) {
          edge.style.strokeWidth = "3.8";
          edge.style.opacity = "1";
        } else {
          edge.style.opacity = "0.12";
        }
      });
    });
    el.addEventListener("mouseleave", function() {
      document.querySelectorAll(".edge").forEach(function(edge) {
        edge.style.strokeWidth = "";
        edge.style.opacity = "1";
      });
    });

    el.addEventListener("click", function() {
      jumpToTable(tableName);
    });
  });

  // 6. Jump to Table Card with visual flash
  window.jumpToTable = function(tableName) {
    var target = document.getElementById(tableName + "-card") || document.getElementById(tableName);
    if(target) {
      target.scrollIntoView({ behavior: "smooth", block: "center" });
      target.style.transition = "border-color 0.3s, box-shadow 0.3s";
      target.style.borderColor = "var(--accent-blue)";
      target.style.boxShadow = "0 0 0 4px var(--accent-blue-soft)";
      setTimeout(function(){
        target.style.borderColor = "";
        target.style.boxShadow = "";
      }, 1500);

      document.querySelectorAll(".table-item").forEach(function(it) {
        it.classList.toggle("active", (it.getAttribute("data-table") || "").toLowerCase() === tableName.toLowerCase());
      });
    }
  };

  document.querySelectorAll(".table-item").forEach(function(item) {
    item.addEventListener("click", function(e) {
      e.preventDefault();
      var tName = item.getAttribute("data-table");
      jumpToTable(tName);
    });
  });

  // 7. Diagram View Mode Switcher (Visual Canvas vs Mermaid Code)
  var tabVisual = document.getElementById("viewVisualBtn");
  var tabMermaid = document.getElementById("viewMermaidBtn");
  var viewVisual = document.getElementById("visualCanvas");
  var viewMermaid = document.getElementById("mermaidView");

  if(tabVisual && tabMermaid && viewVisual && viewMermaid) {
    tabVisual.onclick = function() {
      tabVisual.classList.add("active");
      tabMermaid.classList.remove("active");
      viewVisual.style.display = "block";
      viewMermaid.style.display = "none";
    };
    tabMermaid.onclick = function() {
      tabMermaid.classList.add("active");
      tabVisual.classList.remove("active");
      viewVisual.style.display = "none";
      viewMermaid.style.display = "block";
    };
  }

  // 8. Copy Mermaid Code
  var copyBtn = document.getElementById("copyMermaid");
  if(copyBtn) {
    copyBtn.onclick = function() {
      var code = document.getElementById("mermaidCode");
      if(code) {
        navigator.clipboard.writeText(code.textContent).then(function() {
          copyBtn.textContent = "Copied!";
          setTimeout(function(){ copyBtn.textContent = "Copy"; }, 2000);
        });
      }
    };
  }
})();`;
var FILTER_HASH = "sha256-" + createHash2("sha256").update(FILTER_SCRIPT).digest("base64");
function generateMermaidEr(m) {
  const lines = ["erDiagram"];
  for (const t of m.tables) {
    lines.push(`    ${t.name} {`);
    for (const c of t.columns) {
      const typeClean = c.type.replace(/[^a-zA-Z0-9_]/g, "_");
      const keyType = c.isPrimaryKey ? "PK" : c.isUnique ? "UK" : "";
      lines.push(`        ${typeClean} ${c.name} ${keyType}`);
    }
    lines.push(`    }`);
  }
  for (const r of m.relationships) {
    const fromT = r.from.replace(/^column:/, "").split(".")[0];
    const toT = r.to.replace(/^column:/, "").split(".")[0];
    let relSymbol = "||--o{";
    if (r.cardinality === "one-to-one")
      relSymbol = "||--||";
    if (r.cardinality === "many-to-many")
      relSymbol = "}o--o{";
    lines.push(`    ${toT} ${relSymbol} ${fromT} : "${r.enforcement}"`);
  }
  return lines.join("\n");
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
  const rows = [...byTable.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([t, e]) => `<tr><td><strong>${esc(t)}</strong></td><td>${e.read}</td><td>${e.write}</td><td>${e.delete}</td><td>${e.places.map((p) => `<code>${esc(p)}</code>`).join("<br>")}</td></tr>`).join("");
  const flows = app.flows.map((f) => `<tr><td><code>${esc(f.endpoint.method)} ${esc(f.endpoint.path)}</code></td><td>${esc(f.endpoint.handler)}<br><code>${esc(f.endpoint.file)}:${f.endpoint.line}</code></td><td>${f.chain.map((c) => esc(c.fn)).join(" \u2192 ")}</td><td>${f.operations.map((o) => `${esc(o.operation)} <strong>${esc(o.table)}</strong> <code>${esc(o.file)}:${o.line}</code>`).join("<br>")}${f.ambiguousCalls.length ? `<br><em>Not followed: ${f.ambiguousCalls.map(esc).join(", ")}</em>` : ""}</td></tr>`).join("");
  return `
  <div class="section-header" id="usage">
    <h2>Application usage</h2>
  </div>
  <div class="table-card">
    <table class="mini-table"><thead><tr><th>Table</th><th>Reads</th><th>Writes</th><th>Deletes</th><th>Where</th></tr></thead><tbody>${rows || "<tr><td colspan=5>No calls found.</td></tr>"}</tbody></table>
  </div>
  <div class="section-header" id="flows">
    <h2>Flows</h2>
  </div>
  <div class="table-card">
    <table class="mini-table"><thead><tr><th>Endpoint</th><th>Handler</th><th>Call Chain</th><th>Database Operations</th></tr></thead><tbody>${flows || "<tr><td colspan=4>No flows mapped.</td></tr>"}</tbody></table>
  </div>
  `;
}
function databaseHtml(m) {
  const mermaidCode = generateMermaidEr(m);
  const tableCards = m.tables.map((t) => {
    return `
    <div class="table-card" id="${esc(t.name)}-card" data-table="${esc(t.name)}">
      <div class="table-card-header">
        <div class="table-card-title">
          <span class="icon-circle">\u2637</span>
          <h3>${esc(t.name)}</h3>
          ${t.dbName && t.dbName !== t.name ? `<span class="col-badge" style="background:var(--bg-code); margin-left:8px;">mapped: ${esc(t.dbName)}</span>` : ""}
        </div>
        <span class="col-badge">${t.columns.length} columns</span>
      </div>
      <table class="mini-table">
        <thead>
          <tr>
            <th>Column</th>
            <th>Type</th>
            <th>Constraints</th>
            <th>Source Evidence</th>
          </tr>
        </thead>
        <tbody>
        ${t.columns.map((c) => {
      const isPk = c.isPrimaryKey;
      const isUq = c.isUnique && !isPk;
      const isNull = c.nullable;
      return `
          <tr>
            <td style="font-weight:600;">
              ${esc(c.name)}
              ${isPk ? `<span class="tag tag-pk">PK</span>` : ""}
              ${isUq ? `<span class="tag tag-uq">UQ</span>` : ""}
            </td>
            <td><code>${esc(c.type)}</code></td>
            <td>
              <span class="tag" style="background:${isNull ? "var(--bg-code)" : "rgba(13,148,136,0.12)"}; color:${isNull ? "var(--text-muted)" : "var(--accent-teal)"}">${isNull ? "nullable" : "not null"}</span>
              ${c.default ? `<span style="font-size:11px; color:var(--text-muted); margin-left:6px;">default: <code>${esc(c.default)}</code></span>` : ""}
            </td>
            <td style="font-size:11px; color:var(--text-muted);">
              <code>${esc(c.evidence[0]?.file ?? "")}:${c.evidence[0]?.lines?.[0] ?? ""}</code>
            </td>
          </tr>`;
    }).join("")}
        </tbody>
      </table>
    </div>`;
  }).join("");
  const sidebarItems = m.tables.map((t, idx) => `
    <a href="#${esc(t.name)}" class="table-item ${idx === 0 ? "active" : ""}" data-table="${esc(t.name)}">
      <span>\u2637 ${esc(t.name)}</span>
      <span class="count">${t.columns.length}</span>
    </a>
  `).join("");
  const relRows = m.relationships.map((r, idx) => `
    <tr id="rel-${idx}">
      <td><code style="font-weight:600;">${esc(r.from)}</code></td>
      <td style="text-align:center; color:var(--text-muted);">\u2192</td>
      <td><code style="font-weight:600;">${esc(r.to)}</code></td>
      <td><span class="tag tag-uq">${esc(r.cardinality)}</span></td>
      <td><span class="tag ${r.enforcement === "db-enforced" ? "tag-fk" : "tag-uq"}" style="${r.enforcement === "db-enforced" ? "background:rgba(13,148,136,0.14); color:var(--accent-teal);" : "background:rgba(217,119,6,0.14); color:var(--accent-amber);"}">${esc(r.enforcement)}</span></td>
    </tr>
  `).join("");
  const findings = m.findings.length ? m.findings.map((f) => `
      <div class="stat-card" style="margin-bottom:12px; border-left:4px solid var(--accent-blue);">
        <div style="font-weight:700; font-size:14px; margin-bottom:4px;">${esc(f.category)}</div>
        <p style="font-size:13px; color:var(--text-secondary); margin:0 0 6px;">${esc(f.explanation)}</p>
        <div style="font-size:12px; font-weight:500;">\u{1F4A1} ${esc(f.recommendation)}</div>
      </div>`).join("") : `<div class="empty-findings">
        <span style="color:var(--accent-teal); font-size:24px; margin-bottom:8px; display:block;">\u2714</span>
        No issues detected \u2014 all schemas, relations, and primary keys are fully consistent.
      </div>`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src '${FILTER_HASH}'; img-src 'self' data:">
  <title>SchemaSage \xB7 Architecture &amp; ER Explorer</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    :root {
      --font-sans: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      --font-mono: 'SF Mono', 'Fira Code', 'Cascadia Code', 'Consolas', monospace;

      --bg-body: #f7f9fc;
      --bg-surface: #ffffff;
      --bg-sidebar: #ffffff;
      --bg-canvas: #f0f4fa;
      --bg-hover: #eef2f6;
      --bg-code: #f1f5f9;

      --text-primary: #0b1b33;
      --text-secondary: #4b5e77;
      --text-muted: #7a8ba0;

      --border-light: #e2e9f2;
      --border-focus: #3b82f6;

      --accent-blue: #2563eb;
      --accent-blue-soft: #dbeafe;
      --accent-teal: #0d9488;
      --accent-amber: #d97706;
      --accent-rose: #e11d48;

      --shadow-sm: 0 2px 6px rgba(0, 0, 0, 0.02), 0 1px 2px rgba(0, 0, 0, 0.03);
      --shadow-md: 0 8px 20px -6px rgba(0, 20, 40, 0.08);
      --radius-lg: 18px;
      --radius-md: 12px;
      --radius-sm: 8px;

      --sidebar-width: 270px;
    }

    @media (prefers-color-scheme: dark) {
      :root {
        --bg-body: #0b1018;
        --bg-surface: #121a26;
        --bg-sidebar: #0f1621;
        --bg-canvas: #0a111c;
        --bg-hover: #1a2535;
        --bg-code: #1a2332;

        --text-primary: #edf2f9;
        --text-secondary: #a7bbd4;
        --text-muted: #6a7f9b;

        --border-light: #1f2c3d;
        --border-focus: #60a5fa;

        --accent-blue: #60a5fa;
        --accent-blue-soft: #1e3a5f;
        --accent-teal: #2dd4bf;
        --accent-amber: #fbbf24;
        --accent-rose: #fb7185;

        --shadow-sm: 0 2px 8px rgba(0, 0, 0, 0.4);
        --shadow-md: 0 12px 24px -8px rgba(0, 0, 0, 0.6);
      }
    }

    body {
      font-family: var(--font-sans);
      background: var(--bg-body);
      color: var(--text-primary);
      line-height: 1.5;
      display: flex;
      min-height: 100vh;
    }

    /* Sidebar */
    .sidebar {
      width: var(--sidebar-width);
      background: var(--bg-sidebar);
      border-right: 1px solid var(--border-light);
      display: flex;
      flex-direction: column;
      height: 100vh;
      position: sticky;
      top: 0;
      transition: transform 0.2s ease, margin-right 0.2s ease;
      z-index: 20;
      flex-shrink: 0;
    }

    .sidebar.collapsed {
      transform: translateX(calc(-1 * var(--sidebar-width)));
      margin-right: calc(-1 * var(--sidebar-width));
    }

    .sidebar-header {
      padding: 20px 16px 12px;
      border-bottom: 1px solid var(--border-light);
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    .logo-badge {
      font-weight: 800;
      font-size: 13px;
      background: linear-gradient(135deg, var(--accent-blue), #06b6d4);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      letter-spacing: -0.3px;
    }

    .sidebar-search {
      padding: 14px 12px 10px;
    }

    .sidebar-search input {
      width: 100%;
      padding: 8px 12px;
      border: 1px solid var(--border-light);
      border-radius: 40px;
      background: var(--bg-code);
      font-size: 13px;
      color: var(--text-primary);
      outline: none;
      transition: border 0.15s, box-shadow 0.15s;
    }

    .sidebar-search input:focus {
      border-color: var(--border-focus);
      box-shadow: 0 0 0 3px var(--accent-blue-soft);
    }

    .sidebar-list {
      flex: 1;
      overflow-y: auto;
      padding: 8px 8px 20px;
      display: flex;
      flex-direction: column;
      gap: 2px;
    }

    .table-item {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 8px 12px;
      border-radius: var(--radius-sm);
      color: var(--text-secondary);
      font-size: 13px;
      font-weight: 500;
      text-decoration: none;
      transition: all 0.1s;
      white-space: nowrap;
    }

    .table-item:hover {
      background: var(--bg-hover);
      color: var(--text-primary);
    }

    .table-item.active {
      background: var(--accent-blue-soft);
      color: var(--accent-blue);
      font-weight: 600;
    }

    .table-item .count {
      font-size: 11px;
      background: var(--border-light);
      padding: 1px 7px;
      border-radius: 20px;
      color: var(--text-muted);
      font-weight: 500;
      margin-left: 8px;
    }

    /* Main Area */
    .main-wrapper {
      flex: 1;
      display: flex;
      flex-direction: column;
      min-width: 0;
    }

    .top-bar {
      background: var(--bg-surface);
      border-bottom: 1px solid var(--border-light);
      padding: 12px 24px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 12px;
      position: sticky;
      top: 0;
      z-index: 15;
      backdrop-filter: blur(8px);
    }

    .brand-area {
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .menu-toggle {
      background: transparent;
      border: 1px solid var(--border-light);
      border-radius: var(--radius-sm);
      padding: 6px 10px;
      font-size: 16px;
      cursor: pointer;
      color: var(--text-primary);
      transition: background 0.1s;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .menu-toggle:hover {
      background: var(--bg-hover);
    }

    .title-block h1 {
      font-size: 18px;
      font-weight: 700;
      letter-spacing: -0.3px;
      line-height: 1.3;
    }

    .subtitle {
      font-size: 12px;
      color: var(--text-muted);
      display: flex;
      align-items: center;
      gap: 6px;
      margin-top: 2px;
    }

    .subtitle span {
      background: var(--bg-code);
      padding: 1px 6px;
      border-radius: 6px;
      font-family: var(--font-mono);
      font-size: 11px;
    }

    .nav-links {
      display: flex;
      gap: 4px;
      flex-wrap: wrap;
    }

    .nav-links a {
      color: var(--text-secondary);
      text-decoration: none;
      font-size: 13px;
      font-weight: 500;
      padding: 6px 12px;
      border-radius: 40px;
      transition: background 0.1s, color 0.1s;
    }

    .nav-links a:hover {
      background: var(--bg-hover);
      color: var(--text-primary);
    }

    main {
      flex: 1;
      padding: 24px 28px 48px;
      max-width: 1440px;
      margin: 0 auto;
      width: 100%;
    }

    /* Guide banner */
    .guide-banner {
      background: linear-gradient(105deg, var(--accent-blue-soft) 0%, transparent 90%);
      border: 1px solid var(--border-light);
      border-radius: var(--radius-lg);
      padding: 18px 24px;
      margin-bottom: 28px;
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 24px;
    }

    .guide-banner .guide-icon {
      font-size: 26px;
      color: var(--accent-blue);
    }

    .guide-text {
      flex: 1;
      font-size: 13.5px;
      color: var(--text-secondary);
    }

    .guide-text strong {
      color: var(--text-primary);
      font-weight: 600;
    }

    .guide-badge {
      background: var(--bg-surface);
      border: 1px solid var(--border-light);
      border-radius: 40px;
      padding: 6px 14px;
      font-size: 12px;
      font-weight: 500;
      display: flex;
      align-items: center;
      gap: 8px;
      white-space: nowrap;
    }

    .dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      display: inline-block;
    }
    .dot.green { background: var(--accent-teal); }
    .dot.amber { background: var(--accent-amber); }

    /* Stats row */
    .stats-row {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
      gap: 16px;
      margin-bottom: 32px;
    }

    .stat-card {
      background: var(--bg-surface);
      border: 1px solid var(--border-light);
      border-radius: var(--radius-md);
      padding: 16px 18px;
      box-shadow: var(--shadow-sm);
    }

    .stat-label {
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.6px;
      color: var(--text-muted);
      font-weight: 600;
      margin-bottom: 6px;
    }

    .stat-value {
      font-size: 26px;
      font-weight: 800;
      letter-spacing: -0.5px;
      line-height: 1.1;
    }

    .stat-value small {
      font-size: 13px;
      font-weight: 500;
      color: var(--text-muted);
      margin-left: 6px;
    }

    /* Diagram Section */
    .section-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 12px;
      margin: 32px 0 16px;
    }

    .section-header h2 {
      font-size: 17px;
      font-weight: 700;
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .diagram-controls {
      display: flex;
      align-items: center;
      gap: 12px;
      flex-wrap: wrap;
    }

    .view-tabs {
      display: flex;
      background: var(--bg-code);
      border-radius: 40px;
      padding: 3px;
      border: 1px solid var(--border-light);
    }

    .view-tabs button {
      background: transparent;
      border: none;
      font-size: 12px;
      font-weight: 600;
      padding: 5px 14px;
      border-radius: 30px;
      cursor: pointer;
      color: var(--text-secondary);
      transition: all 0.1s;
    }

    .view-tabs button.active {
      background: var(--bg-surface);
      color: var(--text-primary);
      box-shadow: 0 1px 4px rgba(0, 0, 0, 0.04);
    }

    .zoom-controls {
      display: flex;
      align-items: center;
      gap: 4px;
      background: var(--bg-surface);
      border: 1px solid var(--border-light);
      border-radius: 40px;
      padding: 2px;
    }

    .zoom-controls button {
      background: transparent;
      border: none;
      width: 28px;
      height: 28px;
      border-radius: 50%;
      font-size: 14px;
      font-weight: 600;
      color: var(--text-secondary);
      cursor: pointer;
      transition: background 0.1s;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .zoom-controls button:hover {
      background: var(--bg-hover);
    }

    .zoom-level {
      font-size: 11px;
      font-weight: 600;
      color: var(--text-muted);
      min-width: 40px;
      text-align: center;
    }

    .canvas-wrapper {
      background: var(--bg-canvas);
      border: 1px solid var(--border-light);
      border-radius: var(--radius-lg);
      padding: 20px;
      overflow: hidden;
      max-height: 580px;
      min-height: 520px;
      box-shadow: inset 0 1px 4px rgba(0, 0, 0, 0.02);
      cursor: grab;
      position: relative;
    }

    .erd-canvas {
      display: block;
      transition: transform 0.15s ease;
      transform-origin: top left;
    }

    /* Archify-Style Floating Tooltip */
    #rel-tooltip {
      display: none;
      position: fixed;
      z-index: 2000;
      pointer-events: none;
      background: var(--bg-surface);
      border: 1px solid var(--border-light);
      box-shadow: var(--shadow-md);
      border-radius: var(--radius-md);
      padding: 14px 18px;
      width: 320px;
      max-width: 90vw;
      backdrop-filter: blur(12px);
      animation: popIn 0.12s cubic-bezier(0.16, 1, 0.3, 1);
    }

    @keyframes popIn {
      from { opacity: 0; transform: scale(0.96) translateY(4px); }
      to { opacity: 1; transform: scale(1) translateY(0); }
    }

    .tt-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 1px solid var(--border-light);
      padding-bottom: 8px;
      margin-bottom: 10px;
    }

    .tt-title {
      font-size: 11px;
      font-weight: 700;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .tt-badge {
      font-size: 10px;
      font-weight: 700;
      padding: 2px 7px;
      border-radius: 6px;
    }

    .tt-badge.solid {
      background: rgba(13, 148, 136, 0.14);
      color: var(--accent-teal);
    }

    .tt-badge.dashed {
      background: rgba(217, 119, 6, 0.14);
      color: var(--accent-amber);
    }

    .tt-flow {
      display: flex;
      align-items: center;
      justify-content: space-between;
      background: var(--bg-code);
      border: 1px solid var(--border-light);
      border-radius: 8px;
      padding: 8px 12px;
      margin-bottom: 10px;
    }

    .tt-endpoint {
      display: flex;
      flex-direction: column;
    }

    .tt-table {
      font-weight: 700;
      font-size: 13px;
    }

    .tt-col {
      font-family: var(--font-mono);
      font-size: 11px;
      color: var(--accent-blue);
    }

    .tt-arrow {
      color: var(--text-muted);
      font-size: 15px;
    }

    .tt-meta {
      font-size: 12px;
      color: var(--text-muted);
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .tt-meta-item strong {
      color: var(--text-primary);
    }

    /* Mermaid View */
    .mermaid-view {
      background: var(--bg-surface);
      border: 1px solid var(--border-light);
      border-radius: var(--radius-lg);
      padding: 24px;
      display: none;
      margin-top: 12px;
    }

    .mermaid-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 16px;
    }

    .mermaid-code {
      background: var(--bg-code);
      border: 1px solid var(--border-light);
      border-radius: var(--radius-md);
      padding: 18px;
      font-family: var(--font-mono);
      font-size: 12.5px;
      line-height: 1.6;
      white-space: pre;
      overflow-x: auto;
      color: var(--text-primary);
    }

    /* Table Cards */
    .table-section-title {
      font-size: 17px;
      font-weight: 700;
      margin: 40px 0 16px;
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .table-grid {
      display: flex;
      flex-direction: column;
      gap: 20px;
    }

    .table-card {
      background: var(--bg-surface);
      border: 1px solid var(--border-light);
      border-radius: var(--radius-lg);
      overflow: hidden;
      box-shadow: var(--shadow-sm);
      transition: border 0.15s, box-shadow 0.15s;
    }

    .table-card:hover {
      border-color: var(--accent-blue);
      box-shadow: var(--shadow-md);
    }

    .table-card-header {
      padding: 14px 20px;
      background: var(--bg-hover);
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 1px solid var(--border-light);
    }

    .table-card-title {
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .icon-circle {
      color: var(--accent-blue);
      font-size: 14px;
    }

    .table-card-title h3 {
      font-size: 15px;
      font-weight: 700;
    }

    .col-badge {
      font-size: 10px;
      font-weight: 600;
      background: var(--border-light);
      padding: 2px 8px;
      border-radius: 20px;
      color: var(--text-muted);
    }

    .mini-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 13px;
    }

    .mini-table th {
      text-align: left;
      padding: 9px 20px;
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: var(--text-muted);
      background: var(--bg-surface);
      border-bottom: 1px solid var(--border-light);
      font-weight: 600;
    }

    .mini-table td {
      padding: 9px 20px;
      border-bottom: 1px solid var(--border-light);
      color: var(--text-primary);
      font-family: var(--font-mono);
      font-size: 12.5px;
    }

    .mini-table tr:last-child td {
      border-bottom: none;
    }

    .mini-table tr:hover td {
      background: var(--bg-hover);
    }

    .tag {
      font-size: 9px;
      font-weight: 700;
      padding: 2px 6px;
      border-radius: 4px;
      margin-left: 8px;
      font-family: var(--font-sans);
      text-transform: uppercase;
      letter-spacing: 0.3px;
    }

    .tag-pk {
      background: var(--accent-blue-soft);
      color: var(--accent-blue);
    }

    .tag-fk {
      background: #fef3c7;
      color: #b45309;
    }

    @media (prefers-color-scheme: dark) {
      .tag-fk {
        background: #4a3410;
        color: #fbbf24;
      }
    }

    .tag-uq {
      background: var(--bg-code);
      color: var(--text-secondary);
    }

    code {
      font-family: var(--font-mono);
      font-size: 12px;
      background: var(--bg-code);
      padding: 2px 6px;
      border-radius: 5px;
    }

    .empty-findings {
      background: var(--bg-surface);
      border: 1px dashed var(--border-light);
      border-radius: var(--radius-lg);
      padding: 28px;
      text-align: center;
      color: var(--text-muted);
      font-size: 13px;
    }

    .sidebar-footer {
      padding: 12px 16px;
      border-top: 1px solid var(--border-light);
      font-size: 11px;
      color: var(--text-muted);
      display: flex;
      justify-content: space-between;
    }

    ${ERD_CSS}
  </style>
</head>
<body>
  <!-- Sidebar -->
  <aside class="sidebar" id="sidebar">
    <div class="sidebar-header">
      <span class="logo-badge">SCHEMASAGE</span>
    </div>
    <div class="sidebar-search">
      <input type="search" id="sidebarSearch" placeholder="Filter tables\u2026" autocomplete="off">
    </div>
    <div class="sidebar-list" id="sidebarList">
      ${sidebarItems}
    </div>
    <div class="sidebar-footer">
      <span>${m.tables.length} tables</span>
      <span>${esc(m.source.adapter)}</span>
    </div>
  </aside>

  <!-- Main Area -->
  <div class="main-wrapper">
    <div class="top-bar">
      <div class="brand-area">
        <button class="menu-toggle" id="menuToggle" title="Toggle Sidebar">\u2630</button>
        <div class="title-block">
          <h1>Architecture &amp; ER Explorer</h1>
          <div class="subtitle">
            <span>${esc(m.source.adapter)}</span> \xB7 ${m.tables.length} tables \xB7 ${m.relationships.length} relations
          </div>
        </div>
      </div>
      <div class="nav-links">
        <a href="#diagram">Diagram</a>
        <a href="#tables">Tables</a>
        <a href="#relationships">Relationships</a>
        <a href="#findings">Findings</a>
      </div>
    </div>

    <main>
      <!-- Guide Banner -->
      <div class="guide-banner">
        <div class="guide-icon">\u{1F4A1}</div>
        <div class="guide-text">
          <strong>Solid lines</strong> = DB-enforced foreign key. <strong>Dashed</strong> = ORM-declared only.
          <span style="margin-left: 12px;">Hover any line for Archify-style linkage details, or click a sidebar item to jump.</span>
        </div>
        <div class="guide-badge">
          <span class="dot green"></span> DB FK
          <span class="dot amber"></span> ORM FK
        </div>
      </div>

      <!-- Stats Row -->
      <div class="stats-row">
        <div class="stat-card">
          <div class="stat-label">Tables</div>
          <div class="stat-value">${m.tables.length}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Columns</div>
          <div class="stat-value">${m.tables.reduce((sum, t) => sum + t.columns.length, 0)}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Relationships</div>
          <div class="stat-value">${m.relationships.length}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Adapter</div>
          <div class="stat-value" style="font-size:18px;">${esc(m.source.adapter)}</div>
        </div>
      </div>

      <!-- Diagram Section -->
      <div class="section-header" id="diagram">
        <h2>Entity-Relationship</h2>
        <div class="diagram-controls">
          <div class="view-tabs">
            <button id="viewVisualBtn" class="active">Visual</button>
            <button id="viewMermaidBtn">Mermaid</button>
          </div>
          <div class="zoom-controls">
            <button id="zoomOut">-</button>
            <span class="zoom-level" id="zoomLevel">100%</span>
            <button id="zoomIn">+</button>
            <button id="zoomReset" style="font-size:11px; width:auto; padding:0 10px;">Reset</button>
          </div>
        </div>
      </div>

      <!-- Visual Canvas -->
      <div class="canvas-wrapper" id="visualCanvas">
        ${erdSvg(m)}
      </div>

      <!-- Archify-style Floating Relationship Inspector Tooltip -->
      <div id="rel-tooltip"></div>

      <!-- Mermaid View -->
      <div class="mermaid-view" id="mermaidView">
        <div class="mermaid-header">
          <h3 style="font-size: 14px;">Mermaid ERD Code</h3>
          <button id="copyMermaid" style="background:var(--bg-code); border:1px solid var(--border-light); padding:6px 12px; border-radius:20px; font-size:12px; font-weight:500; cursor:pointer;">Copy</button>
        </div>
        <pre class="mermaid-code" id="mermaidCode">${esc(mermaidCode)}</pre>
      </div>

      <!-- Tables Section -->
      <div class="section-header" id="tables">
        <h2>Table details (${m.tables.length})</h2>
        <div style="max-width: 280px; width:100%;">
          <input type="search" id="filter" placeholder="Quick filter table cards..." style="width:100%; padding:6px 14px; border:1px solid var(--border-light); border-radius:30px; background:var(--bg-surface); font-size:13px; color:var(--text-primary); outline:none;">
        </div>
      </div>

      <div class="table-grid" id="tableCards">
        ${tableCards}
      </div>

      ${appSection(m)}

      <!-- Relationships Section -->
      <div class="section-header" id="relationships">
        <h2>Relationships (${m.relationships.length})</h2>
      </div>

      <div class="table-card">
        <table class="mini-table">
          <thead>
            <tr>
              <th>From Column</th>
              <th></th>
              <th>To Column</th>
              <th>Cardinality</th>
              <th>Enforcement</th>
            </tr>
          </thead>
          <tbody>
            ${relRows}
          </tbody>
        </table>
      </div>

      <!-- Findings Section -->
      <div class="section-header" id="findings">
        <h2>Findings (${m.findings.length})</h2>
      </div>
      ${findings}
    </main>
  </div>

  <script>${FILTER_SCRIPT}</script>
</body>
</html>
`;
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
