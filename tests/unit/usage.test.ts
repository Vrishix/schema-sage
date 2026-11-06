import { describe, it, expect } from "vitest";
import { scanUsage } from "../../src/usage/scan-usage.js";
import { buildFlows } from "../../src/usage/flows.js";

const models = ["Order", "User", "TutorProfile"];

describe("Prisma call scanner", () => {
  it("finds model calls with operation, line and enclosing function", () => {
    const src = `import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
export async function createOrder(input) {
  return prisma.order.create({ data: input });
}
export function list() {
  return prisma.user.findMany();
}`;
    const r = scanUsage([{ path: "src/a.ts", text: src }], models);
    expect(r.usages.map((u) => [u.table, u.operation, u.method, u.line, u.fn])).toEqual([
      ["Order", "write", "create", 4, "createOrder"],
      ["User", "read", "findMany", 7, "list"],
    ]);
  });

  it("recognises custom client variable names and property receivers", () => {
    const src = `const client = new PrismaClient();
class Repo { constructor() { this.x = 1; } async load() { return client.tutorProfile.update({ where: {}, data: {} }); } }
async function remove() { return db.order.deleteMany({}); }`;
    const r = scanUsage([{ path: "src/r.ts", text: src }], models);
    expect(r.usages.map((u) => `${u.table}:${u.operation}`).sort()).toEqual(["Order:delete", "TutorProfile:write"]);
  });

  it("reports raw SQL separately and ignores unknown models", () => {
    const src = "async function f(){ await prisma.$queryRaw`select 1`; await prisma.ghost.findMany(); }";
    const r = scanUsage([{ path: "src/x.ts", text: src }], models);
    expect(r.rawSql.length).toBe(1);
    expect(r.usages).toEqual([]);
  });
});

describe("endpoint flows", () => {
  it("traces an Express route through a service to a Prisma call", () => {
    const files = [
      { path: "src/routes.ts", text: `import { createOrder } from "./service";\nrouter.post("/orders", createOrder);` },
      { path: "src/service.ts", text: `export function createOrder(b) { return saveOrder(b); }\nfunction saveOrder(b) { return prisma.order.create({ data: b }); }` },
    ];
    const usage = scanUsage(files, models);
    const { endpoints, flows } = buildFlows(files, usage.usages);
    expect(endpoints[0]).toMatchObject({ method: "POST", path: "/orders", handler: "createOrder" });
    expect(flows.length).toBe(1);
    expect(flows[0].chain.map((c) => c.fn)).toEqual(["createOrder", "saveOrder"]);
    expect(flows[0].operations[0]).toMatchObject({ table: "Order", operation: "write" });
    expect(flows[0].confidence).toBe("inferred");
  });

  it("finds Next.js App Router handlers from the route file path", () => {
    const files = [
      { path: "app/api/orders/[id]/route.ts", text: `export async function GET(req) { return prisma.user.findMany(); }` },
    ];
    const usage = scanUsage(files, models);
    const { endpoints, flows } = buildFlows(files, usage.usages);
    expect(endpoints[0]).toMatchObject({ method: "GET", path: "/api/orders/[id]" });
    expect(flows[0].operations[0].table).toBe("User");
  });

  it("does not report endpoints that never reach the database", () => {
    const files = [{ path: "src/r.ts", text: `app.get("/ping", ping);\nfunction ping(){ return "ok"; }` }];
    const { endpoints, flows } = buildFlows(files, []);
    expect(endpoints.length).toBe(1);
    expect(flows).toEqual([]);
  });
});

describe("Next.js Pages Router", () => {
  it("treats a default-exported API route as an endpoint", () => {
    const files = [{ path: "pages/api/users/index.ts", text: `export default async function handler(req, res) { return prisma.user.findMany(); }` }];
    const usage = scanUsage(files, models);
    const { endpoints, flows } = buildFlows(files, usage.usages);
    expect(endpoints[0]).toMatchObject({ method: "ANY", path: "/api/users" });
    expect(flows[0].operations[0].table).toBe("User");
  });
});

describe("ambiguous names", () => {
  it("does not follow a call name that has two definitions, and reports it", () => {
    const files = [
      { path: "src/routes.ts", text: `app.post("/x", handle);\nfunction handle(){ return save(); }` },
      { path: "src/a.ts", text: `export function save(){ return prisma.order.create({ data: {} }); }` },
      { path: "src/b.ts", text: `export function save(){ return 1; }` },
    ];
    const usage = scanUsage(files, models);
    const { flows } = buildFlows(files, usage.usages);
    expect(flows).toEqual([]);
  });
});
