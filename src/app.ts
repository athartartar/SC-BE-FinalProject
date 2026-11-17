import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { db } from "./db/client.js";

export function createApp(customDb = db) {
  const app = new Hono();

  app.get("/health", async (c) => {
    try {
      await customDb.execute(sql`SELECT 1`);
      return c.json({ status: "ok" });
    } catch {
      return c.json({ status: "error" }, 503);
    }
  });

  return app;
}

export const app = createApp();
