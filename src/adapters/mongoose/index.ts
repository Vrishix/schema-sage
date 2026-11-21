import { promises as fs } from "node:fs";
import path from "node:path";
import ts from "typescript";
import type { DatabaseAdapter } from "../types.js";
import type { ScannedFile } from "../../scanner/scan.js";
import type { DatabaseModel, Table, Column, Relationship } from "../../model/types.js";
import { tableId, columnId, relationshipId } from "../../model/ids.js";
import { TOOL_VERSION } from "../../version.js";

interface ExtractedField {
  name: string;
  type: string;
  required: boolean;
  unique: boolean;
  ref?: string;
  line: number;
}

interface ExtractedSchema {
  modelName: string;
  collectionName: string;
  file: string;
  line: number;
  fields: ExtractedField[];
}

function cleanTypeName(t: string): string {
  return t
    .replace(/^(?:mongoose\.)?(?:Schema\.)?(?:Types\.)?/, "")
    .replace(/^String$/i, "string")
    .replace(/^Number$/i, "number")
    .replace(/^Boolean$/i, "boolean")
    .replace(/^Date$/i, "Date")
    .replace(/^ObjectId$/i, "ObjectId");
}

/**
 * Robust TypeScript AST-based parser for Mongoose schemas and models.
 * Handles:
 * - new Schema({ ... })
 * - new mongoose.Schema<IUser>({ ... })
 * - Schema({ ... })
 * - mongoose.model("User", UserSchema)
 * - model<IUser>("User", ...)
 * - Typegoose: @prop() class User ...
 * - export default model(...)
 */
export function parseMongooseAST(sourceText: string, filePath: string): ExtractedSchema[] {
  const sourceFile = ts.createSourceFile(
    filePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  );

  const schemas: ExtractedSchema[] = [];
  const schemaVarToFields = new Map<string, { line: number; fields: ExtractedField[] }>();
  const schemaVarToModelName = new Map<string, string>();

  function getLineNumber(pos: number): number {
    return sourceFile.getLineAndCharacterOfPosition(pos).line + 1;
  }

  function extractFieldsFromObjectLiteral(objLiteral: ts.ObjectLiteralExpression): ExtractedField[] {
    const fields: ExtractedField[] = [
      {
        name: "_id",
        type: "ObjectId",
        required: true,
        unique: true,
        line: getLineNumber(objLiteral.pos),
      },
    ];

    for (const prop of objLiteral.properties) {
      if (!ts.isPropertyAssignment(prop)) continue;
      const fieldName = prop.name.getText(sourceFile).replace(/['"]/g, "");
      if (fieldName === "_id") continue;

      let typeStr = "Mixed";
      let isRequired = false;
      let isUnique = false;
      let refTarget: string | undefined;

      const init = prop.initializer;
      const line = getLineNumber(prop.pos);

      // 1. Shorthand: `name: String` or `name: [String]` or `name: mongoose.Types.ObjectId`
      if (ts.isIdentifier(init) || ts.isPropertyAccessExpression(init)) {
        typeStr = cleanTypeName(init.getText(sourceFile));
      } else if (ts.isArrayLiteralExpression(init)) {
        // e.g. tags: [String] or authors: [{ type: ObjectId, ref: 'User' }]
        if (init.elements.length > 0) {
          const firstElem = init.elements[0];
          if (ts.isObjectLiteralExpression(firstElem)) {
            for (const subProp of firstElem.properties) {
              if (ts.isPropertyAssignment(subProp)) {
                const subKey = subProp.name.getText(sourceFile).replace(/['"]/g, "");
                if (subKey === "type") typeStr = cleanTypeName(subProp.initializer.getText(sourceFile)) + "[]";
                if (subKey === "ref") refTarget = subProp.initializer.getText(sourceFile).replace(/['"]/g, "");
              }
            }
          } else {
            typeStr = cleanTypeName(firstElem.getText(sourceFile)) + "[]";
          }
        } else {
          typeStr = "Array";
        }
      } else if (ts.isObjectLiteralExpression(init)) {
        // 2. Full object: `name: { type: String, required: true, ref: '...' }`
        for (const subProp of init.properties) {
          if (!ts.isPropertyAssignment(subProp)) continue;
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
        line,
      });
    }

    return fields;
  }

  function visit(node: ts.Node) {
    // 1. Check for `new Schema({ ... })` or `new mongoose.Schema(...)` or `Schema(...)`
    if (ts.isVariableDeclaration(node) && node.initializer) {
      const varName = node.name.getText(sourceFile);
      let init = node.initializer;
      if (ts.isAsExpression(init)) init = init.expression;

      if (
        (ts.isNewExpression(init) || ts.isCallExpression(init)) &&
        /Schema$/i.test(init.expression.getText(sourceFile))
      ) {
        const firstArg = init.arguments?.[0];
        if (firstArg && ts.isObjectLiteralExpression(firstArg)) {
          const fields = extractFieldsFromObjectLiteral(firstArg);
          schemaVarToFields.set(varName, {
            line: getLineNumber(node.pos),
            fields,
          });
        }
      }
    }

    // 2. Check for `model("User", UserSchema)` or `mongoose.model("User", ...)`
    if (ts.isCallExpression(node)) {
      const exprText = node.expression.getText(sourceFile);
      if (/^(?:mongoose\.)?model$/i.test(exprText) && node.arguments.length >= 1) {
        const firstArg = node.arguments[0];
        if (ts.isStringLiteral(firstArg) || ts.isNoSubstitutionTemplateLiteral(firstArg)) {
          const modelName = firstArg.text;
          const secondArg = node.arguments[1];

          let fields: ExtractedField[] = [];
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
          } else if (
            secondArg &&
            (ts.isNewExpression(secondArg) || ts.isCallExpression(secondArg)) &&
            secondArg.arguments?.[0] &&
            ts.isObjectLiteralExpression(secondArg.arguments[0])
          ) {
            fields = extractFieldsFromObjectLiteral(secondArg.arguments[0]);
          }

          if (fields.length > 0) {
            schemas.push({
              modelName,
              collectionName: modelName.toLowerCase() + "s",
              file: filePath,
              line,
              fields,
            });
          }
        }
      }
    }

    // 3. Typegoose: Class with @prop() decorators
    if (ts.isClassDeclaration(node) && node.name) {
      const className = node.name.getText(sourceFile);
      const props: ExtractedField[] = [
        {
          name: "_id",
          type: "ObjectId",
          required: true,
          unique: true,
          line: getLineNumber(node.pos),
        },
      ];

      let hasTypegooseProp = false;
      for (const member of node.members) {
        if (!ts.isPropertyDeclaration(member)) continue;
        const memberName = member.name.getText(sourceFile);
        const memberLine = getLineNumber(member.pos);
        const memberType = member.type ? member.type.getText(sourceFile) : "Mixed";

        // Check if has decorators (e.g. @prop)
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
            ref: refMatch ? refMatch[1] : undefined,
            line: memberLine,
          });
        }
      }

      if (hasTypegooseProp) {
        schemas.push({
          modelName: className,
          collectionName: className.toLowerCase() + "s",
          file: filePath,
          line: getLineNumber(node.pos),
          fields: props,
        });
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);

  // If a schema variable was declared with Schema({ ... }) but model() was called with that variable later or exported
  for (const [varName, { line, fields }] of schemaVarToFields.entries()) {
    const isAlreadyExtracted = schemas.some((s) => s.file === filePath && s.fields === fields);
    if (!isAlreadyExtracted) {
      const inferredName = varName.replace(/Schema$/i, "");
      schemas.push({
        modelName: inferredName,
        collectionName: inferredName.toLowerCase() + "s",
        file: filePath,
        line,
        fields,
      });
    }
  }

  return schemas;
}

export const mongooseAdapter: DatabaseAdapter = {
  name: "mongoose",
  supportedFeatures: [
    "Mongoose Schemas",
    "AST Type extraction",
    "required / unique constraints",
    "ref cross-collection relationships",
    "Typegoose @prop support",
  ],
  detect(files: ScannedFile[]): boolean {
    // Only trigger if actual schema/model code or files exist
    return files.some(
      (f) =>
        f.path.includes("models/") ||
        f.path.includes("schema/") ||
        f.path.includes("schemas/") ||
        f.path.endsWith(".model.ts") ||
        f.path.endsWith(".model.js") ||
        f.path.endsWith(".schema.ts") ||
        f.path.endsWith(".schema.js")
    );
  },
  async extract(repoRoot: string, files: ScannedFile[]): Promise<DatabaseModel> {
    const candidateFiles = files.filter(
      (f) =>
        (f.path.endsWith(".ts") || f.path.endsWith(".js") || f.path.endsWith(".mjs")) &&
        !f.path.endsWith(".d.ts") &&
        !f.path.includes("node_modules") &&
        (f.path.includes("model") ||
          f.path.includes("schema") ||
          f.path.includes("entity") ||
          f.path.includes("entities"))
    );

    const allSchemas: ExtractedSchema[] = [];
    const scannedPaths: string[] = [];

    for (const file of candidateFiles) {
      try {
        const content = await fs.readFile(path.join(repoRoot, file.path), "utf8");
        if (
          content.includes("Schema") ||
          content.includes("model") ||
          content.includes("mongoose") ||
          content.includes("@prop")
        ) {
          const parsed = parseMongooseAST(content, file.path);
          if (parsed.length > 0) {
            allSchemas.push(...parsed);
            scannedPaths.push(file.path);
          }
        }
      } catch {
        // Skip unreadable files
      }
    }

    const tables: Table[] = [];
    const relationships: Relationship[] = [];
    const modelNameToTable = new Map<string, string>();

    // Deduplicate by collectionName
    const seenCollections = new Set<string>();

    for (const m of allSchemas) {
      if (seenCollections.has(m.collectionName)) continue;
      seenCollections.add(m.collectionName);

      modelNameToTable.set(m.modelName, m.collectionName);
      modelNameToTable.set(m.collectionName, m.collectionName);
      modelNameToTable.set(m.modelName.toLowerCase(), m.collectionName);

      const columns: Column[] = m.fields.map((p) => ({
        id: columnId(m.collectionName, p.name),
        name: p.name,
        type: p.type,
        nullable: !p.required,
        default: null,
        isPrimaryKey: p.name === "_id",
        isUnique: p.unique || p.name === "_id",
        status: "verified",
        evidence: [{ file: m.file, lines: [p.line, p.line] }],
      }));

      tables.push({
        id: tableId(m.collectionName),
        name: m.collectionName,
        dbName: m.collectionName,
        explanation: `MongoDB Collection (from model: ${m.modelName})`,
        status: "verified",
        evidence: [{ file: m.file, lines: [m.line, m.line] }],
        columns,
      });
    }

    // Build relationships from ref
    for (const m of allSchemas) {
      for (const p of m.fields) {
        if (p.ref && modelNameToTable.has(p.ref)) {
          const targetTable = modelNameToTable.get(p.ref)!;
          if (targetTable !== m.collectionName) {
            relationships.push({
              id: relationshipId(columnId(m.collectionName, p.name), columnId(targetTable, "_id")),
              from: columnId(m.collectionName, p.name),
              to: columnId(targetTable, "_id"),
              cardinality: "one-to-many",
              enforcement: "orm-declared",
              status: "inferred",
              evidence: [{ file: m.file, lines: [p.line, p.line] }],
            });
          }
        }
      }
    }

    return {
      schemaVersion: "0.2.0",
      tool: { name: "schemasage", version: TOOL_VERSION },
      generatedAt: new Date().toISOString(),
      source: {
        adapter: "mongoose",
        adapterVersion: TOOL_VERSION,
        files: scannedPaths.length > 0 ? scannedPaths : ["models/"],
      },
      tables,
      relationships,
      findings: [],
      coverage: {
        filesScanned: scannedPaths,
        skipped: [],
        unsupported: [],
      },
    };
  },
};
