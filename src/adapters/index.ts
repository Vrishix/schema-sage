import { prismaAdapter } from "./prisma/index.js";
import { sqlalchemyAdapter } from "./sqlalchemy/index.js";
import { mongooseAdapter } from "./mongoose/index.js";
import { sqlAdapter } from "./sql/index.js";
import type { DatabaseAdapter } from "./types.js";

export const adapters: DatabaseAdapter[] = [
  prismaAdapter,
  mongooseAdapter,
  sqlalchemyAdapter,
  sqlAdapter,
];
