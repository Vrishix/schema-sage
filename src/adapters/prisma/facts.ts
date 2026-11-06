import { getSchema } from "@mrleebo/prisma-ast";

/** Block-level index attributes that getDMMF does not expose. */
export interface BlockIndex {
  columns: string[];
  unique: boolean;
}

/** Reads @@index and @@unique from the schema with Prisma's AST parser. Read-only. */
export function readBlockIndexes(schemaText: string): Map<string, BlockIndex[]> {
  const ast = getSchema(schemaText) as any;
  const out = new Map<string, BlockIndex[]>();
  for (const node of ast.list ?? []) {
    if (node.type !== "model") continue;
    const list: BlockIndex[] = [];
    for (const p of node.properties ?? []) {
      if (p.type !== "attribute" || (p.name !== "index" && p.name !== "unique")) continue;
      const arr = p.args?.[0]?.value?.args ?? [];
      const cols = arr.map((a: any) => (typeof a === "string" ? a : a?.name ?? String(a)));
      list.push({ columns: cols, unique: p.name === "unique" });
    }
    out.set(node.name, list);
  }
  return out;
}
