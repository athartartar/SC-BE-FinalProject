import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { db } from "./db/client.js";
import { eventsRouter } from "./routes/events.js";
import { ordersRouter } from "./routes/orders.js";
import { AppError } from "./services/errors.js";

export function createApp(customDb = db) {
  const app = new Hono();

  app.onError((err, c) => {
    if (err instanceof AppError) {
      return c.json(
        {
          error: {
            code: err.code,
            message: err.message,
          },
        },
        err.statusCode as any
      );
    }

    return c.json(
      {
        error: {
          code: "INTERNAL_SERVER_ERROR",
          message: err.message,
        },
      },
      500
    );
  });

  app.get("/health", async (c) => {
    try {
      await customDb.execute(sql`SELECT 1`);
      return c.json({ status: "ok" });
    } catch {
      return c.json({ status: "error" }, 503);
    }
  });

  app.route("/events", eventsRouter);
  app.route("/orders", ordersRouter);

  return app;
}

export const app = createApp();
