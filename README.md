# SchemaSage

> You built it with AI. Now understand its database.

SchemaSage explains your database: tables, columns, keys, indexes, and relationships. It produces an offline HTML page with an interactive ER diagram where every fact links to its origin.

Works with **PostgreSQL**, **MongoDB**, **MySQL**, **SQLite**, and ORMs like **Prisma**, **Mongoose**, **SQLAlchemy**, and raw **SQL migrations**.

---

## Quickstart

### 1. Direct Database Inspection (PostgreSQL, MongoDB, etc.)
Inspect any running database directly by passing its connection URL:

```bash
# PostgreSQL
npx schemasage inspect postgres://user:password@localhost:5432/mydb

# MongoDB
npx schemasage inspect mongodb+srv://cluster.mongodb.net/mydb
```
This queries the database catalog/collections, maps foreign keys and field types, and produces an offline ER diagram in `artifacts/schemasage/index.html`.

---

### 2. Static Codebase / Repository Analysis
Analyze a codebase without connecting to any database:

```bash
npx schemasage analyze .
```

Supported repository setups:
- **Prisma** (`schema.prisma` and migrations)
- **Mongoose / MongoDB** (Mongoose schema definitions and `ref` relationships)
- **Raw SQL** (`schema.sql`, `init.sql`, or migration directories)
- **SQLAlchemy** (Python `Base` models and `mapped_column`)

---

## Principles
- **Read-only**: Never modifies your database, runs untrusted code, or executes migrations.
- **Local & Private**: 100% offline. Zero telemetry, no cloud upload, no accounts.
- **Evidence-first**: Claims are tagged as *Verified* or *Inferred*.
- **Secret Redaction**: Connection strings and credentials from `.env` are automatically scrubbed from generated files.

---

## Output
Generated inside `artifacts/schemasage/`:
- `index.html`: Offline interactive ER diagram and schema documentation.
- `data/database.json`: Normalized schema representation.
- `markdown/database.md`: Database documentation in Markdown format.
- `manifest.json`: Checksums and integrity verification.

---

## Development

```bash
npm install
npm run typecheck
npm test
npm run build
```

## Licence
MIT. See `LICENSE`.
