import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema.js";
import { config } from "../config.js";

export const queryClient = postgres(config.DATABASE_URL);
export const db = drizzle(queryClient, { schema });
