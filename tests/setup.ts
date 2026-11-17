import { beforeAll, beforeEach } from "vitest";
import { sql } from "drizzle-orm";
import { db } from "../src/db/client.js";
import { runMigrations } from "../src/db/migrate.js";

beforeAll(async () => {
  await runMigrations();
});

beforeEach(async () => {
  await db.execute(
    sql`TRUNCATE TABLE events, ticket_types, orders, tickets CASCADE;`
  );
});
