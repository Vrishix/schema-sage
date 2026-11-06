import { describe, it, expect } from "vitest";
import path from "node:path";
import os from "node:os";
import { promises as fs } from "node:fs";
import { analyzeRepo } from "../../src/pipeline.js";

// Regression: @@map renames the physical table. Migrations use the physical name.
describe("@@map migration reconciliation", () => {
  it("matches migration foreign keys and indexes using physical table names", async () => {
    const repo = await fs.mkdtemp(path.join(os.tmpdir(), "mapped-"));
    await fs.mkdir(path.join(repo, "prisma/migrations/0001_init"), { recursive: true });
    await fs.writeFile(path.join(repo, "prisma/schema.prisma"), `datasource db {
  provider = "postgresql"
}

model Owner {
  id           Int           @id
  tutorProfile TutorProfile?

  @@map("owners_tbl")
}

model TutorProfile {
  id      Int   @id
  ownerId Int   @unique
  owner   Owner @relation(fields: [ownerId], references: [id])
  bookings Booking[]

  @@map("tutor_profiles")
}

model Booking {
  id        Int          @id
  tutorId   Int
  tutor     TutorProfile @relation(fields: [tutorId], references: [id])

  @@map("bookings")
}
`);
    await fs.writeFile(path.join(repo, "prisma/migrations/0001_init/migration.sql"), `
CREATE TABLE "owners_tbl" ("id" INTEGER NOT NULL, CONSTRAINT "owners_tbl_pkey" PRIMARY KEY ("id"));
CREATE TABLE "tutor_profiles" ("id" INTEGER NOT NULL, "ownerId" INTEGER NOT NULL, CONSTRAINT "tutor_profiles_pkey" PRIMARY KEY ("id"));
CREATE TABLE "bookings" ("id" INTEGER NOT NULL, "tutorId" INTEGER NOT NULL, CONSTRAINT "bookings_pkey" PRIMARY KEY ("id"));
CREATE UNIQUE INDEX "tutor_profiles_ownerId_key" ON "tutor_profiles"("ownerId");
ALTER TABLE "tutor_profiles" ADD CONSTRAINT "tutor_profiles_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "owners_tbl"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_tutorId_fkey" FOREIGN KEY ("tutorId") REFERENCES "tutor_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "bookings_tutorId_idx" ON "bookings"("tutorId");
`);
    const m = (await analyzeRepo(repo, { write: false })).model!;
    const owner = m.relationships.find((r) => r.from === "column:TutorProfile.ownerId")!;
    expect(owner.enforcement).toBe("db-enforced");
    const booking = m.relationships.find((r) => r.from === "column:Booking.tutorId")!;
    expect(booking.enforcement).toBe("db-enforced");
    // Booking.tutorId is indexed by a migration index on the physical name: no finding.
    expect(m.findings.map((f) => f.id)).not.toContain("finding:fk-no-index:Booking.tutorId");
    // TutorProfile.ownerId has a unique migration index: not flagged.
    expect(m.findings.map((f) => f.id)).not.toContain("finding:fk-no-index:TutorProfile.ownerId");
    await fs.rm(repo, { recursive: true, force: true });
  });
});
