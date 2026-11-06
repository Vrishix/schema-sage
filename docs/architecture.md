# Architecture (alpha)

Pipeline: scanner -> adapter(s) -> normalized model -> analysis -> validator -> redaction -> renderer -> output manager.

Implemented in this alpha:
- `scanner/scan.ts`: file inventory, ignores, .env listed as skipped and never read.
- `model/types.ts`: normalized model v0.
- `validation/validate.ts`: structural rules, including db-enforced requires migration evidence.
- `redaction/redact.ts`: secret values parsed from .env and replaced in output.
- `generator/output.ts`: writes only inside `artifacts/schemasage/`.
- `adapters/prisma`: detection only.

Open spike (M1): confirm `@prisma/internals` `getDMMF` reads the schema offline without downloading engines. Record result here.

## Prisma reader (adopted in 0.1.0-alpha.2)
- `getDMMF` (Prisma's own reader): models, fields, keys, unique constraints, relations, mapped names.
- `@mrleebo/prisma-ast`: `@@index` and `@@unique` attributes.
- `locate.ts`: line numbers for evidence links.
- Migration SQL: parsed with `pgsql-ast-parser` and replayed in file order (`parse-migrations.ts`). Unsupported statements are reported.
- Both Prisma libraries are runtime dependencies. The bundle keeps them external.

## Spike result (see docs/spike-getdmmf.md)
`getDMMF` reads the schema offline without downloading engines, and handles mapped names, unique indexes, composite keys and composite foreign keys. It does not expose `@@index` or source line numbers. Recommended next step: adopt `getDMMF` for structure, `@mrleebo/prisma-ast` for `@@index`, and a small line scanner for evidence. Adopted; see above.
