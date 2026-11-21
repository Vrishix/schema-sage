<p align="center">
  <h1 align="center">SchemaSage</h1>
  <p align="center">
    <strong>You built it with AI. Now understand its database.</strong><br>
    Offline-first database architecture and interactive ER diagram explorer for modern engineering teams.
  </p>
  <p align="center">
    <a href="https://github.com/Vrishix/schema-sage/actions"><img src="https://img.shields.io/badge/tests-46%20passed-brightgreen.svg" alt="Tests" /></a>
    <a href="https://github.com/Vrishix/schema-sage/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License" /></a>
    <a href="https://nodejs.org"><img src="https://img.shields.io/badge/node-%3E%3D20-informational.svg" alt="Node" /></a>
    <a href="https://www.npmjs.com/package/@vrishix/schemasage"><img src="https://img.shields.io/badge/npm-ready-red.svg" alt="npm" /></a>
  </p>
</p>

---

## What is SchemaSage?

Modern applications—especially those developed rapidly with LLMs and coding assistants—often accumulate tangled database schemas across multiple migrations and ORM models.

**SchemaSage** statically analyzes your project's schema files and migrations to reverse-engineer and document your full data model. It generates a self-contained, offline interactive HTML report with:

- **Entity-Relationship (ER) Diagram** with click-to-pan, interactive zoom, and table highlights.
- **Archify-Style Relationship Inspector**: Hover over any relation line to inspect exact column links, cardinality (`1:1`, `1:N`, `N:N`), enforcement level, and line-level source code evidence.
- **Dual Diagram Modes**: Toggle instantly between the visual canvas and raw **Mermaid.js** code (with one-click copy for GitHub PRs, Markdown notes, or Notion).
- **ChatGPT-Style Collapsible Sidebar**: Search, filter, and jump directly to any table card without scrolling through hundreds of lines.
- **Evidence-First Verification**: Every table, column, and foreign key links directly to the repository file and line number where it was discovered.
- **Multi-Engine Support**: Works with **PostgreSQL**, **MongoDB**, **MySQL**, **SQLite**, **Prisma**, **SQLAlchemy**, and **Mongoose**.

---

## Quickstart

Run SchemaSage directly using `npx`—no global installation required.

### 1. Static Repository Scan (No DB Connection Needed)
Analyze any repository locally without running application code, executing migrations, or connecting to a database:

```bash
# Analyze current folder
npx github:Vrishix/schema-sage analyze .

# Or analyze a specific repository
npx github:Vrishix/schema-sage analyze /path/to/project
```

#### Supported Stacks:
- **Python / SQLAlchemy**: Declarative models (`Base`, `mapped_column`, `Column`, `ForeignKey`, `relationship`).
- **Prisma**: Schemas (`schema.prisma`) and raw SQL migration directories.
- **Node.js / Mongoose**: TypeScript and JavaScript Mongoose models (`new Schema<T>`, `model('User', ...)`, Typegoose `@prop`).
- **Raw SQL Migrations**: Standard `.sql` migrations and schema dumps (`CREATE TABLE`, `FOREIGN KEY`, `REFERENCES`).

---

### 2. Direct Database Inspection (Live Introspection)
Inspect any running database instance directly via connection string:

```bash
# PostgreSQL
npx github:Vrishix/schema-sage inspect postgres://user:password@localhost:5432/mydb

# MongoDB
npx github:Vrishix/schema-sage inspect mongodb+srv://cluster.mongodb.net/mydb
```

This queries `information_schema` (PostgreSQL) or samples collections (MongoDB) to extract verified columns, keys, and foreign references into the offline ER explorer.

---

## Output

SchemaSage creates a self-contained documentation folder at `artifacts/schemasage/`:

```text
artifacts/schemasage/
├── index.html            <-- Interactive ER explorer (offline, zero external CDN scripts)
├── data/database.json    <-- Normalized JSON schema model
├── markdown/database.md  <-- Clean Markdown database documentation
└── manifest.json         <-- Checksums & integrity hashes
```

To view your architecture, open `artifacts/schemasage/index.html` in any browser:
```bash
# macOS
open artifacts/schemasage/index.html

# Windows
start artifacts/schemasage/index.html

# Linux
xdg-open artifacts/schemasage/index.html
```

---

## Core Principles

- **Zero-Trust & Read-Only**: Never modifies your database, never runs project code, and never executes untrusted migrations.
- **Local & Private**: Runs 100% locally. Zero telemetry, no cloud accounts, and no data leaves your machine.
- **Automatic Secret Redaction**: Detects and redacts credentials, passwords, and `.env` connection strings from all generated outputs.
- **Strict Content Security Policy (CSP)**: Generated HTML reports require no external scripts and run fully offline behind cryptographically hashed CSP headers.

---

## Contributing & Development

```bash
# Clone the repository
git clone https://github.com/Vrishix/schema-sage.git
cd schema-sage

# Install dependencies
npm install

# Run type check and unit tests
npm run typecheck
npm test

# Build bundled distribution
npm run build
```

---

## License

MIT © [Parth (Vrishix)](https://github.com/Vrishix)
