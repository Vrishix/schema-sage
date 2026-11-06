import ts from "typescript";
import type { SourceFile, Usage } from "./scan-usage.js";

/**
 * Endpoint -> handler -> called functions -> Prisma operations.
 * Links are matched by function name, so every link is labelled "inferred".
 * Dynamic dispatch, dependency injection and re-exports are not followed.
 */
export interface Endpoint {
  method: string;
  path: string;
  file: string;
  line: number;
  handler: string;
}

export interface Flow {
  endpoint: Endpoint;
  chain: { fn: string; file: string }[];
  operations: { table: string; operation: string; method: string; file: string; line: number }[];
  confidence: "inferred";
  /** Called names with several definitions in the repo. Not followed, so the flow may be incomplete. */
  ambiguousCalls: string[];
}

interface FnInfo { name: string; file: string; calls: string[]; startLine: number; endLine: number }

const HTTP = new Set(["get", "post", "put", "patch", "delete"]);
const NEXT_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);
const MAX_DEPTH = 5;

const kindFor = (path: string): ts.ScriptKind =>
  path.endsWith(".tsx") ? ts.ScriptKind.TSX : path.endsWith(".jsx") ? ts.ScriptKind.JSX : path.endsWith(".js") || path.endsWith(".mjs") || path.endsWith(".cjs") ? ts.ScriptKind.JS : ts.ScriptKind.TS;

/** Next.js Pages Router: pages/api/x.ts with a default export -> /api/x path. */
function nextPagesApiFromFile(file: string): string | null {
  const m = /(?:^|\/)pages\/(api\/.*)\.(ts|tsx|js|jsx|mjs)$/.exec(file);
  if (!m) return null;
  return "/" + m[1].replace(/\/index$/, "");
}

/** Next.js App Router: app/.../route.ts exporting GET/POST/... -> /... path. */
function nextRouteFromFile(file: string): string | null {
  const m = /(?:^|\/)app\/(.*)\/route\.(ts|tsx|js|jsx|mjs)$/.exec(file) ?? /(?:^|\/)app\/route\.(ts|tsx|js|jsx|mjs)$/.exec(file);
  if (!m) return null;
  const dir = m[1] ?? "";
  return "/" + dir.split("/").filter((seg) => !/^\(.*\)$/.test(seg)).join("/");
}

export function buildFlows(files: SourceFile[], usages: Usage[]): { endpoints: Endpoint[]; flows: Flow[] } {
  const fns: FnInfo[] = [];
  const fnByNode = new Map<ts.Node, FnInfo>();
  const endpoints: Endpoint[] = [];
  const handlerRefs: { endpoint: Endpoint; handlerName: string | null; inline: FnInfo | null; file: string }[] = [];

  for (const f of files) {
    const sf = ts.createSourceFile(f.path, f.text, ts.ScriptTarget.Latest, true, kindFor(f.path));
    const nextPath = nextRouteFromFile(f.path);

    // Record every named function with the names it calls.
    const collect = (node: ts.Node) => {
      let name: string | null = null;
      if ((ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) && node.name && ts.isIdentifier(node.name)) name = node.name.text;
      if ((ts.isArrowFunction(node) || ts.isFunctionExpression(node)) && node.parent && ts.isVariableDeclaration(node.parent) && ts.isIdentifier(node.parent.name)) name = node.parent.name.text;
      if ((ts.isArrowFunction(node) || ts.isFunctionExpression(node)) && !name) name = `(inline ${f.path}:${sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1})`;
      if (name) {
        const calls: string[] = [];
        const scan = (n: ts.Node) => {
          if (ts.isCallExpression(n)) {
            if (ts.isIdentifier(n.expression)) calls.push(n.expression.text);
            else if (ts.isPropertyAccessExpression(n.expression)) calls.push(n.expression.name.text);
          }
          ts.forEachChild(n, scan);
        };
        ts.forEachChild(node, scan);
        const info: FnInfo = {
          name,
          file: f.path,
          calls,
          startLine: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
          endLine: sf.getLineAndCharacterOfPosition(node.getEnd()).line + 1,
        };
        fns.push(info);
        fnByNode.set(node, info);
      }
      ts.forEachChild(node, collect);
    };
    collect(sf);

    // Next.js App Router handlers.
    if (nextPath) {
      for (const stmt of sf.statements) {
        if (ts.isFunctionDeclaration(stmt) && stmt.name && NEXT_METHODS.has(stmt.name.text) && stmt.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) {
          const line = sf.getLineAndCharacterOfPosition(stmt.getStart(sf)).line + 1;
          const ep: Endpoint = { method: stmt.name.text, path: nextPath || "/", file: f.path, line, handler: stmt.name.text };
          endpoints.push(ep);
          handlerRefs.push({ endpoint: ep, handlerName: stmt.name.text, inline: null, file: f.path });
        }
      }
    }

    // Next.js Pages Router: default-exported handler, accepts any method.
    const pagesPath = nextPagesApiFromFile(f.path);
    if (pagesPath) {
      for (const stmt of sf.statements) {
        const isDefault = (ts.isFunctionDeclaration(stmt) || ts.isVariableStatement(stmt)) && stmt.modifiers?.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword);
        if (ts.isFunctionDeclaration(stmt) && isDefault) {
          const line = sf.getLineAndCharacterOfPosition(stmt.getStart(sf)).line + 1;
          const label = stmt.name?.text ?? "default";
          const ep: Endpoint = { method: "ANY", path: pagesPath, file: f.path, line, handler: label };
          endpoints.push(ep);
          handlerRefs.push({ endpoint: ep, handlerName: stmt.name?.text ?? null, inline: stmt.name ? null : fnByNode.get(stmt) ?? null, file: f.path });
        } else if (ts.isExportAssignment(stmt) && !stmt.isExportEquals) {
          const line = sf.getLineAndCharacterOfPosition(stmt.getStart(sf)).line + 1;
          const e = stmt.expression;
          const handlerName = ts.isIdentifier(e) ? e.text : null;
          const inline = ts.isArrowFunction(e) || ts.isFunctionExpression(e) ? fnByNode.get(e) ?? null : null;
          const ep: Endpoint = { method: "ANY", path: pagesPath, file: f.path, line, handler: handlerName ?? inline?.name ?? "default" };
          endpoints.push(ep);
          handlerRefs.push({ endpoint: ep, handlerName, inline, file: f.path });
        }
      }
    }

    // Express-style: <app|router>.get('/path', handler)
    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && HTTP.has(node.expression.name.text)) {
        const [first, ...rest] = node.arguments;
        if (first && ts.isStringLiteralLike(first) && rest.length) {
          const last = rest[rest.length - 1];
          const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
          const handlerName = ts.isIdentifier(last) ? last.text : ts.isPropertyAccessExpression(last) ? last.name.text : null;
          const inlineFn = ts.isArrowFunction(last) || ts.isFunctionExpression(last) ? fnByNode.get(last) ?? null : null;
          const label = handlerName ?? (inlineFn ? inlineFn.name : null);
          if (label) {
            const ep: Endpoint = { method: node.expression.name.text.toUpperCase(), path: first.text, file: f.path, line, handler: label };
            endpoints.push(ep);
            handlerRefs.push({ endpoint: ep, handlerName, inline: inlineFn, file: f.path });
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }

  const byName = new Map<string, FnInfo[]>();
  for (const fn of fns) byName.set(fn.name, [...(byName.get(fn.name) ?? []), fn]);

  // A function owns every database call whose line falls inside its body (nested calls included).
  const opsOf = (fn: FnInfo): Flow["operations"] => {
    const out: Flow["operations"] = [];
    for (const u of usages) {
      if (u.file === fn.file && u.line >= fn.startLine && u.line <= fn.endLine) {
        out.push({ table: u.table, operation: u.operation, method: u.method, file: u.file, line: u.line });
      }
    }
    return out;
  };

  const flows: Flow[] = [];
  for (const { endpoint, handlerName, inline, file } of handlerRefs) {
    const start = inline ?? (byName.get(handlerName ?? "") ?? []).sort((a, b) => (a.file === file ? -1 : 0) - (b.file === file ? -1 : 0))[0];
    if (!start) continue;
    const seen = new Set<string>();
    const chain: { fn: string; file: string }[] = [];
    const ops = new Map<string, Flow["operations"][number]>();
    const queue: { fn: FnInfo; depth: number }[] = [{ fn: start, depth: 0 }];
    const ambiguous = new Set<string>();
    while (queue.length) {
      const { fn, depth } = queue.shift()!;
      const key = `${fn.file}#${fn.name}#${fn.startLine}`;
      if (seen.has(key)) continue;
      seen.add(key);
      chain.push({ fn: fn.name, file: fn.file });
      for (const o of opsOf(fn)) ops.set(`${o.file}:${o.line}:${o.method}`, o);
      if (depth >= MAX_DEPTH) continue;
      for (const callee of new Set(fn.calls)) {
        const candidates = byName.get(callee) ?? [];
        // Only follow a name that has exactly one definition in the repo. Ambiguous names are
        // skipped rather than guessed, so a shared name cannot create a false flow.
        if (candidates.length === 1) queue.push({ fn: candidates[0], depth: depth + 1 });
        else if (candidates.length > 1) ambiguous.add(callee);
      }
    }
    if (ops.size) flows.push({ endpoint, chain, operations: [...ops.values()], confidence: "inferred", ambiguousCalls: [...ambiguous].sort() });
  }
  return { endpoints, flows };
}
