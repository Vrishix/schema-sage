# SchemaSage

> You built it with AI. Now understand its database.

SchemaSage reads your repository and explains your database: tables, columns,
keys, indexes, and relationships. It produces an offline HTML page with an ER
diagram where every fact links to the file and line it came from, and every
relationship is labelled by how strongly it is enforced.

**Status:** alpha (0.1.0-alpha.10). Prisma schema and migration extraction, findings, Markdown and HTML output, and the redaction and safety tests work. An ER diagram is included, with a table filter; it has no zoom or pan yet.

## Principles
- Read-only. Never runs your project's code, migrations, or connects to a database.
- Local. No account, no upload.
- Evidence-first. Each claim is Verified, Inferred, or Unknown.
- Secrets are never printed.

## Develop
```bash
npm install
npm test          # unit tests and fixture checks
npm run typecheck
npm run build
node dist/cli.js analyze fixtures/prisma-basic

# Try it on many real schemas (clone prisma/prisma-examples first)
npm run examples -- /path/to/prisma-examples

# Check one project (folder that contains schema.prisma and migrations/)
npm run check-repo -- /path/to/repo
```

## What it reads
- Prisma schema and migrations (database structure)
- TypeScript and JavaScript source (Prisma calls and endpoint flows, inferred)

## Output
Writes only to `artifacts/schemasage/` inside the analysed repository:
- `index.html`: offline page with tables, relationships, findings, coverage
- `data/database.json`: the normalized model
- `markdown/database.md`: the same content as Markdown
- `manifest.json`: file hashes

Secret values from `.env` files are redacted from every output file.

## Limits (alpha)
- Prisma only. MongoDB is not supported. Multi-schema (`@@schema`) is not handled.
- Tested on the 78 official Prisma example schemas: 77 read, 1 MongoDB (see docs/real-world-prisma-examples.txt).
- `relationMode = "prisma"` (no foreign keys in the database) is not detected yet. Those relationships show as orm-declared, which is correct, but any findings about them may be misleading.
- The parser reads `schema.prisma` line by line. It does not run Prisma.
- Migrations are read as SQL text. Only `FOREIGN KEY` and `CREATE INDEX` statements are used.
- The ER diagram uses a fixed grid layout. Dense schemas will have crossing lines.

## Licence
MIT. See `LICENSE`.
