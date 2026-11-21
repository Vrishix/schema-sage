#!/usr/bin/env node
import { analyzeRepo, inspectDatabase } from "./pipeline.js";
import { TOOL_VERSION } from "./version.js";

const USAGE = `SchemaSage ${TOOL_VERSION}
Usage:
  schemasage analyze <repo-path>      Read repo and write artifacts/schemasage/
  schemasage inspect <connection-url> Connect to PostgreSQL or MongoDB directly
  schemasage --help
`;

async function main(): Promise<number> {
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
    for (const line of result.log) console.log(line);
    if (!result.model) return 0;
    const m = result.model;
    console.log(`Tables/Collections: ${m.tables.length}, relationships: ${m.relationships.length}`);
    console.log(`Open artifacts/schemasage/index.html in a browser.`);
    return 0;
  }

  if (command === "analyze") {
    const result = await analyzeRepo(target, { write: true });
    for (const line of result.log) console.log(line);
    if (!result.model) return 0;
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
