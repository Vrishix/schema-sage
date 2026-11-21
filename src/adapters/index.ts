import { prismaAdapter } from "./prisma/index.js";
import { sqlalchemyAdapter } from "./sqlalchemy/index.js";
import { mongooseAdapter } from "./mongoose/index.js";
import { sqlAdapter } from "./sql/index.js";
import type { DatabaseAdapter } from "./types.js";

// Specific / strictly-defined schema adapters come first.
export const adapters: DatabaseAdapter[] = [
  prismaAdapter,
  sqlalchemyAdapter,
  mongooseAdapter,
  sqlAdapter,
];
