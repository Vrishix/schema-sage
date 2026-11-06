import { prismaAdapter } from "./prisma/index.js";
import type { DatabaseAdapter } from "./types.js";

export const adapters: DatabaseAdapter[] = [prismaAdapter];
