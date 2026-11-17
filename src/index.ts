import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { config } from "./config.js";
import { runMigrations } from "./db/migrate.js";
import { expireDueOrders } from "./services/expiry.js";

async function start() {
  await runMigrations();

  const app = createApp();

  const sweeper = setInterval(() => {
    expireDueOrders().catch((err) => {
      console.error(err);
    });
  }, 10000);

  const server = serve(
    {
      fetch: app.fetch,
      port: config.PORT,
    },
    (info) => {
      console.log(`Server is running on http://localhost:${info.port}`);
    }
  );

  const shutdown = () => {
    clearInterval(sweeper);
    server.close();
    process.exit(0);
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

start().catch((err) => {
  console.error(err);
  process.exit(1);
});
