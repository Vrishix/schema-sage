import ts from "typescript";

export interface ExtractedField {
  name: string;
  type: string;
  required: boolean;
  unique: boolean;
  ref?: string;
  line: number;
}

export interface ExtractedSchema {
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

      if (ts.isIdentifier(init) || ts.isPropertyAccessExpression(init)) {
        typeStr = cleanTypeName(init.getText(sourceFile));
      } else if (ts.isArrayLiteralExpression(init)) {
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
