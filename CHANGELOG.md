# Changelog

## 0.1.0-alpha.0
- Project scaffold: scanner, normalized model types, validator, secret redaction, CLI entry point.
- First fixture (`prisma-basic`) with hand-written answer key.
- Secret-leak fixture (`prisma-secrets`).

## 0.1.0-alpha.1
- Prisma adapter: parses models, scalar fields, @id, @unique, @default, @relation, @@index, @@unique, @@id.
- Migration reader: FOREIGN KEY and CREATE INDEX statements. Enforcement is db-enforced only when a migration confirms it.
- Findings: foreign key without index, nullable foreign key, table without primary key. Worded as suggestions.
- Outputs: index.html, data/database.json, markdown/database.md, manifest.json in artifacts/schemasage/.
- Redaction of .env values from every output file.
- Answer-key test: the fixture output matches the hand-written expected model exactly.
- Build: `npm run build` produces dist/cli.js.
- Not yet: ER diagram, refresh that removes stale files, .gitignore parsing.

## 0.1.0-alpha.2 (unreleased)
- Stopped reading `.env` files. They are listed as skipped only.
- Output redaction is now pattern-based: connection-string passwords, common key formats (Stripe, AWS, GitHub, JWT), and NAME_SECRET assignments.
- Tests: redaction patterns, and output is identical with and without a `.env`.

## 0.1.0-alpha.3 (unreleased)
- Prisma schema is read with Prisma's own reader (`getDMMF`) instead of the regex reader. Schema errors come from Prisma's validator.
- `@@index` and `@@unique` read with `@mrleebo/prisma-ast`. Line numbers for evidence come from a small locator.
- Composite foreign keys are drawn from their first column and listed under Coverage as unsupported.
- Removed `parse-schema.ts`.

## 0.1.0-alpha.4 (unreleased)
- Migration SQL is parsed with a real SQL parser (pgsql-ast-parser) and replayed in order. Dropped tables, constraints and indexes are removed.
- Unparsed SQL and statements that are not replayed are listed under Coverage, not guessed.
- Mapped table names (`@@map`) are shown next to the model name.
- Tests for migration replay (19 -> 24).

## 0.1.0-alpha.5 (unreleased)
- Static SVG ER diagram on the page: one box per table, one edge per relationship. Solid edges are database-enforced, dashed are ORM-only. Clicking an edge jumps to its row.
- No scripts and no external libraries. The diagram works offline.
- Layout is a fixed grid, not a graph layout. Edges can cross on dense schemas.
- Page fixes: no horizontal scroll on phones; long tables scroll inside themselves.
- Tests: ER diagram (box and edge counts, dashed vs solid, escaping, empty model). 28 tests.
- Measured: 150 tables analysed in 0.6 s, 248 KB page.

## 0.1.0-alpha.6 (unreleased)
- Prisma is read with `@prisma/internals` 7. Schemas with and without `url` in the datasource are accepted. Connection URL lines are removed from the text given to the reader, never read or used.
- MongoDB schemas get a clear "not supported yet" message.
- Prisma error messages are shown without terminal colour codes.
- ER diagram uses a layered layout: referenced tables sit to the left, which reduces crossings.
- `npm run examples <dir>` runs the analyser over every schema in a folder. Results on the official Prisma examples: docs/real-world-prisma-examples.txt (77 of 78 read; 1 MongoDB, unsupported).
- Tests: 29.

## 0.1.0-alpha.7 (unreleased)
- Migration replay handles ADD COLUMN (with inline REFERENCES), DROP COLUMN, RENAME COLUMN. Prisma warning comments and E'' strings are removed before parsing. Data-only and non-structural statements are ignored silently, not reported.
- ER diagram: layers wrap into bands, and long layers split into columns of at most 8 tables. The diagram renders at natural size and scrolls, so names stay readable on large schemas.
- Tested on calcom/cal.com (packages/prisma, 595 migrations): 102 tables, 175 relationships, 1.1 s. See docs/real-world-calcom.txt.
- Tests: 31.

## 0.1.0-alpha.8 (unreleased)
- Fixed: migration matching used model names. For models with `@@map`, migrations use the physical name, so enforced foreign keys and indexes were missed. Regression test added (tests/unit/mapped.test.ts).
- Version strings updated everywhere (were stale at alpha.1).
- Tests: 32.

## 0.1.0-alpha.9 (unreleased)
- relationMode = "prisma": relationships are ORM-declared even if a migration has a foreign key. Noted under Coverage.
- Application usage: finds Prisma client calls (read, write, delete) in TypeScript and JavaScript, with file, line and enclosing function. Recognises `prisma`, `db`, and variables created with `new PrismaClient()`. Raw SQL calls are counted and listed under Coverage.
- Endpoint flows (inferred): Express-style routes (named and inline handlers), Next.js App Router `route.ts`, and Next.js Pages Router `pages/api`. Each flow links endpoint, handler, called functions and database operations. Links are by function name, so they are labelled inferred.
- Page: usage and flow sections; a table filter box (its one script is allowed by hash in the Content Security Policy).
- Tests: 42.
- Limits: links by name (no import resolution), no dependency injection, no class-method dispatch via `this`, App Router server actions not traced, Pages Router only the default export.

## 0.1.0-alpha.10 (unreleased)
- Flow tracing only follows a function name that has exactly one definition. Ambiguous names are listed as "not followed" on the page, so a shared name can no longer create a false flow.
- README and SKILL.md rewritten to match what the tool does, including what is inferred.
- GitHub Actions CI: typecheck, tests, build, and a CLI smoke test on Node 20 and 22.
- Clean-install test: `git archive` of the repo, `npm ci`, typecheck, tests and build all pass. This found that the secrets fixture `.env` was excluded by .gitignore; fixed.
- Tests: 43.
