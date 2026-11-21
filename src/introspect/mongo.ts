import type { DatabaseModel, Table, Column, Relationship } from "../model/types.js";
import { tableId, columnId, relationshipId } from "../model/ids.js";
import { TOOL_VERSION } from "../version.js";

function inferBsonType(val: any): string {
  if (val === null || val === undefined) return "mixed";
  if (Array.isArray(val)) return "array";
  if (val instanceof Date) return "date";
  if (typeof val === "object") {
    if (val._bsontype === "ObjectId") return "ObjectId";
    return "object";
  }
  return typeof val;
}

export async function introspectMongo(connectionUrl: string): Promise<DatabaseModel> {
  const { MongoClient } = await import("mongodb");
  const client = new MongoClient(connectionUrl);

  await client.connect();
  try {
    const db = client.db();
    const collections = await db.listCollections().toArray();

    const tables: Table[] = [];
    const relationships: Relationship[] = [];
    const knownCollections = new Set(collections.map((c) => c.name));

    for (const collInfo of collections) {
      if (collInfo.name.startsWith("system.")) continue;
      const collName = collInfo.name;
      const coll = db.collection(collName);

      // Sample up to 50 documents to infer document structure
      const sampleDocs = await coll.aggregate([{ $sample: { size: 50 } }]).toArray();

      const fieldTypes = new Map<string, Set<string>>();
      for (const doc of sampleDocs) {
        for (const [key, val] of Object.entries(doc)) {
          if (!fieldTypes.has(key)) fieldTypes.set(key, new Set());
          fieldTypes.get(key)!.add(inferBsonType(val));
        }
      }

      // Always ensure _id is present
      if (!fieldTypes.has("_id")) {
        fieldTypes.set("_id", new Set(["ObjectId"]));
      }

      const columns: Column[] = [];
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
          evidence: [{ file: `mongodb:${collName}`, lines: [1, 1] }],
        });

        // Infer potential references (e.g. userId -> user._id or users._id)
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
                evidence: [{ file: `mongodb:${collName}`, lines: [1, 1] }],
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
        columns,
      });
    }

    return {
      schemaVersion: "0.2.0",
      tool: { name: "schemasage", version: TOOL_VERSION },
      generatedAt: new Date().toISOString(),
      source: {
        adapter: "mongodb-direct",
        adapterVersion: TOOL_VERSION,
        files: ["mongodb://<connection>"],
      },
      tables,
      relationships,
      findings: [],
      coverage: {
        filesScanned: ["mongodb://<connection>"],
        skipped: [],
        unsupported: [],
      },
    };
  } finally {
    await client.close();
  }
}
