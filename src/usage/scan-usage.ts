import ts from "typescript";

/**
 * Finds Prisma client calls in application code, e.g. prisma.order.create(...).
 * Uses the TypeScript compiler's parser. Reads source text only; never runs the code.
 * Receivers are recognised by name: `prisma`, `db`, or any variable created with `new PrismaClient()`.
 */
export type Operation = "read" | "write" | "delete";

export interface Usage {
  table: string;           // model name, e.g. "Order"
  operation: Operation;
  method: string;          // e.g. "create"
  file: string;            // repo-relative
  line: number;
  fn: string | null;       // enclosing function name, if any
}

export interface RawSqlUse {
  file: string;
  line: number;
  method: string;
}

const READ = new Set(["findMany", "findUnique", "findUniqueOrThrow", "findFirst", "findFirstOrThrow", "count", "aggregate", "groupBy"]);
const WRITE = new Set(["create", "createMany", "createManyAndReturn", "update", "updateMany", "upsert"]);
const DELETE = new Set(["delete", "deleteMany"]);
const RAW = new Set(["$queryRaw", "$queryRawUnsafe", "$executeRaw", "$executeRawUnsafe"]);
const DEFAULT_RECEIVERS = ["prisma", "db"];

export interface SourceFile { path: string; text: string }

export interface ScanOutput {
  usages: Usage[];
  rawSql: RawSqlUse[];
  receivers: string[];
}

const kindFor = (path: string): ts.ScriptKind =>
  path.endsWith(".tsx") ? ts.ScriptKind.TSX : path.endsWith(".jsx") ? ts.ScriptKind.JSX : path.endsWith(".js") || path.endsWith(".mjs") || path.endsWith(".cjs") ? ts.ScriptKind.JS : ts.ScriptKind.TS;

const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

/** Name of the function that contains a node, if it has one. */
function enclosingFunction(node: ts.Node): string | null {
  let cur: ts.Node | undefined = node.parent;
  while (cur) {
    if ((ts.isFunctionDeclaration(cur) || ts.isMethodDeclaration(cur)) && cur.name && ts.isIdentifier(cur.name)) return cur.name.text;
    if ((ts.isArrowFunction(cur) || ts.isFunctionExpression(cur)) && cur.parent && ts.isVariableDeclaration(cur.parent) && ts.isIdentifier(cur.parent.name)) return cur.parent.name.text;
    cur = cur.parent;
  }
  return null;
}

/** Variable names assigned from `new PrismaClient(...)`, so custom client names are recognised too. */
function clientNames(sf: ts.SourceFile): string[] {
  const out: string[] = [];
  const visit = (n: ts.Node) => {
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer && ts.isNewExpression(n.initializer)) {
      const callee = n.initializer.expression;
      if (ts.isIdentifier(callee) && callee.text === "PrismaClient") out.push(n.name.text);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

function receiverName(expr: ts.Expression): string | null {
  if (ts.isIdentifier(expr)) return expr.text;
  if (ts.isPropertyAccessExpression(expr)) return expr.name.text;
  return null;
}

export function scanUsage(files: SourceFile[], modelNames: string[]): ScanOutput {
  const byCamel = new Map(modelNames.map((m) => [lowerFirst(m), m]));
  const parsed = files.map((f) => ({ path: f.path, sf: ts.createSourceFile(f.path, f.text, ts.ScriptTarget.Latest, true, kindFor(f.path)) }));
  const receivers = new Set<string>(DEFAULT_RECEIVERS);
  for (const { sf } of parsed) for (const n of clientNames(sf)) receivers.add(n);

  const usages: Usage[] = [];
  const rawSql: RawSqlUse[] = [];

  for (const { path, sf } of parsed) {
    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
        const method = node.expression.name.text;
        const target = node.expression.expression;
        const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;

        // prisma.<model>.<method>(...)
        if (ts.isPropertyAccessExpression(target)) {
          const modelKey = target.name.text;
          const recv = receiverName(target.expression);
          const op: Operation | null = READ.has(method) ? "read" : WRITE.has(method) ? "write" : DELETE.has(method) ? "delete" : null;
          const model = byCamel.get(modelKey);
          if (recv && receivers.has(recv) && model && op) {
            usages.push({ table: model, operation: op, method, file: path, line, fn: enclosingFunction(node) });
          }
        }
        // prisma.$queryRaw`...` / prisma.$executeRaw(...)
        const recvRaw = receiverName(node.expression.expression);
        if (recvRaw && receivers.has(recvRaw) && RAW.has(method)) {
          rawSql.push({ file: path, line, method });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }

  // Tagged template form: prisma.$queryRaw`...`
  for (const { path, sf } of parsed) {
    const visit = (node: ts.Node) => {
      if (ts.isTaggedTemplateExpression(node) && ts.isPropertyAccessExpression(node.tag)) {
        const recv = receiverName(node.tag.expression);
        if (recv && receivers.has(recv) && RAW.has(node.tag.name.text)) {
          rawSql.push({ file: path, line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1, method: node.tag.name.text });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }

  return { usages, rawSql, receivers: [...receivers] };
}
