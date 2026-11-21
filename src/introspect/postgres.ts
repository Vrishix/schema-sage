import type { DatabaseModel, Table, Column, Relationship } from "../model/types.js";
import { tableId, columnId, relationshipId } from "../model/ids.js";
import { TOOL_VERSION } from "../version.js";

export async function introspectPostgres(connectionUrl: string): Promise<DatabaseModel> {
  const pg = await import("pg");
  const { Client } = pg.default || pg;
  const client = new Client({ connectionString: connectionUrl });

  await client.connect();
  try {
    // 1. Fetch tables
    const tablesRes = await client.query(`
      SELECT table_schema, table_name
      FROM information_schema.tables
      WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
        AND table_type = 'BASE TABLE'
      ORDER BY table_name;
    `);

    // 2. Fetch columns
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

    // 3. Fetch Primary Keys
    const pkRes = await client.query(`
      SELECT tc.table_name, kcu.column_name
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name
        AND tc.table_schema = kcu.table_schema
      WHERE tc.constraint_type = 'PRIMARY KEY'
        AND tc.table_schema NOT IN ('pg_catalog', 'information_schema');
    `);
    const pks = new Set(pkRes.rows.map((r: any) => `${r.table_name}.${r.column_name}`));

    // 4. Fetch Unique Constraints
    const uqRes = await client.query(`
      SELECT tc.table_name, kcu.column_name
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name
        AND tc.table_schema = kcu.table_schema
      WHERE tc.constraint_type = 'UNIQUE'
        AND tc.table_schema NOT IN ('pg_catalog', 'information_schema');
    `);
    const uqs = new Set(uqRes.rows.map((r: any) => `${r.table_name}.${r.column_name}`));

    // 5. Fetch Foreign Keys
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

    const colMapByTable = new Map<string, Column[]>();
    for (const r of columnsRes.rows) {
      const isPk = pks.has(`${r.table_name}.${r.column_name}`);
      const isUq = uqs.has(`${r.table_name}.${r.column_name}`);
      const col: Column = {
        id: columnId(r.table_name, r.column_name),
        name: r.column_name,
        type: r.data_type === "USER-DEFINED" ? r.udt_name : r.data_type,
        nullable: r.is_nullable === "YES",
        default: r.column_default ? String(r.column_default).replace(/'/g, "") : null,
        isPrimaryKey: isPk,
        isUnique: isUq || isPk,
        status: "verified",
        evidence: [{ file: "database:postgres", lines: [1, 1] }],
      };

      if (!colMapByTable.has(r.table_name)) colMapByTable.set(r.table_name, []);
      colMapByTable.get(r.table_name)!.push(col);
    }

    const tables: Table[] = tablesRes.rows.map((r: any) => ({
      id: tableId(r.table_name),
      name: r.table_name,
      dbName: r.table_name,
      explanation: null,
      status: "verified",
      evidence: [{ file: "database:postgres", lines: [1, 1] }],
      columns: colMapByTable.get(r.table_name) ?? [],
    }));

    const relationships: Relationship[] = fkRes.rows.map((r: any) => ({
      id: relationshipId(columnId(r.from_table, r.from_column), columnId(r.to_table, r.to_column)),
      from: columnId(r.from_table, r.from_column),
      to: columnId(r.to_table, r.to_column),
      cardinality: "one-to-many",
      enforcement: "db-enforced",
      status: "verified",
      evidence: [{ file: "database:postgres.sql", lines: [1, 1] }],
    }));

    return {
      schemaVersion: "0.2.0",
      tool: { name: "schemasage", version: TOOL_VERSION },
      generatedAt: new Date().toISOString(),
      source: {
        adapter: "postgres-direct",
        adapterVersion: TOOL_VERSION,
        files: ["postgres://<connection>"],
      },
      tables,
      relationships,
      findings: [],
      coverage: {
        filesScanned: ["postgres://<connection>"],
        skipped: [],
        unsupported: [],
      },
    };
  } finally {
    await client.end();
  }
}
