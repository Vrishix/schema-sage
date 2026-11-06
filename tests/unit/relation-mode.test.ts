import { describe, it, expect } from "vitest";
import path from "node:path";
import os from "node:os";
import { promises as fs } from "node:fs";
import { analyzeRepo } from "../../src/pipeline.js";

async function repoWith(schema: string, sql?: string): Promise<string> {
  const repo = await fs.mkdtemp(path.join(os.tmpdir(), "rm-"));
  await fs.mkdir(path.join(repo, "prisma/migrations/0001_init"), { recursive: true });
  await fs.writeFile(path.join(repo, "prisma/schema.prisma"), schema);
  if (sql) await fs.writeFile(path.join(repo, "prisma/migrations/0001_init/migration.sql"), sql);
  return repo;
}

const schema = (mode: string) => `datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
  ${mode}
}

model User {
  id    Int    @id
  posts Post[]
}

model Post {
  id       Int  @id
  authorId Int
  author   User @relation(fields: [authorId], references: [id])

  @@index([authorId])
}
`;

describe("relationMode", () => {
  it("treats relations as ORM-declared when relationMode is prisma, even if a migration has a foreign key", async () => {
    const repo = await repoWith(schema('relationMode = "prisma"'),
      `ALTER TABLE "Post" ADD CONSTRAINT "Post_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;`);
    const m = (await analyzeRepo(repo, { write: false })).model!;
    expect(m.relationships.map((r) => r.enforcement)).toEqual(["orm-declared"]);
    expect(m.coverage.unsupported.some((u) => u.includes('relationMode = "prisma"'))).toBe(true);
    await fs.rm(repo, { recursive: true, force: true });
  });

  it("keeps db-enforced when relationMode is the default and a migration has the foreign key", async () => {
    const repo = await repoWith(schema(""),
      `ALTER TABLE "Post" ADD CONSTRAINT "Post_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;`);
    const m = (await analyzeRepo(repo, { write: false })).model!;
    expect(m.relationships.map((r) => r.enforcement)).toEqual(["db-enforced"]);
    await fs.rm(repo, { recursive: true, force: true });
  });
});

describe("application section in output", () => {
  it("writes usage and flow sections when application code exists", async () => {
    const repo = await repoWith(schema(""));
    await fs.mkdir(path.join(repo, "src"), { recursive: true });
    await fs.writeFile(path.join(repo, "src/app.ts"), `const prisma = new PrismaClient();
app.post("/posts", (req, res) => {
  return prisma.post.create({ data: req.body });
});`);
    const r = await analyzeRepo(repo, { write: true });
    const html = await fs.readFile(path.join(repo, "artifacts/schemasage/index.html"), "utf8");
    expect(html).toContain("Application usage");
    expect(html).toContain("POST /posts");
    expect(html).toContain("Post");
    expect(r.log.join("\n")).toMatch(/Application: 1 Prisma call/);
    await fs.rm(repo, { recursive: true, force: true });
  });
});
