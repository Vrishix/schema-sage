import { parse, type Statement } from "pgsql-ast-parser";

/**
 * Replays migration SQL in order to get the schema as it stands after all migrations.
 * Uses a real SQL parser (pgsql-ast-parser), not regex. Read-only: nothing is executed.
 * Statements we do not replay are reported as unsupported, never guessed.
 */
export interface MigrationForeignKey {
  table: string;
  column: string;
  refTable: string;
  refColumn: string;
  constraintName: string | null;
  file: string;
}
export interface MigrationIndex {
  table: string;
  columns: string[];
  unique: boolean;
  primary: boolean;
  name: string | null;
  file: string;
}
export interface ParsedMigrations {
  foreignKeys: MigrationForeignKey[];
  indexes: MigrationIndex[];
  tables: string[];
  unsupported: string[];
}

const nm = (x: any): string => (typeof x === "string" ? x : x?.name);

/**
 * Prisma migrations carry warning comments that the SQL parser rejects.
 * Remove /* ... *\/ and -- comments outside string literals, and rewrite E'...' strings as '...'.
 * Only used for structure; string contents are never needed.
 */
export function prepareSql(sql: string): string {
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
    } else if ((c === "'" || c === '"') ) {
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

function findClose(sql: string, start: number, quote: string): number {
  let j = start + 1;
  while (j < sql.length) {
    if (sql[j] === quote) {
      if (sql[j + 1] === quote) { j += 2; continue; }
      return j + 1;
    }
    j++;
  }
  return sql.length;
}

/** Statements with no effect on tables, columns, keys or indexes. Ignored silently. */
const NON_STRUCTURAL = new Set(["insert", "update", "delete", "do", "create enum", "alter enum", "drop type", "create function", "create view", "create extension", "comment", "alter index", "create sequence", "alter sequence", "drop function", "drop view", "grant", "revoke"]);

export function parseMigrations(sqlByFile: Record<string, string>): ParsedMigrations {
  const foreignKeys: MigrationForeignKey[] = [];
  const indexes: MigrationIndex[] = [];
  const tables = new Set<string>();
  const unsupported: string[] = [];

  const addFk = (table: string, localCols: string[], refTable: string, refCols: string[], constraintName: string | null, file: string) => {
    localCols.forEach((col, i) => foreignKeys.push({ table, column: col, refTable, refColumn: refCols[i] ?? refCols[0], constraintName, file }));
  };
  const addUnique = (table: string, cols: string[], name: string | null, file: string, unique = true, primary = false) => {
    indexes.push({ table, columns: cols, unique, primary, name, file });
  };

  const removeColumn = (table: string, col: string) => {
    for (let i = foreignKeys.length - 1; i >= 0; i--) if (foreignKeys[i].table === table && foreignKeys[i].column === col) foreignKeys.splice(i, 1);
    for (let i = indexes.length - 1; i >= 0; i--) if (indexes[i].table === table && indexes[i].columns.includes(col)) indexes.splice(i, 1);
  };
  const renameColumn = (table: string, from: string, to: string) => {
    for (const f of foreignKeys) if (f.table === table && f.column === from) f.column = to;
    for (const i of indexes) if (i.table === table) i.columns = i.columns.map((c) => (c === from ? to : c));
  };

  for (const file of Object.keys(sqlByFile).sort()) {
    let statements: Statement[];
    try {
      statements = parse(prepareSql(sqlByFile[file]));
    } catch (err) {
      unsupported.push(`${file}: could not parse SQL (${(err as Error).message.split("\n")[0]})`);
      continue;
    }

    for (const s of statements as any[]) {
      switch (s.type) {
        case "create table": {
          const table = nm(s.name);
          tables.add(table);
          for (const col of s.columns ?? []) {
            if (col.kind !== "column") continue;
            for (const c of col.constraints ?? []) {
              if (c.type === "primary key") addUnique(table, [nm(col.name)], null, file, true, true);
              if (c.type === "unique") addUnique(table, [nm(col.name)], null, file);
              if (c.type === "reference") addFk(table, [nm(col.name)], nm(c.foreignTable), (c.foreignColumns ?? []).map(nm), null, file);
            }
          }
          for (const c of s.constraints ?? []) {
            const cname = c.constraintName ? nm(c.constraintName) : null;
            if (c.type === "foreign key") addFk(table, (c.localColumns ?? []).map(nm), nm(c.foreignTable), (c.foreignColumns ?? []).map(nm), cname, file);
            else if (c.type === "unique" || c.type === "primary key") addUnique(table, (c.columns ?? []).map(nm), cname, file, true, c.type === "primary key");
          }
          break;
        }
        case "create index": {
          const exprs = s.expressions ?? [];
          const cols = exprs.map((e: any) => (e.expression?.type === "ref" ? e.expression.name : null));
          if (cols.includes(null)) unsupported.push(`${file}: index ${nm(s.indexName)} uses an expression; not analysed`);
          else addUnique(nm(s.table), cols, nm(s.indexName), file, Boolean(s.unique), false);
          break;
        }
        case "alter table": {
          const table = nm(s.table);
          for (const ch of s.changes ?? []) {
            if (ch.type === "add constraint") {
              const c = ch.constraint;
              const cname = c.constraintName ? nm(c.constraintName) : null;
              if (c.type === "foreign key") addFk(table, (c.localColumns ?? []).map(nm), nm(c.foreignTable), (c.foreignColumns ?? []).map(nm), cname, file);
              else if (c.type === "unique" || c.type === "primary key") addUnique(table, (c.columns ?? []).map(nm), cname, file, true, c.type === "primary key");
              else unsupported.push(`${file}: constraint type "${c.type}" not analysed`);
            } else if (ch.type === "drop constraint") {
              const cname = nm(ch.constraint);
              for (let i = foreignKeys.length - 1; i >= 0; i--) if (foreignKeys[i].table === table && foreignKeys[i].constraintName === cname) foreignKeys.splice(i, 1);
              for (let i = indexes.length - 1; i >= 0; i--) if (indexes[i].table === table && indexes[i].name === cname) indexes.splice(i, 1);
            } else if (ch.type === "add column") {
              const col = nm(ch.column.name);
              for (const c of ch.column.constraints ?? []) {
                if (c.type === "primary key" || c.type === "unique") addUnique(table, [col], null, file, true, c.type === "primary key");
                if (c.type === "reference") addFk(table, [col], nm(c.foreignTable), (c.foreignColumns ?? []).map(nm), null, file);
              }
            } else if (ch.type === "drop column") {
              const col = nm(ch.column);
              removeColumn(table, col);
            } else if (ch.type === "rename column") {
              const from = nm(ch.oldName ?? ch.from ?? ch.column);
              const to = nm(ch.newName ?? ch.to);
              renameColumn(table, from, to);
            } else if (ch.type === "alter column") {
              // Type and nullability changes do not affect keys or indexes here.
            } else {
              unsupported.push(`${file}: ALTER TABLE ${ch.type} not replayed`);
            }
          }
          break;
        }
        case "drop index": {
          for (const n of (s.names ?? []).map(nm)) {
            for (let i = indexes.length - 1; i >= 0; i--) if (indexes[i].name === n) indexes.splice(i, 1);
          }
          break;
        }
        case "drop table": {
          for (const t of (s.names ?? []).map(nm)) {
            tables.delete(t);
            for (let i = foreignKeys.length - 1; i >= 0; i--) if (foreignKeys[i].table === t || foreignKeys[i].refTable === t) foreignKeys.splice(i, 1);
            for (let i = indexes.length - 1; i >= 0; i--) if (indexes[i].table === t) indexes.splice(i, 1);
          }
          break;
        }
        default:
          if (!NON_STRUCTURAL.has(s.type)) unsupported.push(`${file}: statement "${s.type}" not replayed`);
      }
    }
  }
  return { foreignKeys, indexes, tables: [...tables], unsupported };
}
