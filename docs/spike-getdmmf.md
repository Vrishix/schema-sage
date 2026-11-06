# Spike: can Prisma's own parser replace the regex reader?

Date: 2026-11-02. Tested versions: `@prisma/internals@5` (getDMMF), `@mrleebo/prisma-ast@0.12`. Prisma 6 and later not tested.

## Question
Can we read `schema.prisma` with Prisma's own code instead of our line-based reader?

## Results

| Check | Result |
|---|---|
| Fixture `prisma-basic` read by `getDMMF` | Yes. Models, fields, `@id`, `@unique`, optional fields, relation fields and foreign-key fields all correct. 26 ms |
| Runs without network | Yes. Ran inside a network-less namespace (`unshare -rn`) |
| Downloads query or schema engines | No engine binaries appeared in `node_modules` |
| `@@map("members")` | Yes, via `dbName` |
| `@@unique([id, tenantId])` | Yes, via `uniqueIndexes` |
| Composite primary key `@@id([a, b])` | Yes, via `primaryKey.fields` |
| Composite foreign key `fields: [a, b]` | Yes, via `relationFromFields` / `relationToFields` |
| `@@index([orgId])` | **No.** `getDMMF` does not expose indexes |
| Line numbers for evidence | **No.** `getDMMF` has no source positions |
| Invalid schema | Clear error with line number from Prisma's validator |

`@mrleebo/prisma-ast` exposes `@@index` attributes but also has no source positions.

## Recommendation
Use a two-part reader:
1. **`getDMMF`** for models, fields, keys, unique constraints, relations, and mapped names. It is Prisma's own validator, so an invalid schema fails loudly.
2. **`@mrleebo/prisma-ast`** for `@@index` attributes.
3. **A small line scanner** that finds the line of each model and field, used only for evidence links.

This removes most of the regex parsing and keeps the evidence links the portal depends on.

## Open items before adoption
- Test Prisma 6 and 7 versions. The output format may differ.
- Decide how to pin the Prisma version. Each project may use a different one.
- Confirm that loading `@prisma/internals` never downloads anything in a normal install. The network-less run suggests it doesn't, but it needs a test on a clean machine.
- Check licensing of `@prisma/internals` (Apache-2.0 at the time of testing) and of `@mrleebo/prisma-ast` before shipping.

## Spike script
Kept outside the project. Reproduce with `npm i @prisma/internals@5` and `getDMMF({ datamodel })`. Edge-case schema: `@@map`, `@@unique`, `@@index`, composite `@@id` and foreign keys.
