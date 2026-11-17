import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { config } from "../config.js";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function runMigrations() {
  const migrationClient = postgres(config.DATABASE_URL, {
    max: 1,
    onnotice: () => {},
  });
  const migrationDb = drizzle(migrationClient);
  const migrationsFolder =
    process.env.MIGRATIONS_FOLDER || path.resolve(__dirname, "../../drizzle");
  await migrate(migrationDb, { migrationsFolder });
  await migrationClient.end();
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
  runMigrations().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
