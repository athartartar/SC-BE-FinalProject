import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    fileParallelism: false,
    setupFiles: ["tests/setup.ts"],
    env: {
      DATABASE_URL:
        process.env.DATABASE_URL ||
        "postgres://postgres:postgres@localhost:5432/ticket_db",
    },
  },
});
