import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    env: {
      DATABASE_URL: "postgres://postgres:postgres@localhost:5432/ticket_db",
    },
  },
});
